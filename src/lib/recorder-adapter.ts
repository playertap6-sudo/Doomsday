// src/lib/recorder-adapter.ts
// Resilient speech recognition adapter for EquaTranslate PRO
// Primary: Browser Web Speech API with auto-recovery, deduplication, and dynamic source language switching
// Fallback: MediaRecorder with Groq Whisper chunk upload via process-audio Edge Function

import { supabase } from "@/lib/supabase";

export const TEACHER_LANG_TAGS: Record<string, string> = {
  English: "en-US",
  Hindi: "hi-IN",
  Tamil: "ta-IN",
  Malayalam: "ml-IN",
  Kannada: "kn-IN",
  Telugu: "te-IN",
};

export type RecorderState =
  "idle" | "connecting" | "listening" | "processing" | "denied" | "unavailable" | "error";

export interface RecorderCallbacks {
  onInterimTranscript?: (text: string) => void;
  onFinalTranscript?: (text: string, chunkIndex: number) => void;
  onError?: (error: string) => void;
  onStateChange?: (state: RecorderState) => void;
}

// Window type augmentation for Web Speech API
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message?: string;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface ISpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
}

type SpeechRecognitionConstructor = new () => ISpeechRecognition;

export class ReactRecorderAdapter {
  private lectureId: string;
  private sourceLanguage: string;
  private chunkIndex: number = 0;
  private callbacks: RecorderCallbacks;

  private isRecording: boolean = false;
  private mode: "web_speech" | "whisper_fallback" | "none" = "none";
  private currentState: RecorderState = "idle";

  // Web Speech API
  private recognition: ISpeechRecognition | null = null;
  private isRecognizing: boolean = false;
  private isStarting: boolean = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFinalizedText: string = "";
  private lastFinalizedTime: number = 0;

  // MediaRecorder Fallback
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private currentChunkStartMs: number = 0;
  private chunkDurationMs: number = 2500;

  constructor(
    lectureId: string,
    sourceLanguage: string = "English",
    callbacks: RecorderCallbacks = {},
  ) {
    this.lectureId = lectureId;
    this.sourceLanguage = sourceLanguage;
    this.callbacks = callbacks;
  }

  public getState(): RecorderState {
    return this.currentState;
  }

  private setState(state: RecorderState) {
    this.currentState = state;
    this.callbacks.onStateChange?.(state);
  }

  public setSourceLanguage(newLang: string) {
    if (!newLang || newLang === this.sourceLanguage) return;
    this.sourceLanguage = newLang;
    const tag = TEACHER_LANG_TAGS[newLang] || "en-IN";

    if (this.isRecording && this.mode === "web_speech" && this.recognition) {
      this.recognition.lang = tag;
      try {
        this.recognition.stop();
      } catch (_) {
        /* will auto restart in onend */
      }
    }
  }

  public async start(): Promise<void> {
    if (typeof window === "undefined") return;

    this.isRecording = true;
    this.lastFinalizedText = "";
    this.lastFinalizedTime = 0;
    this.setState("connecting");
    console.log("[RECORDER] start:", {
      lectureId: this.lectureId,
      sourceLanguage: this.sourceLanguage,
    });

    const SpeechRec = window as unknown as {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };

    const SpeechRecognitionClass = SpeechRec.SpeechRecognition || SpeechRec.webkitSpeechRecognition;

    if (SpeechRecognitionClass) {
      try {
        this.initWebSpeech(SpeechRecognitionClass);
        this.mode = "web_speech";
        this.safeStartRecognition();
        return;
      } catch (err) {
        console.warn(
          "[RecorderAdapter] Web Speech failed to start, falling back to MediaRecorder:",
          err,
        );
      }
    }

    // Fallback to MediaRecorder + Groq Whisper
    this.mode = "whisper_fallback";
    await this.startMediaRecorderFallback();
  }

  private initWebSpeech(SpeechClass: SpeechRecognitionConstructor) {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (_) {
        void 0;
      }
      this.recognition = null;
    }

    this.recognition = new SpeechClass();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;
    this.recognition.lang = TEACHER_LANG_TAGS[this.sourceLanguage] || "en-IN";

    this.recognition.onstart = () => {
      this.isRecognizing = true;
      this.isStarting = false;
      this.setState("listening");
      console.log("[RECORDER] recognition started:", this.recognition?.lang || this.sourceLanguage);
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = "";
      const results = event.results;

      for (let i = event.resultIndex; i < results.length; i++) {
        const item = results[i];
        if (!item || !item[0]) continue;
        const text = item[0].transcript.trim();
        if (!text) continue;

        if (item.isFinal) {
          const speechFinalMs = Date.now();

          // Deduplication: prevent processing identical phrase within 1.5s
          if (text === this.lastFinalizedText && speechFinalMs - this.lastFinalizedTime < 1500) {
            continue;
          }

          this.lastFinalizedText = text;
          this.lastFinalizedTime = speechFinalMs;

          const chunkIdx = this.chunkIndex++;
          console.log("[RECORDER] final:", text);
          this.callbacks.onFinalTranscript?.(text, chunkIdx);

          // Fire-and-forget: don't block UI state on network round-trip
          this.sendTextPhrase(text, chunkIdx, speechFinalMs).catch((err) => {
            console.error("[RecorderAdapter] Background send error:", err);
          });
        } else {
          interimTranscript += " " + text;
        }
      }

      if (interimTranscript.trim()) {
        console.log("[RECORDER] interim:", interimTranscript.trim());
        this.callbacks.onInterimTranscript?.(interimTranscript.trim());
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        return; // Normal pause or restart
      }

      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        this.setState("denied");
        this.callbacks.onError?.("Microphone permission was denied.");
        this.stop();
        return;
      }

      console.warn("[RecorderAdapter] WebSpeech error:", event.error);

      if (event.error === "network" || event.error === "audio-capture") {
        console.warn(
          `[RecorderAdapter] WebSpeech encountered "${event.error}". Falling back to resilient MediaRecorder + Groq Whisper...`,
        );
        this.mode = "whisper_fallback";
        if (this.recognition) {
          try {
            this.recognition.abort();
          } catch (_) {
            void 0;
          }
          this.recognition = null;
        }
        void this.startMediaRecorderFallback();
        return;
      }

      this.callbacks.onError?.(`Speech recognition error: ${event.error}`);
    };

    this.recognition.onend = () => {
      this.isRecognizing = false;
      this.isStarting = false;

      if (this.isRecording && this.mode === "web_speech") {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          this.safeStartRecognition();
        }, 200);
      }
    };
  }

  private safeStartRecognition() {
    if (!this.isRecording || !this.recognition) return;
    if (this.isRecognizing || this.isStarting) return;

    try {
      this.isStarting = true;
      this.recognition.lang = TEACHER_LANG_TAGS[this.sourceLanguage] || "en-IN";
      this.recognition.start();
    } catch (err: unknown) {
      this.isStarting = false;
      this.isRecognizing = false;
      const errorObj = err as { name?: string };
      if (errorObj?.name === "InvalidStateError") {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          this.safeStartRecognition();
        }, 300);
      }
    }
  }

  private async startMediaRecorderFallback(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setState("unavailable");
      this.callbacks.onError?.("Microphone API is not supported in this browser.");
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: unknown) {
      const errorObj = err as { name?: string };
      if (errorObj?.name === "NotAllowedError" || errorObj?.name === "PermissionDeniedError") {
        this.setState("denied");
        this.callbacks.onError?.("Microphone permission was denied.");
        return;
      }
      this.setState("error");
      this.callbacks.onError?.("Failed to access microphone.");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";

    this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);

    this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
      if (!e.data || e.data.size === 0) return;
      const chunkIdx = this.chunkIndex++;
      const chunkStart = this.currentChunkStartMs;
      this.currentChunkStartMs = Date.now();

      this.sendAudioChunk(e.data, chunkIdx, chunkStart);
    };

    this.currentChunkStartMs = Date.now();
    this.mediaRecorder.start(this.chunkDurationMs);
    this.setState("listening");
  }

  private async sendTextPhrase(text: string, chunkIndex: number, speechFinalMs: number) {
    const requestSentMs = Date.now();
    const payload = {
      lecture_id: this.lectureId,
      chunk_index: chunkIndex,
      text: text,
      source_language: this.sourceLanguage || "English",
      speech_final_ms: speechFinalMs,
      request_sent_ms: requestSentMs,
    };

    console.log("[PROCESS-AUDIO] request:", payload);

    try {
      const { data, error } = await supabase.functions.invoke("process-audio", {
        body: payload,
      });

      console.log("[PROCESS-AUDIO] response:", data, error);

      if (error) {
        console.error("[RecorderAdapter] process-audio invocation error:", error);
        return;
      }

      console.log(
        "[CAPTIONS] inserted:",
        (data?.translations_count ?? 0) + 1,
        "rows for lecture:",
        this.lectureId,
      );

      const clientReturnedMs = Date.now();
      const timings = data?.timings || {};

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("linguaclass:latency", {
            detail: {
              mode: "web_speech",
              chunkIndex,
              sourceLanguage: this.sourceLanguage,
              speechToReqMs: requestSentMs - speechFinalMs,
              clientToEdgeMs: timings.client_to_edge_ms ?? 0,
              sourceInsertMs: timings.source_insert_duration_ms ?? 0,
              translationMs: timings.translation_duration_ms ?? 0,
              transInsertMs: timings.translations_insert_duration_ms ?? 0,
              totalE2EMs: clientReturnedMs - speechFinalMs,
            },
          }),
        );
      }
    } catch (err) {
      console.error("[RecorderAdapter] Text dispatch error:", err);
    }
  }

  private async sendAudioChunk(blob: Blob, chunkIndex: number, chunkStartMs: number) {
    const uploadStartMs = Date.now();
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      const BATCH = 8192;
      for (let i = 0; i < bytes.length; i += BATCH) {
        binary += String.fromCharCode(...bytes.subarray(i, i + BATCH));
      }
      const base64 = btoa(binary);

      const { data, error } = await supabase.functions.invoke("process-audio", {
        body: {
          lecture_id: this.lectureId,
          chunk_index: chunkIndex,
          chunk_start_ms: chunkStartMs,
          chunk_upload_ms: uploadStartMs,
          audio_base64: base64,
          mime_type: blob.type || "audio/webm",
          source_language: this.sourceLanguage || "English",
        },
      });

      if (error) {
        console.error("[RecorderAdapter:Fallback] Chunk processing error:", error);
        return;
      }

      const clientReturnedMs = Date.now();
      const timings = data?.timings || {};

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("linguaclass:latency", {
            detail: {
              mode: "whisper_fallback",
              chunkIndex,
              sourceLanguage: this.sourceLanguage,
              speechToReqMs: uploadStartMs - chunkStartMs,
              clientToEdgeMs: timings.client_to_edge_ms ?? 0,
              sourceInsertMs: timings.source_insert_duration_ms ?? timings.whisper_duration_ms ?? 0,
              translationMs: timings.translation_duration_ms ?? 0,
              transInsertMs: timings.translations_insert_duration_ms ?? 0,
              totalE2EMs: clientReturnedMs - chunkStartMs,
            },
          }),
        );
      }
    } catch (err) {
      console.error("[RecorderAdapter:Fallback] Chunk dispatch failed:", err);
    }
  }

  public stop() {
    this.isRecording = false;
    this.isRecognizing = false;
    this.isStarting = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (_) {
        void 0;
      }
      this.recognition = null;
    }

    if (this.mediaRecorder) {
      try {
        this.mediaRecorder.stop();
      } catch (_) {
        void 0;
      }
      this.mediaRecorder = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.setState("idle");
  }
}

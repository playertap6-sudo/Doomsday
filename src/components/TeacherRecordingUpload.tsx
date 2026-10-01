// src/components/TeacherRecordingUpload.tsx
// Teacher Recorded Lecture Upload & AI Processing Modal / Panel.
// Uploads media to private 'lecture-recordings' bucket (<=25MB),
// then invokes 'process-recording' to trigger Whisper transcription, translations, Notes, and Quiz.

import { useState } from "react";
import {
  Upload,
  Film,
  FileAudio,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Sparkles,
  X,
  FileCheck,
} from "lucide-react";
import { supabase, type Lecture } from "@/lib/supabase";
import { createLecture, LANGUAGES } from "@/lib/session";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB (Groq Whisper limit)

const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".m4a", ".webm", ".mp4", ".ogg"];

type ProcessingPhase =
  | "idle"
  | "validating"
  | "uploading"
  | "transcribing"
  | "translating"
  | "generating_notes_quiz"
  | "completed"
  | "error";

export function TeacherRecordingUploadModal({
  currentLecture,
  onClose,
  onLectureCreatedOrUpdated,
}: {
  currentLecture: Lecture | null;
  onClose: () => void;
  onLectureCreatedOrUpdated: (lecture: Lecture) => void;
}) {
  const [mode, setMode] = useState<"current" | "new">(currentLecture ? "current" : "new");
  const [newTitle, setNewTitle] = useState("");
  const [sourceLang, setSourceLang] = useState("English");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [phase, setPhase] = useState<ProcessingPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<{
    transcriptSnippet?: string | undefined;
    segmentsCount?: number | undefined;
    notesReady?: boolean | undefined;
    quizReady?: boolean | undefined;
  } | null>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // 1. Validate file extension
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    const isAllowedExt = ALLOWED_EXTENSIONS.includes(ext);
    const isAllowedMime =
      file.type.startsWith("audio/") || file.type.startsWith("video/") || isAllowedExt;

    if (!isAllowedExt && !isAllowedMime) {
      setErrorMessage(
        `Unsupported media format (${file.name}). Please upload MP3, WAV, MP4, WebM, or OGG.`,
      );
      setSelectedFile(null);
      return;
    }

    // 2. Validate file size <= 25MB
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      setErrorMessage(
        `File is too large (${sizeMB} MB). Maximum supported recording size is 25 MB for AI transcription.`,
      );
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMessage("Please select an audio or video recording file to upload.");
      return;
    }

    setErrorMessage(null);
    setPhase("validating");

    try {
      // 1. Resolve or create the lecture
      let targetLecture: Lecture | null = currentLecture;

      if (mode === "new" || !targetLecture) {
        if (!newTitle.trim()) {
          setErrorMessage("Please enter a title for the new recorded lecture.");
          setPhase("idle");
          return;
        }

        const createRes = await createLecture({ title: newTitle.trim() });
        if (createRes.error || !createRes.lecture) {
          throw new Error(createRes.error || "Failed to create lecture record.");
        }
        targetLecture = createRes.lecture;
      }

      const lectureId = targetLecture.id;

      // 2. Sanitize file name and build deterministic path
      const sanitizedName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${lectureId}/${sanitizedName}`;

      // 3. Upload to private Supabase Storage
      setPhase("uploading");
      const { error: uploadErr } = await supabase.storage
        .from("lecture-recordings")
        .upload(storagePath, selectedFile, {
          contentType: selectedFile.type || "audio/mp4",
          upsert: true,
        });

      if (uploadErr) {
        console.error("[RecordingUpload] Storage upload error:", uploadErr);
        throw new Error(uploadErr.message || "Failed to upload file to storage.");
      }

      // 4. Trigger process-recording Edge Function
      setPhase("transcribing");

      const processRes = await supabase.functions.invoke("process-recording", {
        body: {
          lecture_id: lectureId,
          storage_path: storagePath,
          source_language: sourceLang,
        },
      });

      if (processRes.error) {
        console.error("[RecordingUpload] Process recording error:", processRes.error);
        throw new Error(processRes.error.message || "Recording transcription failed.");
      }

      const resData = processRes.data as {
        ok: boolean;
        transcript?: string;
        segments_count?: number;
        notes_ready?: boolean;
        quiz_ready?: boolean;
        error?: string;
      };

      if (!resData?.ok) {
        throw new Error(resData?.error || "AI processing returned an error.");
      }

      // 5. Update lecture status to 'ended' so students can view the full recording and review notes
      const { data: updatedLec } = await supabase
        .from("lectures")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", lectureId)
        .select()
        .single();

      if (updatedLec) {
        onLectureCreatedOrUpdated(updatedLec);
      }

      setResultSummary({
        transcriptSnippet: resData.transcript?.slice(0, 150) + "...",
        segmentsCount: resData.segments_count,
        notesReady: resData.notes_ready,
        quizReady: resData.quiz_ready,
      });

      setPhase("completed");
    } catch (err: unknown) {
      console.error("[RecordingUpload] Error:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "An error occurred while uploading and processing.",
      );
      setPhase("error");
    }
  }

  const isBusy =
    phase === "validating" ||
    phase === "uploading" ||
    phase === "transcribing" ||
    phase === "translating" ||
    phase === "generating_notes_quiz";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-strong relative w-full max-w-lg rounded-3xl p-6 sm:p-7 shadow-2xl border border-border/60 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between border-b border-border/40 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="neon-surface flex size-9 items-center justify-center rounded-xl text-primary-foreground">
              <Upload className="size-4" />
            </span>
            <div>
              <h3 className="text-base font-semibold">Upload Recorded Lecture</h3>
              <p className="text-[11px] text-muted-foreground">
                Automatic Whisper transcription, multilingual captions, notes & quiz
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className="text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-5 flex items-start gap-2.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Completed View */}
        {phase === "completed" ? (
          <div className="space-y-5 text-center py-4">
            <div className="neon-surface mx-auto flex size-14 items-center justify-center rounded-2xl shadow-lg">
              <CheckCircle2 className="size-7 text-emerald" />
            </div>
            <div>
              <h4 className="text-lg font-bold">Processing Complete!</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Recording has been transcribed, segmented into captions, and synthesized.
              </p>
            </div>

            <div className="glass rounded-2xl p-4 text-left space-y-2 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Segments Created:</span>
                <span className="font-semibold text-foreground">
                  {resultSummary?.segmentsCount || 0}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Bilingual Notes:</span>
                <span className="font-semibold text-emerald">Generated & Cached</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>MCQ Review Quiz:</span>
                <span className="font-semibold text-emerald">Ready for Students</span>
              </div>
              {resultSummary?.transcriptSnippet && (
                <div className="pt-2 border-t border-border/40">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Transcript Preview
                  </span>
                  <p className="mt-1 italic text-muted-foreground">
                    "{resultSummary.transcriptSnippet}"
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="neon-surface w-full rounded-xl py-3 text-xs font-semibold shadow-lg"
            >
              Done & Return to Studio
            </button>
          </div>
        ) : (
          /* Form View */
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Lecture Selection Mode */}
            {currentLecture && (
              <div className="glass flex rounded-xl p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setMode("current")}
                  disabled={isBusy}
                  className={`flex-1 rounded-lg py-1.5 font-medium transition-all ${
                    mode === "current"
                      ? "neon-surface text-primary-foreground font-semibold"
                      : "text-muted-foreground"
                  }`}
                >
                  Current Lecture ({currentLecture.join_code})
                </button>
                <button
                  type="button"
                  onClick={() => setMode("new")}
                  disabled={isBusy}
                  className={`flex-1 rounded-lg py-1.5 font-medium transition-all ${
                    mode === "new"
                      ? "neon-surface text-primary-foreground font-semibold"
                      : "text-muted-foreground"
                  }`}
                >
                  Create New Lecture
                </button>
              </div>
            )}

            {mode === "new" && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Lecture Title
                </label>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  disabled={isBusy}
                  placeholder="e.g. PHY-302: Quantum Superposition"
                  required
                  className="w-full rounded-xl border border-border bg-white/4 px-3.5 py-2.5 text-xs text-foreground outline-none focus:border-cyan/60"
                />
              </div>
            )}

            {/* Source Speech Language */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Spoken Language in Recording
              </label>
              <div className="flex flex-wrap gap-1.5">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.name}
                    type="button"
                    onClick={() => setSourceLang(l.name)}
                    disabled={isBusy}
                    className={`rounded-full px-3 py-1 text-xs transition-all ${
                      sourceLang === l.name
                        ? "neon-surface text-primary-foreground font-semibold"
                        : "glass text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Media File Input Dropzone */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Media File (Audio or Video, Max 25 MB)
              </label>

              <label
                className={`flex flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center cursor-pointer transition-colors ${
                  selectedFile
                    ? "border-emerald/50 bg-emerald/5"
                    : "border-border/60 hover:border-cyan/50 hover:bg-white/4"
                } ${isBusy ? "pointer-events-none opacity-50" : ""}`}
              >
                <input
                  type="file"
                  accept="audio/*,video/*,.mp3,.wav,.m4a,.webm,.mp4,.ogg"
                  onChange={handleFileSelect}
                  disabled={isBusy}
                  className="hidden"
                />

                {selectedFile ? (
                  <div className="flex flex-col items-center gap-1.5">
                    <FileCheck className="size-8 text-emerald" />
                    <span className="text-xs font-semibold text-foreground truncate max-w-xs">
                      {selectedFile.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB · Ready to upload
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="flex gap-2 text-muted-foreground">
                      <FileAudio className="size-6" />
                      <Film className="size-6" />
                    </div>
                    <span className="text-xs font-medium text-foreground">
                      Click to choose recording or drag and drop
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Supported: MP3, WAV, MP4, WebM, M4A (Max 25 MB)
                    </span>
                  </div>
                )}
              </label>
            </div>

            {/* Processing Stepper / Status Indicator */}
            {isBusy && (
              <div className="glass rounded-2xl p-4 text-xs space-y-2">
                <div className="flex items-center gap-2 text-cyan font-semibold">
                  <Loader2 className="size-4 animate-spin" />
                  <span>
                    {phase === "uploading" && "Uploading to secure storage..."}
                    {phase === "transcribing" && "Transcribing with Whisper Large-v3..."}
                    {phase === "translating" && "Segmenting & generating translations..."}
                    {phase === "generating_notes_quiz" && "Generating smart notes & quiz..."}
                    {phase === "validating" && "Validating media file..."}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Please keep this window open while the speech models process the lecture.
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isBusy}
                className="glass glass-hover rounded-xl px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isBusy || !selectedFile}
                className="neon-surface flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold shadow-lg transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Processing…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" /> Upload & Process
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

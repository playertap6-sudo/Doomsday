// src/components/RecordedLecturePlayer.tsx
// Playback of private recorded lectures with secure Supabase signed URLs,
// interactive multilingual segmented transcript, and KaTeX equation rendering.

import { useEffect, useState } from "react";
import {
  Play,
  RotateCw,
  FileAudio,
  Film,
  Languages,
  AlertCircle,
  Loader2,
  Clock,
  Sparkles,
} from "lucide-react";
import { supabase, type Caption, type Lecture } from "@/lib/supabase";
import { KaTeXContent } from "@/components/QuizPanel";

export function RecordedLecturePlayer({
  lecture,
  studentLanguage,
  captions,
}: {
  lecture: Lecture;
  studentLanguage: string;
  captions: Caption[];
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [isVideo, setIsVideo] = useState(false);

  // Transcript language view: either student's native language or English/Source
  const [transcriptLang, setTranscriptLang] = useState<string>(studentLanguage);

  useEffect(() => {
    setTranscriptLang(studentLanguage);
  }, [studentLanguage]);

  useEffect(() => {
    let isMounted = true;

    async function loadRecording() {
      if (!lecture?.id) return;
      setLoadingMedia(true);
      setMediaError(null);
      setSignedUrl(null);

      try {
        // 1. List files in the lecture's private directory
        const { data: files, error: listErr } = await supabase.storage
          .from("lecture-recordings")
          .list(lecture.id);

        if (listErr) {
          console.warn("[RecordedPlayer] Storage list error:", listErr);
          if (isMounted) {
            setMediaError("Could not access recording storage.");
            setLoadingMedia(false);
          }
          return;
        }

        const validMedia = files?.find(
          (f) =>
            !f.name.startsWith(".") &&
            (f.name.endsWith(".mp4") ||
              f.name.endsWith(".webm") ||
              f.name.endsWith(".wav") ||
              f.name.endsWith(".mp3") ||
              f.name.endsWith(".m4a") ||
              f.name.endsWith(".ogg")),
        );

        if (!validMedia) {
          if (isMounted) {
            setLoadingMedia(false);
          }
          return;
        }

        const filePath = `${lecture.id}/${validMedia.name}`;
        const isVid = validMedia.name.endsWith(".mp4") || validMedia.name.endsWith(".webm");

        // 2. Request a 1-hour secure signed URL from private storage
        const { data: signedData, error: signErr } = await supabase.storage
          .from("lecture-recordings")
          .createSignedUrl(filePath, 3600);

        if (signErr || !signedData?.signedUrl) {
          console.warn("[RecordedPlayer] Signed URL error:", signErr);
          if (isMounted) {
            setMediaError(signErr?.message || "Failed to generate secure playback stream.");
            setLoadingMedia(false);
          }
          return;
        }

        if (isMounted) {
          setFileName(validMedia.name);
          setFileSize(validMedia.metadata?.size || null);
          setIsVideo(isVid);
          setSignedUrl(signedData.signedUrl);
          setLoadingMedia(false);
        }
      } catch (err: unknown) {
        console.error("[RecordedPlayer] Error:", err);
        if (isMounted) {
          setMediaError("An unexpected error occurred while loading playback.");
          setLoadingMedia(false);
        }
      }
    }

    void loadRecording();

    return () => {
      isMounted = false;
    };
  }, [lecture?.id]);

  async function handleRefreshSignedUrl() {
    if (!lecture?.id || !fileName) return;
    setLoadingMedia(true);
    try {
      const filePath = `${lecture.id}/${fileName}`;
      const { data, error } = await supabase.storage
        .from("lecture-recordings")
        .createSignedUrl(filePath, 3600);
      if (!error && data?.signedUrl) {
        setSignedUrl(data.signedUrl);
        setMediaError(null);
      }
    } catch (_) {
      setMediaError("Failed to refresh signed URL.");
    } finally {
      setLoadingMedia(false);
    }
  }

  // Filter captions for the active transcript language
  const availableLangs = Array.from(new Set(captions.map((c) => c.language)));
  const displayCaptions = captions
    .filter((c) => c.language === transcriptLang)
    .sort((a, b) => a.chunk_index - b.chunk_index);

  return (
    <section className="glass-strong rounded-3xl p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
        <div className="flex items-center gap-2.5">
          <span className="neon-surface flex size-9 items-center justify-center rounded-xl text-primary-foreground shadow-md">
            <Film className="size-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-[10px] font-semibold text-cyan uppercase tracking-wider">
                Recorded Lecture
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs font-semibold text-foreground">{lecture.title}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Archived classroom session with full audio/video stream and synchronized transcript
            </p>
          </div>
        </div>

        {fileName && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Clock className="size-3.5 text-cyan" />
            <span>Secure 1-Hour Stream</span>
            <button
              onClick={handleRefreshSignedUrl}
              title="Refresh playback stream"
              className="text-muted-foreground hover:text-cyan transition-colors"
            >
              <RotateCw className="size-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Media Playback Area */}
      {loadingMedia ? (
        <div className="flex flex-col items-center justify-center py-10 text-xs text-muted-foreground gap-2">
          <Loader2 className="size-5 animate-spin text-cyan" />
          <span>Loading secure recording stream...</span>
        </div>
      ) : mediaError ? (
        <div className="flex items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-300">
          <AlertCircle className="size-5 shrink-0 text-rose-400" />
          <div className="flex-1">
            <p className="font-semibold">Playback Error</p>
            <p className="text-[11px] opacity-80">{mediaError}</p>
          </div>
          <button
            onClick={handleRefreshSignedUrl}
            className="glass flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs text-rose-200 hover:text-white"
          >
            <RotateCw className="size-3" /> Retry
          </button>
        </div>
      ) : signedUrl ? (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-black/40">
            {isVideo ? (
              <video
                src={signedUrl}
                controls
                controlsList="nodownload"
                className="w-full max-h-[420px] rounded-2xl bg-black"
              />
            ) : (
              <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="neon-surface flex size-16 items-center justify-center rounded-2xl shadow-xl">
                  <FileAudio className="size-8 text-primary-foreground" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold">{fileName}</h4>
                  {fileSize && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {(fileSize / (1024 * 1024)).toFixed(2)} MB · Encrypted Private Stream
                    </p>
                  )}
                </div>
                <audio src={signedUrl} controls className="w-full max-w-md mt-2" />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="glass rounded-2xl p-5 text-center text-xs text-muted-foreground">
          <p>Live session archive. Full transcript, notes, and quiz are synchronized below.</p>
        </div>
      )}

      {/* Transcript Area */}
      <div className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Languages className="size-4 text-violet" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Lecture Transcript ({transcriptLang})
            </h4>
          </div>

          {/* Transcript Language Switcher */}
          {availableLangs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {availableLangs.map((lang) => (
                <button
                  key={lang}
                  onClick={() => setTranscriptLang(lang)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    transcriptLang === lang
                      ? "neon-surface text-primary-foreground font-semibold"
                      : "glass text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Scrollable Segmented Transcript */}
        <div className="scroll-slim max-h-[300px] overflow-y-auto space-y-2 rounded-2xl border border-border/40 bg-white/2 p-3.5 pr-2 text-xs">
          {displayCaptions.length > 0 ? (
            displayCaptions.map((cap) => (
              <div
                key={cap.id}
                className="glass rounded-xl px-3.5 py-2.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground/70">
                  <span>Segment #{cap.chunk_index}</span>
                  <span className="text-cyan font-mono">{cap.language}</span>
                </div>
                <div className="leading-relaxed">
                  <KaTeXContent text={cap.text} />
                </div>
              </div>
            ))
          ) : (
            <p className="py-6 text-center text-muted-foreground italic">
              No transcript segments found for {transcriptLang}.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

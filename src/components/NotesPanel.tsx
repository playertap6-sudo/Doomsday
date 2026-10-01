// src/components/NotesPanel.tsx
// AI study notes panel for the Student Workspace.
// Loads cached notes from public.notes first; only calls generate-notes Edge Function on a cache miss.
// Supports all 6 languages with on-demand per-language generation and KaTeX math rendering.

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  NotebookPen,
  Languages,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FileX,
  Sparkles,
} from "lucide-react";
import { supabase, type Note } from "@/lib/supabase";
import katex from "katex";

// ── KaTeX + Markdown rendering ────────────────────────────────────────────────

function renderInlineKatex(text: string): string {
  return text.replace(/\\\((.+?)\\\)/g, (_, expr: string) => {
    try {
      return katex.renderToString(expr, { throwOnError: false, output: "html" });
    } catch {
      return `\\(${expr}\\)`;
    }
  });
}

function InlineContent({ text }: { text: string }) {
  const html = renderInlineKatex(text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"));
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let key = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      nodes.push(<br key={key++} />);
      continue;
    }
    const h1 = trimmed.match(/^#\s+(.*)/);
    const h2 = trimmed.match(/^##\s+(.*)/);
    const h3 = trimmed.match(/^###\s+(.*)/);
    if (h1) {
      nodes.push(
        <h2 key={key++} className="mt-5 mb-1 text-base font-bold text-cyan">
          <InlineContent text={h1[1] ?? ""} />
        </h2>,
      );
    } else if (h2) {
      nodes.push(
        <h3 key={key++} className="mt-4 mb-1 text-sm font-semibold text-violet">
          <InlineContent text={h2[1] ?? ""} />
        </h3>,
      );
    } else if (h3) {
      nodes.push(
        <h4 key={key++} className="mt-3 mb-0.5 text-xs font-semibold text-foreground">
          <InlineContent text={h3[1] ?? ""} />
        </h4>,
      );
    } else if (/^[-*]\s+/.test(trimmed)) {
      nodes.push(
        <li key={key++} className="ml-4 list-disc text-xs leading-relaxed text-muted-foreground">
          <InlineContent text={trimmed.replace(/^[-*]\s+/, "")} />
        </li>,
      );
    } else if (/^\d+\.\s+/.test(trimmed)) {
      nodes.push(
        <li key={key++} className="ml-4 list-decimal text-xs leading-relaxed text-muted-foreground">
          <InlineContent text={trimmed.replace(/^\d+\.\s+/, "")} />
        </li>,
      );
    } else if (/^-{3,}$/.test(trimmed) || /^\*{3,}$/.test(trimmed)) {
      nodes.push(<hr key={key++} className="my-3 border-border/40" />);
    } else {
      nodes.push(
        <p key={key++} className="text-xs leading-relaxed text-muted-foreground">
          <InlineContent text={trimmed} />
        </p>,
      );
    }
  }
  return <>{nodes}</>;
}

function renderMarkdownWithKatex(raw: string): React.ReactNode[] {
  const blockPattern = /\\\[([\s\S]+?)\\\]/g;
  const segments: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = blockPattern.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push(<MarkdownText key={key++} text={raw.slice(lastIndex, match.index)} />);
    }
    const expr = (match[1] ?? "").trim();
    try {
      const html = katex.renderToString(expr, {
        displayMode: true,
        throwOnError: false,
        output: "html",
      });
      segments.push(
        <div
          key={key++}
          className="my-3 overflow-x-auto rounded-xl bg-white/5 px-4 py-3 text-center"
          dangerouslySetInnerHTML={{ __html: html }}
        />,
      );
    } catch {
      segments.push(<code key={key++}>{`\\[${expr}\\]`}</code>);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < raw.length) {
    segments.push(<MarkdownText key={key++} text={raw.slice(lastIndex)} />);
  }

  return segments;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type NotesState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "generating" }
  | { status: "ready"; note: Note; cached: boolean }
  | { status: "no_lecture" }
  | { status: "no_captions" }
  | { status: "error"; message: string };

const NOTES_LANGUAGES = [
  { name: "English", native: "English", code: "EN" },
  { name: "Hindi", native: "हिन्दी", code: "HI" },
  { name: "Tamil", native: "தமிழ்", code: "TA" },
  { name: "Malayalam", native: "മലയാളം", code: "ML" },
  { name: "Kannada", native: "ಕನ್ನಡ", code: "KN" },
  { name: "Telugu", native: "తెలుగు", code: "TE" },
];

// ── Main Component ─────────────────────────────────────────────────────────────
export function NotesPanel({
  lectureId,
  defaultLanguage,
}: {
  lectureId: string | undefined;
  defaultLanguage: string;
}) {
  const [notesLang, setNotesLang] = useState<string>(defaultLanguage);
  const [state, setState] = useState<NotesState>({ status: "idle" });
  // In-session memory cache: language → Note row (avoids repeat Supabase queries)
  const sessionCache = useRef<Map<string, Note>>(new Map());
  // Track which lecture's cache this is (reset when lecture changes)
  const cachedLectureId = useRef<string | undefined>(undefined);

  // Reset cache and state when the lecture changes
  useEffect(() => {
    if (cachedLectureId.current !== lectureId) {
      sessionCache.current = new Map();
      cachedLectureId.current = lectureId;
      setState({ status: "idle" });
    }
  }, [lectureId]);

  // Trigger note loading whenever lectureId or notesLang changes
  useEffect(() => {
    if (!lectureId) {
      setState({ status: "no_lecture" });
      return;
    }
    void loadNotes(lectureId, notesLang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureId, notesLang]);

  async function loadNotes(lecId: string, lang: string) {
    // 1. In-session memory cache hit (free, instant)
    const memCached = sessionCache.current.get(lang);
    if (memCached) {
      setState({ status: "ready", note: memCached, cached: true });
      return;
    }

    // 2. Check Supabase notes table (DB cache)
    setState({ status: "checking" });
    try {
      const { data: existingNote, error: fetchErr } = await supabase
        .from("notes")
        .select("*")
        .eq("lecture_id", lecId)
        .eq("language", lang)
        .maybeSingle();

      if (fetchErr) {
        console.error("[NotesPanel] Supabase fetch error:", fetchErr);
        setState({ status: "error", message: "Failed to check notes database." });
        return;
      }

      if (existingNote?.content) {
        sessionCache.current.set(lang, existingNote);
        setState({ status: "ready", note: existingNote, cached: true });
        return;
      }

      // 3. Cache miss → call generate-notes Edge Function
      setState({ status: "generating" });
      await generateNotes(lecId, lang);
    } catch (err: unknown) {
      console.error("[NotesPanel] loadNotes error:", err);
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    }
  }

  async function generateNotes(lecId: string, lang: string) {
    try {
      const { data, error } = await supabase.functions.invoke("generate-notes", {
        body: { lecture_id: lecId, language: lang },
      });

      if (error) {
        console.error("[NotesPanel] Edge Function invoke error:", error);
        const msg = error.message ?? "";
        if (msg.toLowerCase().includes("caption") || msg.toLowerCase().includes("transcript")) {
          setState({ status: "no_captions" });
        } else {
          setState({
            status: "error",
            message: "Notes generation failed. Please try again.",
          });
        }
        return;
      }

      type EdgeResponse = {
        ok: boolean;
        cached?: boolean;
        notes?: {
          id?: string;
          lecture_id: string;
          language: string;
          content: string;
          created_at?: string;
        };
        error?: string;
      };

      const result = data as EdgeResponse;

      if (!result?.ok || !result?.notes?.content) {
        const serverMsg = result?.error ?? "Notes generation returned no content.";
        if (
          serverMsg.toLowerCase().includes("caption") ||
          serverMsg.toLowerCase().includes("transcript")
        ) {
          setState({ status: "no_captions" });
        } else {
          setState({ status: "error", message: serverMsg });
        }
        return;
      }

      const note: Note = {
        id: result.notes.id ?? `${lecId}-${lang}`,
        lecture_id: result.notes.lecture_id,
        language: result.notes.language,
        content: result.notes.content,
        created_at: result.notes.created_at ?? new Date().toISOString(),
      };

      sessionCache.current.set(lang, note);
      setState({ status: "ready", note, cached: result.cached ?? false });
    } catch (err: unknown) {
      console.error("[NotesPanel] generateNotes error:", err);
      const msg = err instanceof Error ? err.message : "Failed to generate notes.";
      if (
        msg.toLowerCase().includes("caption") ||
        msg.toLowerCase().includes("404") ||
        msg.toLowerCase().includes("transcript")
      ) {
        setState({ status: "no_captions" });
      } else {
        setState({ status: "error", message: msg });
      }
    }
  }

  function handleRetry() {
    if (!lectureId) return;
    sessionCache.current.delete(notesLang);
    setState({ status: "idle" });
    void loadNotes(lectureId, notesLang);
  }

  const isDisabled = state.status === "generating" || state.status === "checking";

  return (
    <section className="glass glass-hover rounded-3xl p-5">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <NotebookPen className="size-4 text-violet" />
          <h3 className="text-sm font-semibold">Bilingual Smart Notes</h3>
        </div>
        <StatusBadge state={state} />
      </div>

      {/* Language selector */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {NOTES_LANGUAGES.map((l) => {
          const hasCached =
            sessionCache.current.has(l.name) ||
            (state.status === "ready" && state.note.language === l.name);
          return (
            <button
              key={l.name}
              onClick={() => setNotesLang(l.name)}
              disabled={isDisabled}
              className={`relative flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-medium transition-all disabled:pointer-events-none disabled:opacity-50 ${
                notesLang === l.name
                  ? "neon-surface text-primary-foreground"
                  : "glass text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{l.code}</span>
              <span className="hidden sm:inline">{l.name}</span>
              {/* Green dot = notes exist for this language in session cache */}
              {hasCached && notesLang !== l.name && (
                <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-emerald shadow-[0_0_6px_var(--neon-emerald)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Content area driven by state */}
      <NotesContentArea state={state} onRetry={handleRetry} />
    </section>
  );
}

// ── Status Badge ───────────────────────────────────────────────────────────────
function StatusBadge({ state }: { state: NotesState }) {
  switch (state.status) {
    case "checking":
      return (
        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Checking notes…
        </span>
      );
    case "generating":
      return (
        <span className="flex items-center gap-1.5 text-[10px] text-cyan">
          <Sparkles className="size-3 animate-pulse" /> Generating…
        </span>
      );
    case "ready":
      return (
        <span className="flex items-center gap-1.5 text-[10px] text-emerald">
          <CheckCircle2 className="size-3" />
          {state.cached ? "Cached" : "Generated"}
        </span>
      );
    default:
      return null;
  }
}

// ── Content Area ───────────────────────────────────────────────────────────────
function NotesContentArea({ state, onRetry }: { state: NotesState; onRetry: () => void }) {
  switch (state.status) {
    case "idle":
    case "checking":
      return (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Loading existing notes…</span>
        </div>
      );

    case "generating":
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <div className="neon-surface flex size-10 items-center justify-center rounded-2xl">
            <Sparkles className="size-5 animate-pulse text-primary-foreground" />
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Generating AI study notes from lecture transcript…
            <br />
            <span className="text-[10px] opacity-70">
              This takes 10–30 seconds. Notes will be cached after generation.
            </span>
          </p>
        </div>
      );

    case "no_lecture":
      return (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <FileX className="size-8 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">
            No active lecture found.
            <br />
            Join a lecture to access study notes.
          </p>
        </div>
      );

    case "no_captions":
      return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <Languages className="size-8 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">
            No lecture content available yet.
            <br />
            Notes can be generated once the teacher begins broadcasting.
          </p>
          <button
            onClick={onRetry}
            className="glass glass-hover flex items-center gap-1.5 rounded-xl px-4 py-2 text-[11px] font-medium text-muted-foreground"
          >
            <RefreshCw className="size-3.5" /> Check again
          </button>
        </div>
      );

    case "error":
      return (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle className="size-5" />
            <span className="text-xs font-medium">Generation failed</span>
          </div>
          <p className="max-w-xs text-[11px] text-muted-foreground">{state.message}</p>
          <button
            onClick={onRetry}
            className="glass glass-hover flex items-center gap-1.5 rounded-xl px-4 py-2 text-[11px] font-medium text-muted-foreground hover:text-rose-300"
          >
            <RefreshCw className="size-3.5" /> Retry
          </button>
        </div>
      );

    case "ready":
      return <ReadyNotes content={state.note.content} language={state.note.language} />;

    default:
      return null;
  }
}

// ── Ready: renders Markdown+KaTeX notes ────────────────────────────────────────
function ReadyNotes({ content, language }: { content: string; language: string }) {
  const nodes = renderMarkdownWithKatex(content);
  return (
    <div className="max-h-[70vh] overflow-y-auto pr-1">
      <div className="mb-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Languages className="size-3" />
        <span>Notes language: {language}</span>
      </div>
      <div className="space-y-0.5">{nodes}</div>
    </div>
  );
}

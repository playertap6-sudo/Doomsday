// src/components/QuizPanel.tsx
// Real Multilingual Post-Lecture MCQ Quiz with attempts, weak topics, and KaTeX math rendering.
// Loads cached quiz from public.quizzes first; only calls generate-quiz Edge Function on cache miss.
// Saves attempts to public.quiz_attempts and supports retries, answer review, and persistent scores.

import { useEffect, useRef, useState, useMemo } from "react";
import {
  Loader2,
  CircleCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Award,
  ChevronRight,
  HelpCircle,
  FileQuestion,
  Languages,
} from "lucide-react";
import {
  supabase,
  type Quiz,
  type QuizAttempt,
  type QuizQuestion,
  type Json,
} from "@/lib/supabase";
import katex from "katex";

// ── KaTeX Math & Text Renderer ───────────────────────────────────────────────
function renderKaTeXString(text: string): string {
  if (!text) return "";
  // 1. Display math \[ ... \]
  let res = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr: string) => {
    try {
      return `<div class="my-2.5 overflow-x-auto text-center">${katex.renderToString(expr.trim(), {
        displayMode: true,
        throwOnError: false,
        output: "html",
      })}</div>`;
    } catch {
      return `\\[${expr}\\]`;
    }
  });

  // 2. Inline math \( ... \)
  res = res.replace(/\\\((.+?)\\\)/g, (_, expr: string) => {
    try {
      return katex.renderToString(expr.trim(), {
        displayMode: false,
        throwOnError: false,
        output: "html",
      });
    } catch {
      return `\\(${expr}\\)`;
    }
  });

  // 3. Bold markdown **text**
  res = res.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  return res;
}

export function KaTeXContent({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => renderKaTeXString(text), [text]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── Types ─────────────────────────────────────────────────────────────────────
type QuizState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "generating" }
  | { status: "ready"; quiz: Quiz; attempt: QuizAttempt | null; cached: boolean }
  | { status: "no_lecture" }
  | { status: "no_captions" }
  | { status: "error"; message: string };

const QUIZ_LANGUAGES = [
  { name: "English", native: "English", code: "EN" },
  { name: "Hindi", native: "हिन्दी", code: "HI" },
  { name: "Tamil", native: "தமிழ்", code: "TA" },
  { name: "Malayalam", native: "മലയാളം", code: "ML" },
  { name: "Kannada", native: "ಕನ್ನಡ", code: "KN" },
  { name: "Telugu", native: "తెలుగు", code: "TE" },
];

export function QuizPanel({
  lectureId,
  defaultLanguage,
  userId,
}: {
  lectureId: string | undefined;
  defaultLanguage: string;
  userId: string | undefined;
}) {
  const [quizLang, setQuizLang] = useState<string>(defaultLanguage);
  const [state, setState] = useState<QuizState>({ status: "idle" });

  // In-session memory cache: language → { quiz, attempt }
  const sessionCache = useRef<Map<string, { quiz: Quiz; attempt: QuizAttempt | null }>>(new Map());
  const cachedLectureId = useRef<string | undefined>(undefined);

  // Student's active selections in taking mode: questionIndex → selectedOptionIndex (0-3)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Reset cache if lecture changes
  useEffect(() => {
    if (cachedLectureId.current !== lectureId) {
      sessionCache.current = new Map();
      cachedLectureId.current = lectureId;
      setSelectedAnswers({});
      setIsRetrying(false);
      setState({ status: "idle" });
    }
  }, [lectureId]);

  // Load quiz whenever lectureId or quizLang changes
  useEffect(() => {
    if (!lectureId) {
      setState({ status: "no_lecture" });
      return;
    }
    setSelectedAnswers({});
    setIsRetrying(false);
    void loadQuiz(lectureId, quizLang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureId, quizLang]);

  async function loadQuiz(lecId: string, lang: string) {
    // 1. In-session memory cache
    const memCached = sessionCache.current.get(lang);
    if (memCached) {
      setState({
        status: "ready",
        quiz: memCached.quiz,
        attempt: memCached.attempt,
        cached: true,
      });
      return;
    }

    // 2. Query public.quizzes
    setState({ status: "checking" });
    try {
      const { data: existingQuiz, error: fetchErr } = await supabase
        .from("quizzes")
        .select("*")
        .eq("lecture_id", lecId)
        .eq("language", lang)
        .maybeSingle();

      if (fetchErr) {
        console.error("[QuizPanel] Supabase fetch error:", fetchErr);
        setState({ status: "error", message: "Failed to check quiz database." });
        return;
      }

      if (
        existingQuiz &&
        Array.isArray(existingQuiz.questions) &&
        existingQuiz.questions.length > 0
      ) {
        // Quiz found: check if this student has already submitted an attempt
        let attempt: QuizAttempt | null = null;
        if (userId) {
          const { data: attemptRow } = await supabase
            .from("quiz_attempts")
            .select("*")
            .eq("quiz_id", existingQuiz.id)
            .eq("student_id", userId)
            .maybeSingle();
          attempt = attemptRow ?? null;
        }

        sessionCache.current.set(lang, { quiz: existingQuiz, attempt });
        setState({
          status: "ready",
          quiz: existingQuiz,
          attempt,
          cached: true,
        });
        return;
      }

      // 3. Cache miss: generate quiz via Edge Function
      setState({ status: "generating" });
      await generateQuiz(lecId, lang);
    } catch (err: unknown) {
      console.error("[QuizPanel] loadQuiz error:", err);
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "An unexpected error occurred loading quiz.",
      });
    }
  }

  async function generateQuiz(lecId: string, lang: string) {
    try {
      const { data, error } = await supabase.functions.invoke("generate-quiz", {
        body: { lecture_id: lecId, language: lang },
      });

      if (error) {
        console.error("[QuizPanel] generate-quiz Edge Function error:", error);
        const msg = error.message ?? "";
        if (msg.toLowerCase().includes("caption") || msg.toLowerCase().includes("transcript")) {
          setState({ status: "no_captions" });
        } else {
          setState({
            status: "error",
            message: "Quiz generation failed. Please try again.",
          });
        }
        return;
      }

      type EdgeQuizRes = {
        ok: boolean;
        cached?: boolean;
        quiz?: {
          id?: string;
          lecture_id: string;
          language: string;
          questions: QuizQuestion[];
          created_at?: string;
        };
        error?: string;
      };

      const result = data as EdgeQuizRes;

      if (
        !result?.ok ||
        !result?.quiz ||
        !Array.isArray(result.quiz.questions) ||
        result.quiz.questions.length === 0
      ) {
        const serverMsg = result?.error ?? "No questions returned.";
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

      // If id was not returned in edge payload, query DB row
      let quizId = result.quiz.id;
      if (!quizId) {
        const { data: dbRow } = await supabase
          .from("quizzes")
          .select("id")
          .eq("lecture_id", lecId)
          .eq("language", lang)
          .maybeSingle();
        quizId = dbRow?.id ?? `${lecId}-${lang}`;
      }

      const fullQuiz: Quiz = {
        id: quizId,
        lecture_id: result.quiz.lecture_id,
        language: result.quiz.language,
        questions: result.quiz.questions as unknown as Json,
        created_at: result.quiz.created_at ?? new Date().toISOString(),
      };

      // Check if attempt exists for this quiz
      let attempt: QuizAttempt | null = null;
      if (userId && fullQuiz.id) {
        const { data: att } = await supabase
          .from("quiz_attempts")
          .select("*")
          .eq("quiz_id", fullQuiz.id)
          .eq("student_id", userId)
          .maybeSingle();
        attempt = att ?? null;
      }

      sessionCache.current.set(lang, { quiz: fullQuiz, attempt });
      setState({
        status: "ready",
        quiz: fullQuiz,
        attempt,
        cached: result.cached ?? false,
      });
    } catch (err: unknown) {
      console.error("[QuizPanel] generateQuiz error:", err);
      const msg = err instanceof Error ? err.message : "Failed to generate quiz.";
      if (msg.toLowerCase().includes("caption") || msg.toLowerCase().includes("transcript")) {
        setState({ status: "no_captions" });
      } else {
        setState({ status: "error", message: msg });
      }
    }
  }

  // Handle option selection
  function handleSelectOption(qIdx: number, optIdx: number) {
    setSelectedAnswers((prev) => ({
      ...prev,
      [qIdx]: optIdx,
    }));
  }

  // Submit quiz attempt
  async function handleSubmitAttempt(quiz: Quiz) {
    if (!userId) {
      alert("You must be signed in as a student to submit quiz attempts.");
      return;
    }

    const questions = (quiz.questions as unknown as QuizQuestion[]) || [];
    if (questions.length === 0) return;

    setSubmitting(true);
    try {
      // 1. Compute score and identify weak topics
      let score = 0;
      const total = questions.length;
      const rawWeakTopics: string[] = [];
      const answersArray: number[] = [];

      for (let i = 0; i < total; i++) {
        const q = questions[i];
        if (!q) continue;
        const selected = selectedAnswers[i] ?? -1;
        answersArray.push(selected);
        const correct = q.answer;

        if (selected === correct) {
          score += 1;
        } else {
          if (q.topic) {
            rawWeakTopics.push(q.topic);
          }
        }
      }

      // Unique weak topics
      const weakTopics = Array.from(new Set(rawWeakTopics));

      // 2. Upsert into public.quiz_attempts
      const { data: savedAttempt, error: upsertErr } = await supabase
        .from("quiz_attempts")
        .upsert(
          {
            quiz_id: quiz.id,
            student_id: userId,
            answers: answersArray,
            score,
            total,
            weak_topics: weakTopics,
            submitted_at: new Date().toISOString(),
          },
          { onConflict: "quiz_id,student_id" },
        )
        .select()
        .single();

      if (upsertErr || !savedAttempt) {
        throw new Error(upsertErr?.message || "Failed to save quiz attempt.");
      }

      // 3. Update session cache & state
      sessionCache.current.set(quizLang, { quiz, attempt: savedAttempt });
      setIsRetrying(false);
      setState({
        status: "ready",
        quiz,
        attempt: savedAttempt,
        cached: true,
      });
    } catch (err: unknown) {
      console.error("[QuizPanel] Error submitting attempt:", err);
      alert(err instanceof Error ? err.message : "Error submitting quiz.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleRetry() {
    if (!lectureId) return;
    sessionCache.current.delete(quizLang);
    setState({ status: "idle" });
    void loadQuiz(lectureId, quizLang);
  }

  const isGeneratingOrChecking = state.status === "generating" || state.status === "checking";

  return (
    <section className="glass glass-hover rounded-3xl p-5">
      {/* Header Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CircleCheck className="size-4 text-violet" />
          <h3 className="text-sm font-semibold">Post-Lecture MCQ Assessment</h3>
        </div>
        <StatusBadge state={state} isRetrying={isRetrying} />
      </div>

      {/* Language Switcher Bar */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {QUIZ_LANGUAGES.map((l) => {
          const cachedEntry = sessionCache.current.get(l.name);
          const hasAttempt = cachedEntry?.attempt !== null && cachedEntry?.attempt !== undefined;
          return (
            <button
              key={l.name}
              onClick={() => setQuizLang(l.name)}
              disabled={isGeneratingOrChecking || submitting}
              className={`relative flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-medium transition-all disabled:pointer-events-none disabled:opacity-50 ${
                quizLang === l.name
                  ? "neon-surface text-primary-foreground font-semibold"
                  : "glass text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{l.code}</span>
              <span className="hidden sm:inline">{l.name}</span>
              {hasAttempt && quizLang !== l.name && (
                <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-emerald shadow-[0_0_6px_var(--neon-emerald)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Main Interactive Content */}
      <QuizContent
        state={state}
        selectedAnswers={selectedAnswers}
        onSelectOption={handleSelectOption}
        onSubmitAttempt={handleSubmitAttempt}
        submitting={submitting}
        isRetrying={isRetrying}
        onStartRetry={() => {
          setSelectedAnswers({});
          setIsRetrying(true);
        }}
        onReload={handleRetry}
      />
    </section>
  );
}

// ── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ state, isRetrying }: { state: QuizState; isRetrying: boolean }) {
  if (state.status === "checking") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Checking quiz…
      </span>
    );
  }
  if (state.status === "generating") {
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-cyan">
        <Sparkles className="size-3 animate-pulse" /> Generating 5 questions…
      </span>
    );
  }
  if (state.status === "ready") {
    if (state.attempt && !isRetrying) {
      const pct = Math.round((state.attempt.score / (state.attempt.total || 5)) * 100);
      return (
        <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald">
          <Award className="size-3" /> Score: {state.attempt.score}/{state.attempt.total} ({pct}%)
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-[10px] text-cyan">
        <HelpCircle className="size-3" /> 5 Questions Ready
      </span>
    );
  }
  return null;
}

// ── Content Switcher ─────────────────────────────────────────────────────────
function QuizContent({
  state,
  selectedAnswers,
  onSelectOption,
  onSubmitAttempt,
  submitting,
  isRetrying,
  onStartRetry,
  onReload,
}: {
  state: QuizState;
  selectedAnswers: Record<number, number>;
  onSelectOption: (qIdx: number, optIdx: number) => void;
  onSubmitAttempt: (quiz: Quiz) => void;
  submitting: boolean;
  isRetrying: boolean;
  onStartRetry: () => void;
  onReload: () => void;
}) {
  if (state.status === "idle" || state.status === "checking") {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading quiz assessment…</span>
      </div>
    );
  }

  if (state.status === "generating") {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8">
        <div className="neon-surface flex size-10 items-center justify-center rounded-2xl">
          <Sparkles className="size-5 animate-pulse text-primary-foreground" />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Generating 5 conceptual multiple-choice questions from lecture transcript…
          <br />
          <span className="text-[10px] opacity-70">
            This takes 10–25 seconds. Questions will be cached after generation.
          </span>
        </p>
      </div>
    );
  }

  if (state.status === "no_lecture") {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <FileQuestion className="size-8 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">
          No active lecture found.
          <br />
          Join a lecture room to participate in quizzes.
        </p>
      </div>
    );
  }

  if (state.status === "no_captions") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Languages className="size-8 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">
          No lecture transcript available yet.
          <br />
          The quiz will generate once the teacher broadcasts equations or concepts.
        </p>
        <button
          onClick={onReload}
          className="glass glass-hover flex items-center gap-1.5 rounded-xl px-4 py-2 text-[11px] font-medium text-muted-foreground"
        >
          <RotateCcw className="size-3.5" /> Check again
        </button>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="flex items-center gap-2 text-rose-400">
          <AlertTriangle className="size-5" />
          <span className="text-xs font-medium">Quiz generation failed</span>
        </div>
        <p className="max-w-xs text-[11px] text-muted-foreground">{state.message}</p>
        <button
          onClick={onReload}
          className="glass glass-hover flex items-center gap-1.5 rounded-xl px-4 py-2 text-[11px] font-medium text-muted-foreground hover:text-rose-300"
        >
          <RotateCcw className="size-3.5" /> Retry
        </button>
      </div>
    );
  }

  if (state.status === "ready") {
    const questions = (state.quiz.questions as unknown as QuizQuestion[]) || [];

    // If an attempt exists and student is NOT retrying, display the Score & Answer Review View
    if (state.attempt && !isRetrying) {
      return (
        <QuizReviewView
          quiz={state.quiz}
          attempt={state.attempt}
          questions={questions}
          onRetake={onStartRetry}
        />
      );
    }

    // Otherwise, display interactive Taking View
    return (
      <QuizTakingView
        quiz={state.quiz}
        questions={questions}
        selectedAnswers={selectedAnswers}
        onSelectOption={onSelectOption}
        onSubmit={() => onSubmitAttempt(state.quiz)}
        submitting={submitting}
        isRetrying={isRetrying}
      />
    );
  }

  return null;
}

// ── View 1: Interactive Taking View ──────────────────────────────────────────
function QuizTakingView({
  quiz,
  questions,
  selectedAnswers,
  onSelectOption,
  onSubmit,
  submitting,
  isRetrying,
}: {
  quiz: Quiz;
  questions: QuizQuestion[];
  selectedAnswers: Record<number, number>;
  onSelectOption: (qIdx: number, optIdx: number) => void;
  onSubmit: () => void;
  submitting: boolean;
  isRetrying: boolean;
}) {
  const answeredCount = Object.keys(selectedAnswers).length;
  const allAnswered = answeredCount === questions.length;

  return (
    <div className="space-y-6">
      {/* Progress header */}
      <div className="glass flex items-center justify-between rounded-2xl px-4 py-2.5 text-xs">
        <span className="text-muted-foreground">
          {isRetrying ? "Retaking Quiz" : "Interactive Quiz"} ({quiz.language})
        </span>
        <span className="font-semibold text-cyan">
          {answeredCount} of {questions.length} answered
        </span>
      </div>

      {/* Questions list */}
      <div className="space-y-6">
        {questions.map((q, qIdx) => {
          const selectedOpt = selectedAnswers[qIdx];
          return (
            <div key={qIdx} className="glass rounded-2xl p-4.5 space-y-3">
              {/* Question Header & Topic */}
              <div className="flex items-start justify-between gap-3">
                <span className="neon-surface flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold">
                  {qIdx + 1}
                </span>
                <div className="flex-1 text-xs font-medium leading-relaxed">
                  <KaTeXContent text={q.question} />
                </div>
                {q.topic && (
                  <span className="glass shrink-0 rounded-full px-2.5 py-0.5 text-[10px] text-muted-foreground">
                    {q.topic}
                  </span>
                )}
              </div>

              {/* 4 Options */}
              <div className="grid gap-2 pt-1">
                {q.options.map((opt, optIdx) => {
                  const isSelected = selectedOpt === optIdx;
                  return (
                    <button
                      key={optIdx}
                      type="button"
                      onClick={() => onSelectOption(qIdx, optIdx)}
                      disabled={submitting}
                      className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-xs transition-all ${
                        isSelected
                          ? "neon-surface font-semibold text-primary-foreground shadow-md"
                          : "glass glass-hover text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span
                        className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold border ${
                          isSelected
                            ? "border-white bg-white/20 text-white"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {String.fromCharCode(65 + optIdx)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <KaTeXContent text={opt} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit Button */}
      <div className="flex items-center justify-between border-t border-border/40 pt-4">
        <span className="text-[11px] text-muted-foreground">
          {!allAnswered
            ? `Please answer all questions (${answeredCount}/${questions.length})`
            : "All questions answered. Ready to submit."}
        </span>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || answeredCount === 0}
          className="neon-surface flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold shadow-lg transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none"
        >
          {submitting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Evaluating…
            </>
          ) : (
            <>
              Submit Quiz <ChevronRight className="size-3.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── View 2: Score Summary & Detailed Answer Review View ───────────────────────
function QuizReviewView({
  quiz,
  attempt,
  questions,
  onRetake,
}: {
  quiz: Quiz;
  attempt: QuizAttempt;
  questions: QuizQuestion[];
  onRetake: () => void;
}) {
  const score = attempt.score;
  const total = attempt.total || questions.length || 5;
  const pct = Math.round((score / total) * 100);
  const weakTopics = attempt.weak_topics || [];
  const chosenAnswers = Array.isArray(attempt.answers) ? (attempt.answers as number[]) : [];

  return (
    <div className="space-y-6">
      {/* Score Summary Card */}
      <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5 border border-border/60">
        <div className="flex items-center gap-4">
          <div className="neon-surface flex size-14 shrink-0 items-center justify-center rounded-2xl shadow-lg">
            <Award className="size-7 text-primary-foreground" />
          </div>
          <div>
            <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
              Assessment Results ({quiz.language})
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {score} / {total}
              </span>
              <span
                className={`text-sm font-semibold ${
                  pct >= 80 ? "text-emerald" : pct >= 60 ? "text-amber-400" : "text-rose-400"
                }`}
              >
                ({pct}%)
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pct === 100
                ? "Perfect score! Outstanding conceptual grasp."
                : pct >= 80
                  ? "Great job! Strong understanding of the lecture principles."
                  : pct >= 60
                    ? "Satisfactory. Review the weak topics below to reinforce key concepts."
                    : "Review recommended. Examine the explanations below."}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onRetake}
          className="glass glass-hover flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium text-cyan hover:text-white"
        >
          <RotateCcw className="size-3.5" /> Retake Quiz
        </button>
      </div>

      {/* Weak Topics Analysis */}
      <div className="glass rounded-2xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-3.5 text-amber-400" />
          <h4 className="text-xs font-semibold">Identified Weak Topics</h4>
        </div>
        {weakTopics.length > 0 ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {weakTopics.map((topic, i) => (
              <span
                key={i}
                className="glass flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-rose-300 border border-rose-500/20 bg-rose-500/10"
              >
                <span className="size-1.5 rounded-full bg-rose-400" />
                {topic}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-emerald flex items-center gap-1.5 pt-1">
            <CheckCircle2 className="size-3.5" /> Mastery achieved — No weak topics detected! All
            tested concepts correctly answered.
          </p>
        )}
      </div>

      {/* Question-by-Question Review */}
      <div className="space-y-4">
        <h4 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Detailed Question Review
        </h4>

        {questions.map((q, qIdx) => {
          const userChoice = chosenAnswers[qIdx] ?? -1;
          const isCorrect = userChoice === q.answer;

          return (
            <div
              key={qIdx}
              className={`glass rounded-2xl p-4.5 space-y-3 border ${
                isCorrect ? "border-emerald/30" : "border-rose-500/30"
              }`}
            >
              {/* Question title & correctness indicator */}
              <div className="flex items-start justify-between gap-3">
                <span
                  className={`flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                    isCorrect ? "bg-emerald/20 text-emerald" : "bg-rose-500/20 text-rose-400"
                  }`}
                >
                  {qIdx + 1}
                </span>

                <div className="flex-1 text-xs font-medium leading-relaxed">
                  <KaTeXContent text={q.question} />
                </div>

                <div className="flex items-center gap-1.5">
                  {isCorrect ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald">
                      <CheckCircle2 className="size-3.5" /> Correct
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <XCircle className="size-3.5" /> Incorrect
                    </span>
                  )}
                </div>
              </div>

              {/* 4 Options review */}
              <div className="grid gap-1.5 pt-1">
                {q.options.map((opt, optIdx) => {
                  const isUserSelection = userChoice === optIdx;
                  const isCorrectOption = q.answer === optIdx;

                  let optCls = "glass text-muted-foreground opacity-80";
                  if (isCorrectOption) {
                    optCls =
                      "border border-emerald/50 bg-emerald/10 text-emerald font-semibold shadow-sm";
                  } else if (isUserSelection && !isCorrect) {
                    optCls = "border border-rose-500/50 bg-rose-500/10 text-rose-300 font-medium";
                  }

                  return (
                    <div
                      key={optIdx}
                      className={`flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs transition-colors ${optCls}`}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold border border-current">
                        {String.fromCharCode(65 + optIdx)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <KaTeXContent text={opt} />
                      </div>
                      {isCorrectOption && (
                        <span className="text-[10px] font-bold text-emerald">Correct Answer</span>
                      )}
                      {isUserSelection && !isCorrectOption && (
                        <span className="text-[10px] font-bold text-rose-400">Your Choice</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Educational Explanation & Topic */}
              {q.explanation && (
                <div className="glass mt-2 rounded-xl p-3 text-[11px] text-muted-foreground leading-relaxed border border-border/40">
                  <div className="mb-1 flex items-center justify-between text-[10px]">
                    <span className="font-semibold text-cyan uppercase tracking-wider">
                      Explanation
                    </span>
                    {q.topic && <span className="text-muted-foreground">Topic: {q.topic}</span>}
                  </div>
                  <KaTeXContent text={q.explanation} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

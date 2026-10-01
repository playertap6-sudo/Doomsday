import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  Bookmark,
  Send,
  Link2,
  Sparkles,
  Radio,
  Languages,
  LogOut,
  AlertTriangle,
  Film,
  History,
  Award,
  Loader2,
} from "lucide-react";

import { SpaceBackground } from "@/components/SpaceBackground";
import { WindowSwitcher } from "@/components/WindowSwitcher";
import { NotesPanel } from "@/components/NotesPanel";
import { QuizPanel } from "@/components/QuizPanel";
import { RecordedLecturePlayer } from "@/components/RecordedLecturePlayer";
import { useSession, signOut, LANGUAGES, saveSession, joinLecture } from "@/lib/session";
import { supabase, type Caption, type Lecture } from "@/lib/supabase";
import { filterProfanity } from "@/lib/content-filter";
import { AuthGuard } from "@/lib/auth-guard";

function ProtectedStudentPage() {
  return (
    <AuthGuard requiredRole="student">
      <StudentWorkspace />
    </AuthGuard>
  );
}

export const Route = createFileRoute("/student")({
  head: () => ({
    meta: [
      { title: "Student Workspace — EquaTranslate PRO" },
      {
        name: "description",
        content:
          "Live translated captions, rendered equations, bilingual smart notes and an AI inquiry assistant for your class.",
      },
      { property: "og:title", content: "Student Workspace — EquaTranslate PRO" },
      {
        property: "og:description",
        content: "Follow the lecture in your native language with live captions and equations.",
      },
    ],
  }),
  component: ProtectedStudentPage,
});

interface EnrolledLecture {
  lectureId: string;
  title: string;
  joinCode: string;
  status: string;
  joinedAt: string;
  quizScore?: { score: number; total: number } | null;
}

export function StudentWorkspace() {
  const session = useSession();

  // Active Lecture & Student State
  const [activeLecture, setActiveLecture] = useState<Lecture | null>(null);
  const [loadingLecture, setLoadingLecture] = useState(true);
  const [studentLang, setStudentLang] = useState<string>(session.language || "Tamil");
  const [switchingLang, setSwitchingLang] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joining, setJoining] = useState(false);

  // Captions
  const [allCaptions, setAllCaptions] = useState<Caption[]>([]);
  const [savedCaptions, setSavedCaptions] = useState<string[]>([]);
  const [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "disconnected">(
    "connecting",
  );

  // Enrolled Lectures History
  const [enrolledLectures, setEnrolledLectures] = useState<EnrolledLecture[]>([]);

  // ── Fetch Enrolled Lecture History ───────────────────────────────
  useEffect(() => {
    if (!session.userId) return;
    let isMounted = true;

    async function fetchEnrolledHistory() {
      const studentId = session.userId;
      if (!studentId) return;
      try {
        const { data: enrollments } = await supabase
          .from("lecture_students")
          .select("lecture_id, joined_at, lectures(*)")
          .eq("student_id", studentId)
          .order("joined_at", { ascending: false });

        if (!enrollments || !isMounted) return;

        // Fetch student's quiz attempts to display scores in history
        const { data: attempts } = await supabase
          .from("quiz_attempts")
          .select("quiz_id, score, total, quizzes(lecture_id)")
          .eq("student_id", studentId);

        const attemptMap = new Map<string, { score: number; total: number }>();
        if (attempts) {
          attempts.forEach((a) => {
            const lecId = (a.quizzes as unknown as { lecture_id: string } | null)?.lecture_id;
            if (lecId) {
              attemptMap.set(lecId, { score: a.score, total: a.total });
            }
          });
        }

        const list: EnrolledLecture[] = enrollments
          .filter((e) => e.lectures)
          .map((e) => {
            const lec = e.lectures as unknown as Lecture;
            return {
              lectureId: lec.id,
              title: lec.title || "Classroom Lecture",
              joinCode: lec.join_code,
              status: lec.status,
              joinedAt: e.joined_at,
              quizScore: attemptMap.get(lec.id) || null,
            };
          });

        if (isMounted) {
          setEnrolledLectures(list);
        }
      } catch (err) {
        console.warn("[Student] Error fetching history:", err);
      }
    }

    void fetchEnrolledHistory();

    return () => {
      isMounted = false;
    };
  }, [session.userId, activeLecture?.id]);

  function handleSelectLecture(lecId: string) {
    supabase
      .from("lectures")
      .select("*")
      .eq("id", lecId)
      .single()
      .then(({ data }) => {
        if (data) {
          setActiveLecture(data);
          setAllCaptions([]);
          saveSession({
            ...session,
            lectureId: data.id,
            joinCode: data.join_code,
            lectureTitle: data.title,
          });
        }
      });
  }

  async function handleJoinByCode(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const code = joinCodeInput.trim().toUpperCase();
    if (!code || joining) return;
    setJoining(true);
    try {
      const { lecture, error } = await joinLecture({ joinCode: code, language: studentLang });
      if (error) {
        alert(error);
      } else if (lecture) {
        setActiveLecture(lecture);
        setAllCaptions([]);
        setJoinCodeInput("");
        saveSession({
          ...session,
          lectureId: lecture.id,
          joinCode: lecture.join_code,
          lectureTitle: lecture.title,
        });
      }
    } catch (err) {
      console.error("[Student] Join error:", err);
    } finally {
      setJoining(false);
    }
  }

  // ── 1. Load Active Lecture ─────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    async function loadLecture() {
      setLoadingLecture(true);
      try {
        if (session.lectureId) {
          const { data } = await supabase
            .from("lectures")
            .select("*")
            .eq("id", session.lectureId)
            .maybeSingle();

          if (data && isMounted) {
            setActiveLecture(data);
            setLoadingLecture(false);

            // Guarantee student enrollment in lecture_students for RLS access & edge translation
            if (session.userId && data.id) {
              const { data: enr } = await supabase
                .from("lecture_students")
                .select("id, language")
                .eq("lecture_id", data.id)
                .eq("student_id", session.userId)
                .maybeSingle();

              if (!enr) {
                await supabase.from("lecture_students").insert({
                  lecture_id: data.id,
                  student_id: session.userId,
                  language: studentLang || session.language || "English",
                });
              } else if (enr.language) {
                setStudentLang(enr.language);
              }
            }
            return;
          }
        }

        // If not in session, find latest enrollment for this student
        if (session.userId) {
          const { data } = await supabase
            .from("lecture_students")
            .select("lecture_id, language, lectures(*)")
            .eq("student_id", session.userId)
            .order("joined_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (data && data.lectures && isMounted) {
            const lec = data.lectures as unknown as Lecture;
            setActiveLecture(lec);
            if (data.language) setStudentLang(data.language);
            saveSession({
              ...session,
              lectureId: lec.id,
              joinCode: lec.join_code,
              lectureTitle: lec.title,
              language: data.language || session.language,
            });
          }
        }
      } catch (err) {
        console.error("[Student] Error fetching lecture:", err);
      } finally {
        if (isMounted) setLoadingLecture(false);
      }
    }

    loadLecture();
    return () => {
      isMounted = false;
    };
  }, [session.lectureId, session.userId]);

  // ── 2. Listen to Lecture Status & Realtime Captions ────────────────
  useEffect(() => {
    if (!activeLecture?.id) return;

    let isMounted = true;
    setRealtimeStatus("connecting");

    // Fetch initial captions and MERGE with any already received via realtime
    async function fetchRecentCaptions() {
      const { data } = await supabase
        .from("captions")
        .select("*")
        .eq("lecture_id", activeLecture!.id)
        .order("created_at", { ascending: true })
        .limit(200);

      if (data && isMounted) {
        // Merge: keep any realtime captions not in the fetch result
        setAllCaptions((prev) => {
          const fetchedIds = new Set(data.map((c) => c.id));
          const realtimeOnly = prev.filter((c) => !fetchedIds.has(c.id));
          return [...data, ...realtimeOnly].slice(-200);
        });
        setRealtimeStatus("connected");
      }
    }

    fetchRecentCaptions();

    // Single multiplexed realtime channel for lecture updates and captions
    const channel = supabase
      .channel(`student-live:${activeLecture.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "captions",
          filter: `lecture_id=eq.${activeLecture.id}`,
        },
        (payload) => {
          if (!isMounted) return;
          const newCaption = payload.new as Caption;
          console.log("[REALTIME] INSERT received");
          // Dedup + cap at 200
          setAllCaptions((prev) => {
            if (prev.some((c) => c.id === newCaption.id)) return prev;
            return [...prev, newCaption].slice(-200);
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "lectures",
          filter: `id=eq.${activeLecture.id}`,
        },
        (payload) => {
          if (!isMounted) return;
          const updated = payload.new as Lecture;
          setActiveLecture(updated);
        },
      )
      .subscribe((status) => {
        console.log(`[REALTIME] subscribed: student-live:${activeLecture.id}`, status);
        if (isMounted) {
          if (status === "SUBSCRIBED") setRealtimeStatus("connected");
          else if (status === "CLOSED" || status === "CHANNEL_ERROR")
            setRealtimeStatus("disconnected");
        }
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [activeLecture?.id]);

  // ── 3. Dynamic Student Language Switching ──────────────────────────
  async function handleLanguageSwitch(newLang: string) {
    if (newLang === studentLang || switchingLang) return;
    setSwitchingLang(true);
    setStudentLang(newLang);
    saveSession({ ...session, language: newLang });

    if (activeLecture?.id && session.userId) {
      try {
        await supabase
          .from("lecture_students")
          .update({ language: newLang })
          .eq("lecture_id", activeLecture.id)
          .eq("student_id", session.userId);

        // Fetch recent captions for this new language and merge atomically
        const { data } = await supabase
          .from("captions")
          .select("*")
          .eq("lecture_id", activeLecture.id)
          .eq("language", newLang)
          .order("created_at", { ascending: true })
          .limit(50);

        // Always merge — even if data is empty, don't leave stale state
        setAllCaptions((prev) => {
          if (!data || data.length === 0) return prev;
          const newIds = new Set(data.map((c) => c.id));
          const kept = prev.filter((c) => !newIds.has(c.id));
          return [...kept, ...data].slice(-200);
        });
      } catch (err) {
        console.error("[Student] Error updating language in database:", err);
      } finally {
        setSwitchingLang(false);
      }
    } else {
      setSwitchingLang(false);
    }
  }

  // ── 4. Resolve Active Target and Source Captions ────────────────────
  const { targetCaption, sourceCaption, totalPhrases, sourceLang } = useMemo(() => {
    // Detect the teacher's source language from the first caption (chunk_index 0)
    const firstCaption = allCaptions.find((c) => c.chunk_index === 0);
    const detectedSourceLang = firstCaption?.language || "English";

    // 1. Target caption in student's chosen native language
    const targets = allCaptions.filter((c) => c.language === studentLang);
    const target = targets[targets.length - 1] || null;

    // 2. Corresponding source caption — prefer the detected source language, not random translations
    let source: Caption | null = null;
    if (target) {
      source =
        allCaptions.find(
          (c) => c.chunk_index === target.chunk_index && c.language === detectedSourceLang,
        ) || target;
    }
    if (!source) {
      const sourceLangCaptions = allCaptions.filter((c) => c.language === detectedSourceLang);
      source = sourceLangCaptions[sourceLangCaptions.length - 1] || target || null;
    }

    // 3. Distinct phrases count based on chunk_index
    const phrasesCount = new Set(allCaptions.map((c) => c.chunk_index ?? c.id)).size;

    return {
      targetCaption: target,
      sourceCaption: source,
      totalPhrases: phrasesCount,
      sourceLang: detectedSourceLang,
    };
  }, [allCaptions, studentLang]);

  const isLectureEnded = activeLecture?.status === "ended";

  return (
    <div className="relative min-h-screen">
      <SpaceBackground />

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-5 p-5 pb-28 lg:grid-cols-[240px_minmax(0,1fr)_340px]">
        {/* Column 1 — navigation & language picker */}
        <aside className="glass flex h-fit flex-col gap-5 rounded-3xl p-5 lg:sticky lg:top-5">
          <div className="flex items-center gap-3">
            <span className="neon-surface flex size-10 items-center justify-center rounded-full text-sm font-bold">
              {session.name ? session.name[0] : "S"}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{session.name || "Student"}</div>
              <div className="text-[11px] text-muted-foreground">Roll {session.rollId}</div>
            </div>
            <button
              onClick={() => signOut()}
              title="Logout"
              className="ml-auto text-muted-foreground hover:text-rose-400"
            >
              <LogOut className="size-4" />
            </button>
          </div>

          {/* Dynamic Language Switcher */}
          <div className="space-y-2 border-t border-border/40 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                Native Language
              </span>
              <span className="text-[10px] font-semibold text-cyan">{studentLang}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {LANGUAGES.map((l) => (
                <button
                  key={l.name}
                  onClick={() => handleLanguageSwitch(l.name)}
                  disabled={switchingLang}
                  className={`rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
                    studentLang === l.name
                      ? "neon-surface font-semibold text-primary-foreground"
                      : "glass text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="text-[10px] opacity-75">{l.code}</div>
                  <div className="truncate font-medium">{l.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Quick Join Room Input */}
          <form onSubmit={handleJoinByCode} className="space-y-2 border-t border-border/40 pt-4">
            <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              Join Lecture Room
            </span>
            <div className="flex gap-1.5">
              <input
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                placeholder="6-CHAR CODE"
                maxLength={6}
                className="w-full rounded-xl border border-border/40 bg-background/50 px-3 py-2 text-xs font-mono tracking-wider uppercase text-foreground placeholder:text-muted-foreground/50 focus:border-cyan/50 focus:outline-none"
              />
              <button
                type="submit"
                disabled={joining || !joinCodeInput.trim()}
                className="neon-surface flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50"
              >
                Join
              </button>
            </div>
          </form>

          {/* Enrolled Lecture History */}
          <div className="space-y-1 border-t border-border/40 pt-4">
            <div className="mb-2 flex items-center justify-between text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
              <span>My Lectures</span>
              <span className="font-semibold text-cyan">{enrolledLectures.length}</span>
            </div>

            <div className="space-y-1.5 max-h-[360px] overflow-y-auto scroll-slim pr-1">
              {enrolledLectures.length > 0 ? (
                enrolledLectures.map((lec) => {
                  const isCurrent = activeLecture?.id === lec.lectureId;
                  const isLive = lec.status === "live";
                  const isEnded = lec.status === "ended";

                  return (
                    <button
                      key={lec.lectureId}
                      onClick={() => handleSelectLecture(lec.lectureId)}
                      className={`w-full rounded-2xl p-2.5 text-left text-xs transition-all ${
                        isCurrent
                          ? "neon-surface text-primary-foreground shadow-sm"
                          : "glass glass-hover text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <span
                          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            isLive
                              ? "bg-emerald-500/20 text-emerald-300"
                              : isEnded
                                ? "bg-cyan/20 text-cyan"
                                : "bg-amber-400/20 text-amber-300"
                          }`}
                        >
                          {isLive ? "● LIVE" : isEnded ? "📼 RECORDED" : "⏳ SCHEDULED"}
                        </span>
                        <span className="font-mono text-[10px] opacity-75">{lec.joinCode}</span>
                      </div>

                      <div className="font-medium truncate text-xs">{lec.title}</div>

                      <div className="mt-1.5 flex items-center justify-between text-[10px] opacity-80">
                        <span>{new Date(lec.joinedAt).toLocaleDateString()}</span>
                        {lec.quizScore && (
                          <span className="flex items-center gap-0.5 text-emerald font-semibold">
                            <Award className="size-3" /> {lec.quizScore.score}/{lec.quizScore.total}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No enrolled lectures yet
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Column 2 — main workspace */}
        <main className="space-y-5">
          {/* Top Status Bar */}
          <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`size-2 rounded-full ${
                  isLectureEnded
                    ? "bg-rose-500"
                    : realtimeStatus === "connected"
                      ? "size-2 animate-pulse bg-emerald shadow-[0_0_12px_var(--neon-emerald)]"
                      : "bg-amber-400"
                }`}
              />
              <span className="text-muted-foreground">
                {isLectureEnded
                  ? "Lecture Ended"
                  : realtimeStatus === "connected"
                    ? `Live · Translated to ${studentLang}`
                    : "Connecting to Classroom Stream..."}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Radio className="size-3.5 text-violet" />
              <span>
                Room:{" "}
                <strong className="font-mono text-cyan">
                  {activeLecture?.join_code || "------"}
                </strong>
              </span>
              <span>·</span>
              <span>{activeLecture?.title || "Live Lecture"}</span>
            </div>
          </div>

          {/* Main Content Area: Recorded Lecture Player if Ended, else Live Caption HUD */}
          {isLectureEnded && activeLecture ? (
            <RecordedLecturePlayer
              lecture={activeLecture}
              studentLanguage={studentLang}
              captions={allCaptions}
            />
          ) : (
            /* Live Caption HUD */
            <section className="glass-strong rounded-3xl p-6">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                  Live Caption HUD ({studentLang})
                </span>
                <button
                  onClick={() => {
                    if (targetCaption?.id) {
                      setSavedCaptions((prev) =>
                        prev.includes(targetCaption.id)
                          ? prev.filter((id) => id !== targetCaption.id)
                          : [...prev, targetCaption.id],
                      );
                    }
                  }}
                  className={`glass glass-hover flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] ${
                    targetCaption && savedCaptions.includes(targetCaption.id)
                      ? "text-emerald"
                      : "text-muted-foreground"
                  }`}
                >
                  <Bookmark className="size-3.5" />
                  {targetCaption && savedCaptions.includes(targetCaption.id)
                    ? "Bookmarked"
                    : "Bookmark"}
                </button>
              </div>

              {/* Source Caption (Teacher Spoken Phrase) */}
              <p className="text-sm text-muted-foreground italic min-h-[20px]">
                {sourceCaption
                  ? `Teacher (${sourceCaption.language}): "${filterProfanity(sourceCaption.text)}"`
                  : "Listening for teacher speech..."}
              </p>

              {/* Target Native Caption */}
              <p className="mt-2 text-2xl leading-snug font-semibold min-h-[36px]">
                {targetCaption
                  ? filterProfanity(targetCaption.text)
                  : allCaptions.length > 0
                    ? "Translating phrase..."
                    : "Waiting for teacher broadcast to begin..."}
              </p>

              <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Total phrases received: {totalPhrases}</span>
                <span>Target: {studentLang}</span>
              </div>
            </section>
          )}

          {/* Summary Card */}
          <Card title="Lesson Summary" icon={Sparkles}>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {isLectureEnded
                ? "Lecture completed. Generate study notes below to access the lecture summary."
                : "Live lecture in progress. Study notes and summary will be available after the lecture concludes."}
            </p>
          </Card>

          {/* Real AI Notes Panel — replaces fake placeholder */}
          <NotesPanel lectureId={activeLecture?.id} defaultLanguage={studentLang} />

          {/* Real Multilingual AI Quiz Panel — replaces placeholder */}
          <QuizPanel
            lectureId={activeLecture?.id}
            defaultLanguage={studentLang}
            userId={session.userId}
          />
        </main>

        {/* Column 3 — AI Inquiry Assistant */}
        <AssistantPanel
          lectureId={activeLecture?.id}
          language={studentLang}
          captions={allCaptions.filter((c) => c.language === sourceLang)}
        />
      </div>

      <WindowSwitcher />
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <section className="glass glass-hover rounded-3xl p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-violet" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

type Msg = { from: "user" | "ai"; text: string };

interface AssistantPanelProps {
  lectureId?: string | undefined;
  language: string;
  captions?: Caption[] | undefined;
}

function AssistantPanel({ lectureId, language, captions = [] }: AssistantPanelProps) {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      from: "ai",
      text: `Inquiry assistant active in ${language}. Ask about concepts or questions explained in this lecture.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;

    setMsgs((m) => [...m, { from: "user", text: q }]);
    setInput("");
    setLoading(true);

    try {
      if (!lectureId) {
        setMsgs((m) => [
          ...m,
          {
            from: "ai",
            text: "No active lecture joined yet. Please join a live room to ask questions.",
          },
        ]);
        return;
      }

      // Collect recent captions for instant grounding
      const recentCaptions = captions.slice(-25).map((c) => c.text);

      const { data, error } = await supabase.functions.invoke("ask-assistant", {
        body: {
          lecture_id: lectureId,
          question: q,
          language,
          recent_captions: recentCaptions,
        },
      });

      if (error) {
        throw new Error(error.message || "Failed to contact AI assistant");
      }

      if (data && data.answer) {
        setMsgs((m) => [...m, { from: "ai", text: data.answer }]);
      } else {
        setMsgs((m) => [
          ...m,
          {
            from: "ai",
            text: "Unable to generate an answer. Please try rephrasing your question.",
          },
        ]);
      }
    } catch (err: unknown) {
      console.error("[AssistantPanel] Error:", err);
      const msg = err instanceof Error ? err.message : "Error contacting assistant";
      setMsgs((m) => [
        ...m,
        {
          from: "ai",
          text: `Assistant error: ${msg}. Please try again.`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="glass flex h-fit flex-col rounded-3xl p-5 lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)]">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-cyan" />
        <h3 className="text-sm font-semibold">Inquiry Assistant</h3>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Grounded on live class transcript</p>

      <div className="glass mt-4 flex items-start gap-2 rounded-2xl p-3">
        <Link2 className="mt-0.5 size-3.5 shrink-0 text-violet" />
        <p className="text-[11px] text-muted-foreground">
          Contextual stream linked to live lecture
        </p>
      </div>

      <div className="scroll-slim mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
              m.from === "user" ? "neon-surface ml-auto font-medium" : "glass text-muted-foreground"
            }`}
          >
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="glass flex max-w-[92%] items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-cyan" />
            <span>Analyzing live lecture transcript...</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="glass mt-3 flex items-center gap-2 rounded-2xl p-1.5"
      >
        <input
          value={input}
          disabled={loading}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about this lecture in ${language}...`}
          className="min-w-0 flex-1 bg-transparent px-2.5 text-xs outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="neon-surface flex size-8 shrink-0 items-center justify-center rounded-xl disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        </button>
      </form>
    </aside>
  );
}

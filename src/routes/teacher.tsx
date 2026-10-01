import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  Mic,
  MicOff,
  LayoutDashboard,
  Users,
  MessageSquareWarning,
  Settings,
  Hexagon,
  X,
  Languages,
  LogOut,
  Radio,
  PowerOff,
  Upload,
  BarChart3,
  Plus,
  Sparkles,
} from "lucide-react";

import { SpaceBackground } from "@/components/SpaceBackground";
import { WindowSwitcher } from "@/components/WindowSwitcher";
import {
  useSession,
  signOut,
  LANGUAGES,
  saveSession,
  createLecture,
  getStoredSession,
} from "@/lib/session";
import { supabase, type Caption, type Lecture } from "@/lib/supabase";
import { ReactRecorderAdapter, type RecorderState } from "@/lib/recorder-adapter";
import { AuthGuard } from "@/lib/auth-guard";
import { TeacherRecordingUploadModal } from "@/components/TeacherRecordingUpload";
import { TeacherAnalyticsView } from "@/components/TeacherAnalyticsView";
import { filterProfanity } from "@/lib/content-filter";

function ProtectedTeacherPage() {
  return (
    <AuthGuard requiredRole="teacher">
      <TeacherDashboard />
    </AuthGuard>
  );
}

export const Route = createFileRoute("/teacher")({
  head: () => ({
    meta: [
      { title: "Teacher Broadcast Studio — EquaTranslate PRO" },
      {
        name: "description",
        content:
          "Broadcast your lecture with live multi-language translation streams, class analytics and a student doubt escalation desk.",
      },
      { property: "og:title", content: "Teacher Broadcast Studio — EquaTranslate PRO" },
      {
        property: "og:description",
        content: "Live translated streams, analytics and doubt handling in one console.",
      },
    ],
  }),
  component: ProtectedTeacherPage,
});

const BARS = Array.from({ length: 36 }, (_, i) => i);

const LANG_COLORS: Record<string, string> = {
  English: "var(--neon-cyan)",
  Hindi: "var(--neon-violet)",
  Tamil: "var(--neon-emerald)",
  Telugu: "var(--neon-amber)",
  Malayalam: "#ec4899",
  Kannada: "#38bdf8",
};

export function TeacherDashboard() {
  const session = useSession();

  // Active Lecture State
  const [activeLecture, setActiveLecture] = useState<Lecture | null>(null);
  const [loadingLecture, setLoadingLecture] = useState(true);

  // Recorder State
  const [isMicActive, setIsMicActive] = useState(false);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [sourceLang, setSourceLang] = useState<string>(session.language || "English");
  const [liveInterim, setLiveInterim] = useState<string>("");
  const [lastFinalPhrase, setLastFinalPhrase] = useState<string>("");

  // Live Captions from Supabase
  const [captions, setCaptions] = useState<Caption[]>([]);

  // Enrolled Students
  const [enrolledStudents, setEnrolledStudents] = useState<
    { id: string; language: string; student_id: string }[]
  >([]);

  // Visualizer tick
  const [tick, setTick] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"studio" | "analytics">("studio");

  const recorderRef = useRef<ReactRecorderAdapter | null>(null);

  // ── 1. Fetch or restore active lecture ─────────────────────────────
  useEffect(() => {
    let isMounted = true;

    async function loadActiveLecture() {
      setLoadingLecture(true);
      try {
        if (session.lectureId) {
          const { data } = await supabase
            .from("lectures")
            .select("*")
            .eq("id", session.lectureId)
            .maybeSingle();

          if (data && isMounted) {
            // If the restored lecture is already ended, check if there is an active waiting/live one
            if (data.status === "ended" && session.userId) {
              const { data: activeLec } = await supabase
                .from("lectures")
                .select("*")
                .eq("teacher_id", session.userId)
                .in("status", ["waiting", "live"])
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();

              if (activeLec && isMounted) {
                setActiveLecture(activeLec);
                saveSession({
                  ...getStoredSession(),
                  lectureId: activeLec.id,
                  joinCode: activeLec.join_code,
                  lectureTitle: activeLec.title,
                });
                setLoadingLecture(false);
                return;
              }
            }

            setActiveLecture(data);
            setLoadingLecture(false);
            return;
          }
        }

        // Otherwise find most recent lecture by this teacher (prefer waiting/live first)
        if (session.userId) {
          const { data: activeLec } = await supabase
            .from("lectures")
            .select("*")
            .eq("teacher_id", session.userId)
            .in("status", ["waiting", "live"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (activeLec && isMounted) {
            setActiveLecture(activeLec);
            saveSession({
              ...getStoredSession(),
              lectureId: activeLec.id,
              joinCode: activeLec.join_code,
              lectureTitle: activeLec.title,
            });
            setLoadingLecture(false);
            return;
          }

          const { data } = await supabase
            .from("lectures")
            .select("*")
            .eq("teacher_id", session.userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (data && isMounted) {
            setActiveLecture(data);
            saveSession({
              ...getStoredSession(),
              lectureId: data.id,
              joinCode: data.join_code,
              lectureTitle: data.title,
            });
          }
        }
      } catch (err) {
        console.error("[Teacher] Error loading lecture:", err);
      } finally {
        if (isMounted) setLoadingLecture(false);
      }
    }

    loadActiveLecture();
    return () => {
      isMounted = false;
    };
  }, [session.lectureId, session.userId]);

  // Log active lecture state for debugging
  useEffect(() => {
    if (activeLecture) {
      console.log(
        `[TEACHER] active lecture: ${activeLecture.id} ("${activeLecture.title}", code: ${activeLecture.join_code})`,
      );
      console.log(`[TEACHER] lecture status: ${activeLecture.status}`);
    }
  }, [activeLecture]);

  // ── 2. Subscribe to Enrolled Students (Counts & Language Distribution) ──
  useEffect(() => {
    if (!activeLecture?.id) return;

    let isMounted = true;

    async function fetchEnrollments() {
      const { data, error } = await supabase
        .from("lecture_students")
        .select("id, language, student_id")
        .eq("lecture_id", activeLecture!.id);

      if (!error && data && isMounted) {
        setEnrolledStudents(data);
      }
    }

    fetchEnrollments();

    // Realtime channel for enrollments
    const enrollChannel = supabase
      .channel(`teacher-enroll:${activeLecture.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lecture_students",
          filter: `lecture_id=eq.${activeLecture.id}`,
        },
        () => {
          fetchEnrollments();
        },
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(enrollChannel);
    };
  }, [activeLecture?.id]);

  // ── 3. Subscribe to Realtime Captions ──────────────────────────────
  useEffect(() => {
    if (!activeLecture?.id) return;

    let isMounted = true;

    async function loadInitialCaptions() {
      const { data } = await supabase
        .from("captions")
        .select("*")
        .eq("lecture_id", activeLecture!.id)
        .order("created_at", { ascending: false })
        .limit(40);

      if (data && isMounted) {
        // Merge: keep any realtime captions that arrived during fetch
        setCaptions((prev) => {
          const fetchedIds = new Set(data.map((c) => c.id));
          const realtimeOnly = prev.filter((c) => !fetchedIds.has(c.id));
          return [...data.reverse(), ...realtimeOnly].slice(-40);
        });
      }
    }

    loadInitialCaptions();

    const captionsChannel = supabase
      .channel(`teacher-captions:${activeLecture.id}`)
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
          // Dedup + cap at 40
          setCaptions((prev) => {
            if (prev.some((c) => c.id === newCaption.id)) return prev;
            return [...prev.slice(-39), newCaption];
          });
        },
      )
      .subscribe((status) => {
        console.log(`[REALTIME] subscribed: teacher-captions:${activeLecture.id}`, status);
      });

    return () => {
      isMounted = false;
      supabase.removeChannel(captionsChannel);
    };
  }, [activeLecture?.id]);

  // ── 3b. Cleanup: stop recorder if component unmounts while mic is active ──
  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        recorderRef.current.stop();
        recorderRef.current = null;
      }
    };
  }, []);

  // ── 4. Waveform Animation Tick ─────────────────────────────────────
  useEffect(() => {
    if (!isMicActive) return;
    const interval = setInterval(() => setTick((v) => v + 1), 160);
    return () => clearInterval(interval);
  }, [isMicActive]);

  async function handleCreateNewLecture(customTitle?: string): Promise<Lecture | null> {
    const title =
      customTitle ||
      `Live Classroom ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    const { lecture, error } = await createLecture({ title });
    if (lecture) {
      setActiveLecture(lecture);
      saveSession({
        ...session,
        lectureId: lecture.id,
        joinCode: lecture.join_code,
        lectureTitle: lecture.title,
      });
      setStatusNotice(`Created fresh live classroom! Room code: ${lecture.join_code}`);
      return lecture;
    } else {
      setStatusNotice(`Failed to create lecture: ${error || "Unknown error"}`);
      return null;
    }
  }

  // ── 5. Microphone Controller ───────────────────────────────────────
  async function toggleMicrophone() {
    let targetLecture = activeLecture;

    if (!targetLecture?.id || targetLecture.status === "ended") {
      const created = await handleCreateNewLecture();
      if (!created) return;
      targetLecture = created;
    }

    if (isMicActive) {
      // Stop
      recorderRef.current?.stop();
      recorderRef.current = null;
      setIsMicActive(false);
      setLiveInterim("");
      setRecorderState("idle");
    } else {
      // Start
      console.log("[TEACHER] source language:", sourceLang);
      console.log("[TEACHER] active lecture ID:", targetLecture.id);

      const adapter = new ReactRecorderAdapter(targetLecture.id, sourceLang, {
        onInterimTranscript: (text) => setLiveInterim(text),
        onFinalTranscript: (text) => {
          console.log("[TEACHER] transcript:", text);
          setLiveInterim("");
          setLastFinalPhrase(text);
        },
        onError: (err) => setStatusNotice(err),
        onStateChange: (state) => setRecorderState(state),
      });

      recorderRef.current = adapter;
      setIsMicActive(true);
      await adapter.start();

      // If lecture was waiting, update status to live
      if (targetLecture.status === "waiting") {
        await supabase
          .from("lectures")
          .update({ status: "live", started_at: new Date().toISOString() })
          .eq("id", targetLecture.id);
        setActiveLecture((prev) => (prev ? { ...prev, status: "live" } : null));
      }
    }
  }

  function handleLanguageChange(newLang: string) {
    setSourceLang(newLang);
    recorderRef.current?.setSourceLanguage(newLang);
    saveSession({ ...session, language: newLang });
  }

  async function handleEndLecture() {
    if (!activeLecture?.id) return;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsMicActive(false);
    setRecorderState("idle");

    const { error } = await supabase
      .from("lectures")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", activeLecture.id);

    if (!error) {
      setActiveLecture((prev) => (prev ? { ...prev, status: "ended" } : null));
      setStatusNotice("Lecture has been ended successfully.");
    }
  }

  // Calculate live language distribution
  const distribution = useMemo(() => {
    const total = enrolledStudents.length;
    if (total === 0) return [];

    const counts: Record<string, number> = {};
    enrolledStudents.forEach((s) => {
      const l = s.language || "English";
      counts[l] = (counts[l] || 0) + 1;
    });

    return Object.entries(counts).map(([lang, count]) => ({
      lang,
      count,
      pct: Math.round((count / total) * 100),
      color: LANG_COLORS[lang] || "var(--neon-cyan)",
    }));
  }, [enrolledStudents]);

  // Group latest captions by student languages
  const activeStreams = useMemo(() => {
    // Collect distinct enrolled languages
    const studentLangs = [...new Set(enrolledStudents.map((s) => s.language))];
    if (studentLangs.length === 0) {
      // Default to sourceLang and any captured languages
      const capturedLangs = [...new Set(captions.map((c) => c.language))];
      return (capturedLangs.length > 0 ? capturedLangs : [sourceLang]).slice(0, 3).map((l) => ({
        lang: l,
        color: LANG_COLORS[l] || "var(--neon-cyan)",
        lines: captions
          .filter((c) => c.language === l)
          .slice(-2)
          .map((c) => c.text),
      }));
    }

    return studentLangs.slice(0, 3).map((l) => ({
      lang: l,
      color: LANG_COLORS[l] || "var(--neon-cyan)",
      lines: captions
        .filter((c) => c.language === l)
        .slice(-2)
        .map((c) => c.text),
    }));
  }, [enrolledStudents, captions, sourceLang]);

  return (
    <div className="relative min-h-screen">
      <SpaceBackground />

      <div className="mx-auto flex max-w-[1500px] gap-5 p-5 pb-28">
        <aside className="glass sticky top-5 hidden h-fit w-[76px] flex-col items-center gap-2 rounded-3xl py-5 lg:flex">
          <span className="neon-surface mb-4 flex size-10 items-center justify-center rounded-2xl">
            <Hexagon className="size-4" strokeWidth={2.5} />
          </span>
          <button
            onClick={() => setActiveTab("studio")}
            title="Live Broadcast Studio"
            className={`flex size-11 items-center justify-center rounded-2xl transition-colors ${
              activeTab === "studio"
                ? "glass-strong text-cyan"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutDashboard className="size-4.5" />
          </button>
          <button
            onClick={() => setActiveTab("analytics")}
            title="Class Analytics & Insights"
            className={`flex size-11 items-center justify-center rounded-2xl transition-colors ${
              activeTab === "analytics"
                ? "glass-strong text-cyan"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BarChart3 className="size-4.5" />
          </button>
          {[Users, MessageSquareWarning, Languages, Settings].map((Icon, i) => (
            <button
              key={i}
              className="flex size-11 items-center justify-center rounded-2xl text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon className="size-4.5" />
            </button>
          ))}
          <button
            onClick={() => signOut()}
            title="Logout"
            className="mt-6 flex size-11 items-center justify-center rounded-2xl text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
          >
            <LogOut className="size-4.5" />
          </button>
        </aside>

        <main className="min-w-0 flex-1 space-y-5">
          {/* Header Bar */}
          <header className="glass flex flex-wrap items-center justify-between gap-4 rounded-3xl px-6 py-5">
            <div>
              <h1 className="text-xl font-semibold">
                Good Morning, {session.name || "Professor"} 👋
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={`size-2 rounded-full ${
                    activeLecture?.status === "live"
                      ? "bg-emerald shadow-[0_0_10px_var(--neon-emerald)]"
                      : activeLecture?.status === "waiting"
                        ? "bg-amber-400"
                        : "bg-rose-500"
                  }`}
                />
                <span className="capitalize text-foreground font-medium">
                  {activeLecture?.status || "Waiting"}
                </span>
                <span>·</span>
                <span>
                  Room Code:{" "}
                  <strong className="font-mono text-cyan tracking-wider">
                    {activeLecture?.join_code || session.joinCode || "------"}
                  </strong>
                </span>
                <span>·</span>
                <span>{activeLecture?.title || session.lectureTitle || "Classroom Lecture"}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Studio / Analytics View Tabs */}
              <div className="flex items-center rounded-2xl glass p-1 gap-1">
                <button
                  onClick={() => setActiveTab("studio")}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    activeTab === "studio"
                      ? "bg-cyan/20 text-cyan shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Radio className="size-3.5" /> Studio
                </button>
                <button
                  onClick={() => setActiveTab("analytics")}
                  className={`flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    activeTab === "analytics"
                      ? "bg-cyan/20 text-cyan shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <BarChart3 className="size-3.5" /> Analytics
                </button>
              </div>

              <button
                onClick={() => handleCreateNewLecture()}
                className="glass glass-hover flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-cyan hover:text-cyan/80 transition-transform hover:-translate-y-0.5"
              >
                <Plus className="size-3.5" /> New Live Class
              </button>

              {activeLecture?.status !== "ended" && (
                <button
                  onClick={handleEndLecture}
                  className="glass glass-hover flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-medium text-rose-400 hover:text-rose-300"
                >
                  <PowerOff className="size-3.5" /> End Lecture
                </button>
              )}

              <button
                onClick={() => setUploadOpen(true)}
                className="glass glass-hover flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-foreground transition-transform hover:-translate-y-0.5"
              >
                <Upload className="size-3.5 text-cyan" /> Upload Recording
              </button>
            </div>
          </header>

          {statusNotice && (
            <div className="glass flex items-center justify-between rounded-2xl border border-cyan/30 px-5 py-3 text-xs text-cyan">
              <span>{statusNotice}</span>
              <button
                onClick={() => setStatusNotice(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {activeTab === "analytics" ? (
            <TeacherAnalyticsView
              teacherId={session.userId || ""}
              currentLecture={activeLecture}
              onSelectLecture={(lec) => {
                setActiveLecture(lec);
                saveSession({
                  ...session,
                  lectureId: lec.id,
                  joinCode: lec.join_code,
                  lectureTitle: lec.title,
                });
              }}
            />
          ) : (
            <>
              {/* Live Studio HUD */}
              <section className="glass-strong rounded-3xl p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                      Live Studio HUD
                    </span>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Source Speech Language:</span>
                      <div className="flex flex-wrap gap-1">
                        {LANGUAGES.map((l) => (
                          <button
                            key={l.name}
                            onClick={() => handleLanguageChange(l.name)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
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
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="glass rounded-full px-3 py-1 text-[11px] font-medium capitalize text-cyan">
                      Status: {recorderState}
                    </span>

                    <button
                      onClick={toggleMicrophone}
                      disabled={loadingLecture}
                      className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-semibold transition-all ${
                        isMicActive
                          ? "neon-surface shadow-lg text-primary-foreground"
                          : activeLecture?.status === "ended"
                            ? "border border-cyan/40 bg-cyan/15 text-cyan hover:bg-cyan/25"
                            : "glass text-foreground hover:text-cyan"
                      }`}
                    >
                      {isMicActive ? (
                        <Mic className="size-4 text-emerald" />
                      ) : activeLecture?.status === "ended" ? (
                        <Sparkles className="size-4 text-cyan" />
                      ) : (
                        <Radio className="size-4 text-cyan" />
                      )}
                      {isMicActive
                        ? "Stop Mic"
                        : activeLecture?.status === "ended"
                          ? "Start New Live Class"
                          : activeLecture?.status === "waiting"
                            ? "Start Live Class"
                            : "Start Mic"}
                    </button>
                  </div>
                </div>

                {/* Live Audio Visualizer */}
                <div className="glass mt-5 flex h-32 items-end justify-center gap-[3px] overflow-hidden rounded-2xl px-4 py-4">
                  {BARS.map((b) => {
                    const h = isMicActive
                      ? Math.round(
                          14 +
                            Math.abs(Math.sin((tick + b * 1.7) / 3.4)) *
                              80 *
                              (1 - Math.abs(b - 18) / 42),
                        )
                      : 6;
                    return (
                      <span
                        key={b}
                        className="w-1.5 rounded-full transition-[height] duration-150"
                        style={{
                          height: `${h}%`,
                          background: "var(--gradient-neon)",
                          opacity: isMicActive ? Math.round(50 + h / 2) / 100 : 0.25,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Live Speech Recognition Transcript Box */}
                <div className="glass mt-4 rounded-2xl p-4">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Radio className="size-3.5 text-cyan animate-pulse" />
                      Live Teacher Transcription ({sourceLang})
                    </span>
                    <span className="text-[10px]">Web Speech API</span>
                  </div>
                  <div className="mt-2 min-h-10 text-sm">
                    {liveInterim ? (
                      <span className="italic text-cyan">{filterProfanity(liveInterim)}</span>
                    ) : lastFinalPhrase ? (
                      <span className="text-foreground">{filterProfanity(lastFinalPhrase)}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {isMicActive
                          ? "Listening for speech... Start speaking into your microphone."
                          : "Microphone idle. Click Start Mic to broadcast."}
                      </span>
                    )}
                  </div>
                </div>

                {/* Real Translated Stream Cards */}
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {activeStreams.length > 0 ? (
                    activeStreams.map((s) => (
                      <div key={s.lang} className="glass glass-hover rounded-2xl p-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2 rounded-full"
                            style={{ background: s.color, boxShadow: `0 0 10px ${s.color}` }}
                          />
                          <span className="text-xs font-semibold" style={{ color: s.color }}>
                            {s.lang}
                          </span>
                          <span className="ml-auto text-[10px] text-muted-foreground">Live</span>
                        </div>
                        <div className="mt-2.5 min-h-[42px] space-y-1 text-xs text-muted-foreground">
                          {s.lines.length > 0 ? (
                            s.lines.map((l, i) => <p key={i}>{filterProfanity(l)}</p>)
                          ) : (
                            <p className="italic text-[11px]">Waiting for speech...</p>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="glass col-span-3 rounded-2xl p-6 text-center text-xs text-muted-foreground">
                      Waiting for students to join in their native languages...
                    </div>
                  )}
                </div>
              </section>

              {/* Bottom Grid: Analytics & Doubts */}
              <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
                {/* Live Language Distribution */}
                <section className="glass rounded-3xl p-6">
                  <h3 className="text-sm font-semibold">Live Language Distribution</h3>
                  <p className="text-[11px] text-muted-foreground">
                    {enrolledStudents.length}{" "}
                    {enrolledStudents.length === 1 ? "student" : "students"} connected
                  </p>

                  <Donut distribution={distribution} totalCount={enrolledStudents.length} />

                  <div className="mt-5 space-y-2">
                    {distribution.length > 0 ? (
                      distribution.map((d) => (
                        <div key={d.lang} className="flex items-center gap-2 text-xs">
                          <span
                            className="size-2 rounded-full"
                            style={{ background: d.color, boxShadow: `0 0 10px ${d.color}` }}
                          />
                          <span className="text-muted-foreground">{d.lang}</span>
                          <span className="ml-auto font-medium">
                            {d.pct}% ({d.count})
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-center text-xs text-muted-foreground pt-3">
                        No students currently connected
                      </p>
                    )}
                  </div>
                </section>

                {/* Student Doubt Escalation Desk */}
                <section className="glass rounded-3xl p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold">Student Doubt Escalation Desk</h3>
                    <span className="glass rounded-full px-2.5 py-1 text-[10px] text-cyan">
                      Live Classroom
                    </span>
                  </div>

                  <div className="mt-4 flex min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-border/40 p-6 text-center text-xs text-muted-foreground">
                    Student doubts and questions raised during this lecture will escalate here in
                    real-time.
                  </div>
                </section>
              </div>
            </>
          )}
        </main>
      </div>

      {uploadOpen && (
        <TeacherRecordingUploadModal
          currentLecture={activeLecture}
          onClose={() => setUploadOpen(false)}
          onLectureCreatedOrUpdated={(lec) => {
            setActiveLecture(lec);
            setUploadOpen(false);
          }}
        />
      )}
      <WindowSwitcher />
    </div>
  );
}

function Donut({
  distribution,
  totalCount,
}: {
  distribution: { lang: string; pct: number; color: string }[];
  totalCount: number;
}) {
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="relative mx-auto mt-5 size-40">
      <svg viewBox="0 0 140 140" className="size-full -rotate-90">
        {distribution.map((d) => {
          const len = (d.pct / 100) * C;
          const dash = `${len} ${C - len}`;
          const el = (
            <circle
              key={d.lang}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={d.color}
              strokeWidth="14"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              opacity={0.9}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold">{totalCount}</span>
        <span className="text-[10px] text-muted-foreground">connected</span>
      </div>
    </div>
  );
}

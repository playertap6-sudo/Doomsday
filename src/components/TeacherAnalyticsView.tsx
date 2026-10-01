// src/components/TeacherAnalyticsView.tsx
// Comprehensive Real Teacher Analytics Dashboard for EquaTranslate PRO.
// Displays live enrolled student counts, real language distribution, quiz attempts,
// average/high/low scores, score distribution, aggregated weak topics, and per-student performance.

import { useEffect, useState, useMemo } from "react";
import {
  Users,
  Award,
  AlertTriangle,
  BarChart3,
  Calendar,
  RotateCw,
  CheckCircle2,
  FileQuestion,
  BookOpen,
  ChevronDown,
  Layers,
  Percent,
} from "lucide-react";
import { supabase, type Lecture, type QuizAttempt } from "@/lib/supabase";

const LANG_COLORS: Record<string, string> = {
  English: "var(--neon-cyan)",
  Hindi: "var(--neon-amber)",
  Tamil: "var(--neon-emerald)",
  Malayalam: "var(--neon-violet)",
  Kannada: "var(--neon-rose)",
  Telugu: "var(--neon-violet)",
};

interface TeacherLectureOverview extends Lecture {
  studentsCount: number;
  quizzesCount: number;
  notesCount: number;
  attemptsCount: number;
}

interface EnrolledStudentItem {
  id: string;
  studentId: string;
  language: string;
  joinedAt: string;
  attempt?: QuizAttempt | null;
}

export function TeacherAnalyticsView({
  teacherId,
  currentLecture,
  onSelectLecture,
}: {
  teacherId: string;
  currentLecture: Lecture | null;
  onSelectLecture: (lecture: Lecture) => void;
}) {
  const [allLectures, setAllLectures] = useState<TeacherLectureOverview[]>([]);
  const [selectedLectureId, setSelectedLectureId] = useState<string | null>(
    currentLecture?.id || null,
  );

  // Analytics for the selected lecture
  const [enrolledStudents, setEnrolledStudents] = useState<EnrolledStudentItem[]>([]);
  const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  // Update selectedLectureId if currentLecture changes from outside
  useEffect(() => {
    if (currentLecture?.id && currentLecture.id !== selectedLectureId) {
      setSelectedLectureId(currentLecture.id);
    }
  }, [currentLecture?.id]);

  // Load all lectures owned by this teacher
  useEffect(() => {
    let isMounted = true;

    async function loadTeacherLectures() {
      try {
        const { data: lecs, error } = await supabase
          .from("lectures")
          .select("*, lecture_students(count), quizzes(count), notes(count)")
          .eq("teacher_id", teacherId)
          .order("created_at", { ascending: false });

        if (error || !lecs || !isMounted) return;

        // Fetch attempt counts per lecture
        const { data: allAttempts } = await supabase
          .from("quiz_attempts")
          .select("quiz_id, quizzes!inner(lecture_id)");

        const attemptCountMap = new Map<string, number>();
        if (allAttempts) {
          allAttempts.forEach((a) => {
            const lId = (a.quizzes as unknown as { lecture_id: string })?.lecture_id;
            if (lId) {
              attemptCountMap.set(lId, (attemptCountMap.get(lId) || 0) + 1);
            }
          });
        }

        const formatted: TeacherLectureOverview[] = lecs.map((l) => ({
          ...l,
          studentsCount: (l.lecture_students as unknown as [{ count: number }])?.[0]?.count || 0,
          quizzesCount: (l.quizzes as unknown as [{ count: number }])?.[0]?.count || 0,
          notesCount: (l.notes as unknown as [{ count: number }])?.[0]?.count || 0,
          attemptsCount: attemptCountMap.get(l.id) || 0,
        }));

        if (isMounted) {
          setAllLectures(formatted);
          if (!selectedLectureId && formatted.length > 0) {
            const first = formatted[0];
            if (first) {
              setSelectedLectureId(first.id);
            }
          }
        }
      } catch (err) {
        console.warn("[TeacherAnalytics] Error fetching lectures:", err);
      }
    }

    void loadTeacherLectures();

    return () => {
      isMounted = false;
    };
  }, [teacherId]);

  // Load deep analytics for the selected lecture
  useEffect(() => {
    const currentLecId = selectedLectureId;
    if (!currentLecId) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadLectureAnalytics(lecId: string) {
      setLoading(true);
      try {
        // 1. Fetch enrolled students
        const { data: students } = await supabase
          .from("lecture_students")
          .select("id, student_id, language, joined_at")
          .eq("lecture_id", lecId);

        // 2. Fetch quiz attempts for this lecture
        const { data: atts } = await supabase
          .from("quiz_attempts")
          .select("*, quizzes!inner(lecture_id, language)")
          .eq("quizzes.lecture_id", lecId);

        if (!isMounted) return;

        const attemptStudentMap = new Map<string, QuizAttempt>();
        if (atts) {
          setAttempts(atts);
          atts.forEach((a) => {
            attemptStudentMap.set(a.student_id, a);
          });
        } else {
          setAttempts([]);
        }

        if (students) {
          const studentItems: EnrolledStudentItem[] = students.map((s) => ({
            id: s.id,
            studentId: s.student_id,
            language: s.language || "English",
            joinedAt: s.joined_at,
            attempt: attemptStudentMap.get(s.student_id) || null,
          }));
          setEnrolledStudents(studentItems);
        } else {
          setEnrolledStudents([]);
        }
      } catch (err) {
        console.warn("[TeacherAnalytics] Error loading details:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void loadLectureAnalytics(currentLecId);

    return () => {
      isMounted = false;
    };
  }, [selectedLectureId]);

  const activeLectureData = allLectures.find((l) => l.id === selectedLectureId) || currentLecture;

  // ── Computations from real data ───────────────────────────────────────────
  // 1. Real Language Distribution
  const languageDistribution = useMemo(() => {
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

  // 2. Quiz Performance Stats
  const quizStats = useMemo(() => {
    const totalAttempts = attempts.length;
    if (totalAttempts === 0) {
      return {
        count: 0,
        avgScore: 0,
        avgPct: 0,
        highScore: 0,
        lowScore: 0,
        participationPct: 0,
        distribution: [0, 0, 0, 0, 0, 0], // counts for scores 0, 1, 2, 3, 4, 5
      };
    }

    let sum = 0;
    let high = -Infinity;
    let low = Infinity;
    const dist = [0, 0, 0, 0, 0, 0];

    attempts.forEach((a) => {
      const score = a.score || 0;
      sum += score;
      if (score > high) high = score;
      if (score < low) low = score;
      const idx = Math.min(Math.max(score, 0), 5);
      dist[idx] = (dist[idx] || 0) + 1;
    });

    const avg = sum / totalAttempts;
    const participation =
      enrolledStudents.length > 0
        ? Math.round((totalAttempts / enrolledStudents.length) * 100)
        : 100;

    return {
      count: totalAttempts,
      avgScore: Number(avg.toFixed(1)),
      avgPct: Math.round((avg / 5) * 100),
      highScore: high === -Infinity ? 0 : high,
      lowScore: low === Infinity ? 0 : low,
      participationPct: Math.min(participation, 100),
      distribution: dist,
    };
  }, [attempts, enrolledStudents.length]);

  // 3. Aggregated Weak Topics
  const weakTopicsSummary = useMemo(() => {
    const topicCounts: Record<string, number> = {};

    attempts.forEach((a) => {
      if (Array.isArray(a.weak_topics)) {
        a.weak_topics.forEach((t) => {
          if (t && typeof t === "string") {
            topicCounts[t] = (topicCounts[t] || 0) + 1;
          }
        });
      }
    });

    return Object.entries(topicCounts)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count);
  }, [attempts]);

  function handleLectureSelect(id: string) {
    setSelectedLectureId(id);
    const lec = allLectures.find((l) => l.id === id);
    if (lec) {
      onSelectLecture(lec);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Controls & Lecture Selector */}
      <div className="glass flex flex-wrap items-center justify-between gap-4 rounded-3xl p-5">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="size-5 text-cyan" />
            <h2 className="text-base font-semibold">Teacher Analytics & Classroom Insights</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Real performance telemetry, language distribution, and conceptual weaknesses
          </p>
        </div>

        {/* Lecture Dropdown */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={selectedLectureId || ""}
              onChange={(e) => handleLectureSelect(e.target.value)}
              className="glass appearance-none rounded-xl border border-border/60 bg-black/40 py-2 pl-3.5 pr-8 text-xs font-medium text-foreground outline-none focus:border-cyan/50"
            >
              {allLectures.map((l) => (
                <option key={l.id} value={l.id} className="bg-card text-foreground">
                  [{l.join_code}] {l.title} ({l.status})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          </div>

          <button
            onClick={() => {
              if (selectedLectureId) {
                setSelectedLectureId(selectedLectureId);
              }
            }}
            title="Refresh analytics"
            className="glass glass-hover flex size-9 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
          >
            <RotateCw className="size-4" />
          </button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1: Enrolled Students */}
        <div className="glass rounded-3xl p-5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-medium uppercase tracking-wider">
              Enrolled Students
            </span>
            <Users className="size-4 text-cyan" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {enrolledStudents.length}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {enrolledStudents.length === 1
              ? "1 student connected"
              : `${enrolledStudents.length} students connected`}
          </p>
        </div>

        {/* Metric 2: Quiz Attempts */}
        <div className="glass rounded-3xl p-5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-medium uppercase tracking-wider">
              Quiz Submissions
            </span>
            <Award className="size-4 text-emerald" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">{quizStats.count}</div>
          <p className="text-[11px] text-muted-foreground">
            {enrolledStudents.length > 0
              ? `${quizStats.participationPct}% participation rate`
              : "No students enrolled"}
          </p>
        </div>

        {/* Metric 3: Average Score */}
        <div className="glass rounded-3xl p-5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-medium uppercase tracking-wider">
              Class Average Score
            </span>
            <Percent className="size-4 text-violet" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {quizStats.count > 0 ? `${quizStats.avgScore} / 5` : "—"}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {quizStats.count > 0
              ? `${quizStats.avgPct}% average proficiency`
              : "Awaiting quiz attempts"}
          </p>
        </div>

        {/* Metric 4: Score Range */}
        <div className="glass rounded-3xl p-5 space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-[11px] font-medium uppercase tracking-wider">Score Extremes</span>
            <CheckCircle2 className="size-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {quizStats.count > 0 ? `${quizStats.highScore} / ${quizStats.lowScore}` : "—"}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {quizStats.count > 0
              ? `High: ${quizStats.highScore}/5 · Low: ${quizStats.lowScore}/5`
              : "No data available"}
          </p>
        </div>
      </div>

      {/* Grid: Language Distribution & Score Distribution */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Language Distribution Card */}
        <div className="glass rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Enrolled Language Breakdown</h3>
            <span className="glass rounded-full px-2.5 py-0.5 text-[10px] text-muted-foreground">
              {enrolledStudents.length} {enrolledStudents.length === 1 ? "student" : "students"}
            </span>
          </div>

          {enrolledStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Users className="size-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">No students enrolled yet.</p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                Share room code{" "}
                <strong className="font-mono text-cyan">
                  {activeLectureData?.join_code || "------"}
                </strong>{" "}
                with students to connect.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnalyticsDonut
                distribution={languageDistribution}
                totalCount={enrolledStudents.length}
              />
              <div className="grid gap-2 sm:grid-cols-2 pt-2">
                {languageDistribution.map((d) => (
                  <div
                    key={d.lang}
                    className="glass flex items-center justify-between rounded-xl px-3 py-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: d.color, boxShadow: `0 0 8px ${d.color}` }}
                      />
                      <span>{d.lang}</span>
                    </div>
                    <span className="font-semibold text-muted-foreground">
                      {d.pct}% ({d.count})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Score Distribution Card */}
        <div className="glass rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">MCQ Score Distribution</h3>
            <span className="glass rounded-full px-2.5 py-0.5 text-[10px] text-muted-foreground">
              {quizStats.count} {quizStats.count === 1 ? "attempt" : "attempts"}
            </span>
          </div>

          {quizStats.count === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <FileQuestion className="size-8 text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground">No quiz attempts yet.</p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                Student quiz results will appear here once submitted.
              </p>
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              {[5, 4, 3, 2, 1, 0].map((scoreLevel) => {
                const count = quizStats.distribution[scoreLevel] || 0;
                const pct = quizStats.count > 0 ? Math.round((count / quizStats.count) * 100) : 0;

                return (
                  <div key={scoreLevel} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-medium">
                        {scoreLevel} of 5 correct ({scoreLevel * 20}%)
                      </span>
                      <span className="font-semibold text-foreground">
                        {count} {count === 1 ? "student" : "students"} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          scoreLevel >= 4
                            ? "bg-emerald shadow-[0_0_8px_var(--neon-emerald)]"
                            : scoreLevel === 3
                              ? "bg-amber-400"
                              : "bg-rose-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Weak Topics Analysis */}
      <div className="glass rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-400" />
            <h3 className="text-sm font-semibold">Classroom Weak Topics Analysis</h3>
          </div>
          <span className="text-[11px] text-muted-foreground">Ranked by incorrect responses</span>
        </div>

        {weakTopicsSummary.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            {quizStats.count > 0 ? (
              <p className="text-xs text-emerald flex items-center gap-1.5">
                <CheckCircle2 className="size-4" />
                Classroom mastery achieved — No weak-topic data recorded! All students scored 100%.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No weak-topic data yet.</p>
            )}
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {weakTopicsSummary.map(({ topic, count }, i) => (
              <div
                key={topic}
                className="glass flex items-center justify-between rounded-2xl p-3.5 border border-rose-500/20 bg-rose-500/5 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-rose-500/20 font-bold text-rose-300 text-[10px]">
                    #{i + 1}
                  </span>
                  <span className="font-medium truncate text-foreground">{topic}</span>
                </div>
                <span className="shrink-0 rounded-full bg-rose-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-rose-300">
                  {count} {count === 1 ? "miss" : "misses"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-Student Performance Breakdown */}
      <div className="glass rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Enrolled Students & Quiz Performance</h3>
          <span className="text-[11px] text-muted-foreground">
            {enrolledStudents.length} enrolled
          </span>
        </div>

        {enrolledStudents.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No students enrolled yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-3 font-semibold">Student ID</th>
                  <th className="pb-3 font-semibold">Language</th>
                  <th className="pb-3 font-semibold">Joined At</th>
                  <th className="pb-3 font-semibold">Quiz Status</th>
                  <th className="pb-3 font-semibold">Weak Topics</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {enrolledStudents.map((s) => {
                  const hasAttempt = !!s.attempt;
                  const score = s.attempt?.score ?? 0;
                  const total = s.attempt?.total ?? 5;
                  const pct = Math.round((score / total) * 100);
                  const weak = s.attempt?.weak_topics || [];

                  return (
                    <tr key={s.id} className="hover:bg-white/2 transition-colors">
                      <td className="py-3 font-mono text-muted-foreground">
                        Student #{s.studentId.slice(0, 8)}
                      </td>
                      <td className="py-3">
                        <span className="rounded-full bg-cyan/10 px-2.5 py-0.5 text-[10px] font-medium text-cyan">
                          {s.language}
                        </span>
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {new Date(s.joinedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-3">
                        {hasAttempt ? (
                          <span
                            className={`flex items-center gap-1 font-semibold ${
                              pct >= 80
                                ? "text-emerald"
                                : pct >= 60
                                  ? "text-amber-400"
                                  : "text-rose-400"
                            }`}
                          >
                            <Award className="size-3.5" />
                            {score}/{total} ({pct}%)
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">Pending Attempt</span>
                        )}
                      </td>
                      <td className="py-3">
                        {weak.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {weak.map((w, idx) => (
                              <span
                                key={idx}
                                className="rounded-md bg-rose-500/10 px-2 py-0.5 text-[9px] text-rose-300 border border-rose-500/20"
                              >
                                {w}
                              </span>
                            ))}
                          </div>
                        ) : hasAttempt ? (
                          <span className="text-emerald text-[10px] flex items-center gap-1">
                            <CheckCircle2 className="size-3" /> None
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lectures Overview Table */}
      <div className="glass rounded-3xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-cyan" />
            <h3 className="text-sm font-semibold">Teacher Lecture Overview</h3>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {allLectures.length} total lectures owned
          </span>
        </div>

        {allLectures.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No lectures created yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-3 font-semibold">Title</th>
                  <th className="pb-3 font-semibold">Room Code</th>
                  <th className="pb-3 font-semibold">Status</th>
                  <th className="pb-3 font-semibold">Created Date</th>
                  <th className="pb-3 font-semibold">Students</th>
                  <th className="pb-3 font-semibold">Quizzes / Notes</th>
                  <th className="pb-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {allLectures.map((l) => {
                  const isCurrent = l.id === selectedLectureId;
                  return (
                    <tr
                      key={l.id}
                      className={`hover:bg-white/2 transition-colors ${
                        isCurrent ? "bg-white/4 font-medium" : ""
                      }`}
                    >
                      <td className="py-3 font-medium text-foreground">{l.title}</td>
                      <td className="py-3 font-mono text-cyan">{l.join_code}</td>
                      <td className="py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            l.status === "live"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : l.status === "ended"
                                ? "bg-cyan/20 text-cyan"
                                : "bg-amber-400/20 text-amber-300"
                          }`}
                        >
                          {l.status}
                        </span>
                      </td>
                      <td className="py-3 text-muted-foreground">
                        {new Date(l.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-3 text-foreground font-semibold">{l.studentsCount}</td>
                      <td className="py-3 text-muted-foreground">
                        {l.attemptsCount} attempts · {l.notesCount > 0 ? "Notes Ready" : "No Notes"}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleLectureSelect(l.id)}
                          className={`rounded-xl px-3 py-1.5 text-[11px] font-semibold transition-all ${
                            isCurrent
                              ? "neon-surface text-primary-foreground"
                              : "glass glass-hover text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {isCurrent ? "Viewing" : "Select"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SVG Donut Helper ─────────────────────────────────────────────────────────
function AnalyticsDonut({
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
    <div className="relative mx-auto size-40">
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
        <span className="text-2xl font-bold">{totalCount}</span>
        <span className="text-[10px] text-muted-foreground">enrolled</span>
      </div>
    </div>
  );
}

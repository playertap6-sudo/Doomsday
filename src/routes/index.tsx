import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Dices,
  Sparkles,
  ArrowRight,
  Hexagon,
  LogOut,
  AlertCircle,
  Copy,
  Check,
  Loader2,
} from "lucide-react";

import { SpaceBackground } from "@/components/SpaceBackground";
import { WindowSwitcher } from "@/components/WindowSwitcher";
import {
  LANGUAGES,
  signUpStudent,
  signUpTeacher,
  signIn,
  signOut,
  restoreSession,
  createLecture,
  joinLecture,
  useSession,
} from "@/lib/session";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EquaTranslate PRO — Gateway" },
      {
        name: "description",
        content:
          "Enter the EquaTranslate live multilingual classroom as a student or launch the teacher broadcast studio.",
      },
      { property: "og:title", content: "EquaTranslate PRO — Gateway" },
      {
        property: "og:description",
        content: "Real-time multilingual lecture translation with live equation rendering.",
      },
    ],
  }),
  component: Gateway,
});

const DEPARTMENTS = ["Physics", "Mathematics", "Chemistry", "Computer Science"];

function Gateway() {
  const navigate = useNavigate();
  const activeSession = useSession();

  const [tab, setTab] = useState<"student" | "teacher">("student");
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");

  // Common auth fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Student fields
  const [studentName, setStudentName] = useState("Rahul Menon");
  const [rollId, setRollId] = useState("ET-4821");
  const [studentLang, setStudentLang] = useState("Tamil");
  const [joinCodeInput, setJoinCodeInput] = useState("");

  // Teacher fields
  const [teacherName, setTeacherName] = useState("Dr. Ananya Iyer");
  const [dept, setDept] = useState("Physics");
  const [teachLang, setTeachLang] = useState("English");
  const [lectureTitle, setLectureTitle] = useState("PHY-301: Gamma Functions & Integration");

  // Created lecture state
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Session Restoration on startup ─────────────────────────────────
  useEffect(() => {
    let mounted = true;
    async function checkExistingAuth() {
      try {
        const restored = await restoreSession();
        if (!mounted || !restored || !restored.userId) return;

        if (restored.role === "teacher") {
          navigate({ to: "/teacher", replace: true });
        } else if (restored.role === "student") {
          navigate({ to: "/student", replace: true });
        }
      } catch (err) {
        console.error("[gateway] session restoration error:", err);
      }
    }

    checkExistingAuth();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  async function handleStudentSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      if (authMode === "signup") {
        if (!studentName.trim() || !email.trim() || !password.trim()) {
          setErrorMsg("Please provide your full name, email, and password.");
          setLoading(false);
          return;
        }

        const res = await signUpStudent({
          name: studentName.trim(),
          email: email.trim(),
          password,
          language: studentLang,
          rollId: rollId.trim(),
        });

        if (res.error) {
          setErrorMsg(res.error);
          setLoading(false);
          return;
        }
      } else {
        if (!email.trim() || !password.trim()) {
          setErrorMsg("Please enter your email and password.");
          setLoading(false);
          return;
        }

        const res = await signIn({
          email: email.trim(),
          password,
        });

        if (res.error) {
          setErrorMsg(res.error);
          setLoading(false);
          return;
        }

        if (res.session?.role === "teacher") {
          navigate({ to: "/teacher" });
          return;
        }
      }

      // If a join code was provided, enroll immediately
      if (joinCodeInput.trim()) {
        const joinRes = await joinLecture({
          joinCode: joinCodeInput.trim(),
          language: studentLang,
        });

        if (joinRes.error) {
          setErrorMsg(joinRes.error);
          setLoading(false);
          return;
        }
      }

      navigate({ to: "/student" });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Authentication error occurred.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTeacherSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      if (authMode === "signup") {
        if (!teacherName.trim() || !email.trim() || !password.trim()) {
          setErrorMsg("Please provide your name, email, and password.");
          setLoading(false);
          return;
        }

        const res = await signUpTeacher({
          name: teacherName.trim(),
          email: email.trim(),
          password,
          language: teachLang,
          department: dept,
        });

        if (res.error) {
          setErrorMsg(res.error);
          setLoading(false);
          return;
        }
      } else {
        if (!email.trim() || !password.trim()) {
          setErrorMsg("Please enter your email and password.");
          setLoading(false);
          return;
        }

        const res = await signIn({
          email: email.trim(),
          password,
        });

        if (res.error) {
          setErrorMsg(res.error);
          setLoading(false);
          return;
        }

        if (res.session?.role === "student") {
          navigate({ to: "/student" });
          return;
        }
      }

      // Create new lecture for the teacher
      if (lectureTitle.trim()) {
        const lecRes = await createLecture({
          title: lectureTitle.trim(),
        });

        if (lecRes.error) {
          console.warn("[gateway] Lecture creation warning:", lecRes.error);
        }
      }

      navigate({ to: "/teacher" });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Error authenticating teacher.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    setCreatedCode(null);
    setErrorMsg(null);
  }

  function copyJoinCode() {
    if (!createdCode) return;
    navigator.clipboard.writeText(createdCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative min-h-screen">
      <SpaceBackground />

      <header className="absolute top-6 right-6 left-6 z-10 flex items-center justify-between">
        <div className="glass flex items-center gap-2.5 rounded-full py-2 pr-5 pl-2.5">
          <span className="neon-surface flex size-8 items-center justify-center rounded-full">
            <Hexagon className="size-4" strokeWidth={2.5} />
          </span>
          <span className="text-sm font-semibold tracking-tight">
            EquaTranslate <span className="neon-text font-bold">PRO</span>
          </span>
        </div>

        {activeSession.userId && (
          <div className="flex items-center gap-3">
            <span className="glass hidden rounded-full px-3 py-1.5 text-xs text-muted-foreground sm:inline-block">
              {activeSession.name} ({activeSession.role})
            </span>
            <button
              onClick={handleSignOut}
              className="glass glass-hover flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-rose-400 hover:text-rose-300"
            >
              <LogOut className="size-3.5" /> Logout
            </button>
          </div>
        )}
      </header>

      <main className="flex min-h-screen items-center justify-center px-4 py-24">
        <div className="glass-strong w-full max-w-lg rounded-3xl p-8">
          {/* Lecture Created Success Modal/Card for Teacher */}
          {createdCode ? (
            <div className="space-y-6 text-center">
              <div className="neon-surface mx-auto flex size-14 items-center justify-center rounded-2xl shadow-lg">
                <Sparkles className="size-7 text-primary-foreground" />
              </div>
              <div>
                <span className="text-xs font-semibold tracking-widest text-cyan uppercase">
                  EquaTranslate PRO
                </span>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">Lecture Created</h2>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Share this 6-character room code with your students to connect.
                </p>
              </div>

              <div className="glass flex items-center justify-between rounded-2xl p-4">
                <div className="text-left">
                  <div className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                    Join Code
                  </div>
                  <div className="text-2xl font-mono font-bold tracking-widest text-cyan">
                    {createdCode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={copyJoinCode}
                  className="glass glass-hover flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-cyan"
                >
                  {copied ? <Check className="size-4 text-emerald" /> : <Copy className="size-4" />}
                  {copied ? "Copied!" : "Copy Code"}
                </button>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => navigate({ to: "/teacher" })}
                  className={ctaCls}
                >
                  <Sparkles className="size-4" /> Enter Teacher Studio
                </button>
                <button
                  type="button"
                  onClick={() => setCreatedCode(null)}
                  className="rounded-xl py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Create another lecture
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Role Toggle Tabs */}
              <div className="glass mb-6 grid grid-cols-2 gap-1 rounded-full p-1">
                {(["student", "teacher"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTab(t);
                      setErrorMsg(null);
                    }}
                    className={`rounded-full py-2.5 text-sm font-medium transition-all duration-300 ${
                      tab === t
                        ? "neon-surface text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "student" ? "Student Portal" : "Teacher Console"}
                  </button>
                ))}
              </div>

              {/* Auth Mode Toggle (Sign In vs Sign Up) */}
              <div className="mb-6 flex items-center justify-between border-b border-border/40 pb-3 text-xs">
                <span className="text-muted-foreground">
                  {authMode === "signup" ? "New to EquaTranslate PRO?" : "Already registered?"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode((m) => (m === "signup" ? "signin" : "signup"));
                    setErrorMsg(null);
                  }}
                  className="font-semibold text-cyan hover:underline"
                >
                  {authMode === "signup" ? "Sign In instead" : "Create an Account"}
                </button>
              </div>

              {/* Error Alert */}
              {errorMsg && (
                <div className="mb-6 flex items-start gap-2.5 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3.5 text-xs text-rose-300">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Student Portal Form */}
              {tab === "student" ? (
                <form onSubmit={handleStudentSubmit} className="space-y-5">
                  {authMode === "signup" && (
                    <>
                      <Field label="Full Name">
                        <input
                          className={inputCls}
                          value={studentName}
                          onChange={(e) => setStudentName(e.target.value)}
                          placeholder="e.g. Rahul Menon"
                          required
                        />
                      </Field>

                      <Field label="Student Roll ID">
                        <div className="flex gap-2">
                          <input
                            className={inputCls}
                            value={rollId}
                            onChange={(e) => setRollId(e.target.value)}
                            placeholder="e.g. ET-4821"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setRollId(`ET-${Math.floor(1000 + Math.random() * 9000)}`)
                            }
                            className="glass glass-hover flex shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-cyan"
                          >
                            <Dices className="size-3.5" /> Randomize
                          </button>
                        </div>
                      </Field>
                    </>
                  )}

                  <Field label="Email Address">
                    <input
                      type="email"
                      className={inputCls}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="student@university.edu"
                      required
                    />
                  </Field>

                  <Field label="Password">
                    <input
                      type="password"
                      className={inputCls}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </Field>

                  <Field label="Target Native Language (for Live Captions)">
                    <div className="grid grid-cols-3 gap-2">
                      {LANGUAGES.map((l) => (
                        <button
                          key={l.name}
                          type="button"
                          onClick={() => setStudentLang(l.name)}
                          className={`glass glass-hover rounded-xl px-2 py-3 text-center transition-all ${
                            studentLang === l.name ? "ring-glow" : ""
                          }`}
                        >
                          <div className="text-[10px] font-semibold tracking-widest text-cyan">
                            {l.code}
                          </div>
                          <div className="mt-1 text-sm font-medium">{l.native}</div>
                          <div className="text-[10px] text-muted-foreground">{l.name}</div>
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Lecture Join Code (Optional)">
                    <input
                      className={`${inputCls} font-mono uppercase tracking-widest`}
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      placeholder="6-CHAR CODE (e.g. GG91ES)"
                      maxLength={6}
                    />
                  </Field>

                  <button type="submit" disabled={loading} className={ctaCls}>
                    {loading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        {authMode === "signup" ? "Join Classroom" : "Sign In & Join"}{" "}
                        <ArrowRight className="size-4" />
                      </>
                    )}
                  </button>
                </form>
              ) : (
                /* Teacher Console Form */
                <form onSubmit={handleTeacherSubmit} className="space-y-5">
                  {authMode === "signup" && (
                    <Field label="Teacher Name">
                      <input
                        className={inputCls}
                        value={teacherName}
                        onChange={(e) => setTeacherName(e.target.value)}
                        placeholder="e.g. Dr. Ananya Iyer"
                        required
                      />
                    </Field>
                  )}

                  <Field label="Academic Email">
                    <input
                      type="email"
                      className={inputCls}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="professor@university.edu"
                      required
                    />
                  </Field>

                  <Field label="Password">
                    <input
                      type="password"
                      className={inputCls}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                    />
                  </Field>

                  <Field label="Lecture Topic / Title">
                    <input
                      className={inputCls}
                      value={lectureTitle}
                      onChange={(e) => setLectureTitle(e.target.value)}
                      placeholder="e.g. Quantum Mechanics - Lecture 4"
                      required
                    />
                  </Field>

                  <Field label="Academic Department">
                    <div className="grid grid-cols-2 gap-2">
                      {DEPARTMENTS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDept(d)}
                          className={`glass glass-hover rounded-xl py-3 text-sm font-medium transition-all ${
                            dept === d ? "ring-glow text-cyan" : "text-muted-foreground"
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <Field label="Teaching (Source) Language">
                    <div className="flex flex-wrap gap-2">
                      {LANGUAGES.map((l) => (
                        <button
                          key={l.name}
                          type="button"
                          onClick={() => setTeachLang(l.name)}
                          className={`glass glass-hover rounded-full px-4 py-2 text-xs font-medium transition-all ${
                            teachLang === l.name ? "ring-glow text-cyan" : "text-muted-foreground"
                          }`}
                        >
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </Field>

                  <button type="submit" disabled={loading} className={ctaCls}>
                    {loading ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="size-4" />{" "}
                        {authMode === "signup" ? "Create Lecture Room" : "Sign In & Create Room"}
                      </>
                    )}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </main>

      <WindowSwitcher />
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-border bg-white/4 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-cyan/60";

const ctaCls =
  "neon-surface flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:pointer-events-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}

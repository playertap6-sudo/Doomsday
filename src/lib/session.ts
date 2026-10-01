import { useEffect, useState } from "react";
import {
  supabase,
  type Profile,
  type ProfileInsert,
  type Lecture,
  type LectureInsert,
  type LectureStudent,
} from "@/lib/supabase";

export type Role = "student" | "teacher";

export type Session = {
  userId?: string | undefined;
  role: Role;
  name: string;
  email?: string | undefined;
  rollId: string;
  language: string;
  department: string;
  lectureId?: string | undefined;
  joinCode?: string | undefined;
  lectureTitle?: string | undefined;
};

export const EMPTY_SESSION: Session = {
  userId: undefined,
  role: "student",
  name: "",
  email: undefined,
  rollId: "",
  language: "English",
  department: "",
  lectureId: undefined,
  joinCode: undefined,
  lectureTitle: undefined,
};

export const DEFAULT_SESSION: Session = EMPTY_SESSION;

const KEY = "equatranslate.session";

export const LANGUAGES = [
  { name: "Tamil", code: "TA", native: "தமிழ்" },
  { name: "Hindi", code: "HI", native: "हिन्दी" },
  { name: "Telugu", code: "TE", native: "తెలుగు" },
  { name: "Kannada", code: "KN", native: "ಕನ್ನಡ" },
  { name: "Malayalam", code: "ML", native: "മലയാളം" },
  { name: "English", code: "EN", native: "English" },
];

export function getStoredSession(): Session {
  if (typeof window === "undefined") return DEFAULT_SESSION;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SESSION, ...JSON.parse(raw) };
  } catch {
    /* ignore malformed storage */
  }
  return DEFAULT_SESSION;
}

export function saveSession(s: Session) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new Event("equatranslate:session"));
  } catch {
    /* ignore storage errors */
  }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.sessionStorage.clear();
    window.dispatchEvent(new Event("equatranslate:session"));
  } catch {
    /* ignore */
  }
}

export async function getCurrentUser() {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function getCurrentProfile(userId?: string): Promise<Profile | null> {
  let uid = userId;
  if (!uid) {
    const user = await getCurrentUser();
    if (!user) return null;
    uid = user.id;
  }
  const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();

  if (error) {
    console.error("[session] Error fetching profile:", error);
    return null;
  }
  return data;
}

export async function signUpStudent({
  name,
  email,
  password,
  language,
  rollId,
}: {
  name: string;
  email: string;
  password: string;
  language: string;
  rollId?: string | undefined;
}): Promise<{
  user: unknown;
  profile: Profile | null;
  session: Session | null;
  error: string | null;
}> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        role: "student",
        language,
      },
    },
  });

  if (error || !data.user) {
    return {
      user: null,
      profile: null,
      session: null,
      error: error?.message || "Sign up failed",
    };
  }

  const profileRow: ProfileInsert = {
    id: data.user.id,
    name,
    role: "student",
    language,
  };

  const { error: profError } = await supabase
    .from("profiles")
    .upsert(profileRow, { onConflict: "id" });

  if (profError) {
    console.error("[session] Profile upsert error:", profError);
  }

  const s: Session = {
    userId: data.user.id,
    role: "student",
    name,
    email: data.user.email ?? email,
    rollId: rollId || `ET-${Math.floor(1000 + Math.random() * 9000)}`,
    language,
    department: "General",
  };
  saveSession(s);

  return { user: data.user, profile: profileRow as Profile, session: s, error: null };
}

export async function signUpTeacher({
  name,
  email,
  password,
  language,
  department,
}: {
  name: string;
  email: string;
  password: string;
  language: string;
  department: string;
}): Promise<{
  user: unknown;
  profile: Profile | null;
  session: Session | null;
  error: string | null;
}> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
        role: "teacher",
        language,
        department,
      },
    },
  });

  if (error || !data.user) {
    return {
      user: null,
      profile: null,
      session: null,
      error: error?.message || "Sign up failed",
    };
  }

  const profileRow: ProfileInsert = {
    id: data.user.id,
    name,
    role: "teacher",
    language,
  };

  const { error: profError } = await supabase
    .from("profiles")
    .upsert(profileRow, { onConflict: "id" });

  if (profError) {
    console.error("[session] Teacher profile upsert error:", profError);
  }

  const s: Session = {
    userId: data.user.id,
    role: "teacher",
    name,
    email: data.user.email ?? email,
    rollId: "",
    language,
    department: department || "Physics",
  };
  saveSession(s);

  return { user: data.user, profile: profileRow as Profile, session: s, error: null };
}

export async function signIn({ email, password }: { email: string; password: string }): Promise<{
  user: unknown;
  profile: Profile | null;
  session: Session | null;
  error: string | null;
}> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return {
      user: null,
      profile: null,
      session: null,
      error: error?.message || "Sign in failed",
    };
  }

  const profile = await getCurrentProfile(data.user.id);
  const role: Role = profile?.role === "teacher" ? "teacher" : "student";
  const name = profile?.name || (data.user.user_metadata?.["name"] as string | undefined) || "User";
  const language =
    profile?.language || (data.user.user_metadata?.["language"] as string | undefined) || "English";
  const department = (data.user.user_metadata?.["department"] as string | undefined) || "Physics";

  const s: Session = {
    userId: data.user.id,
    role,
    name,
    email: data.user.email ?? email,
    rollId:
      (data.user.user_metadata?.["rollId"] as string | undefined) ||
      `ET-${Math.floor(1000 + Math.random() * 9000)}`,
    language,
    department,
  };
  saveSession(s);

  return { user: data.user, profile, session: s, error: null };
}

export async function signOut(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[session] Error during signOut:", err);
  }
  clearSession();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(KEY);
      window.sessionStorage.clear();
      window.dispatchEvent(new Event("equatranslate:session"));
    } catch (_) {
      void 0;
    }
    window.location.replace("/");
  }
}

export async function createLecture({ title }: { title: string }): Promise<{
  lecture: Lecture | null;
  joinCode: string | null;
  error: string | null;
}> {
  const user = await getCurrentUser();
  if (!user) {
    return { lecture: null, joinCode: null, error: "Teacher must be authenticated" };
  }

  let joinCode = "";
  try {
    const { data: codeData, error: codeErr } = await supabase.rpc("generate_join_code");
    if (!codeErr && codeData) {
      joinCode = codeData;
    }
  } catch (_) {
    /* fallback */
  }

  if (!joinCode) {
    joinCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  const lectureInsert: LectureInsert = {
    teacher_id: user.id,
    title: title.trim() || "Live Classroom Lecture",
    join_code: joinCode,
    status: "waiting",
  };

  const { data: lecture, error: insertError } = await supabase
    .from("lectures")
    .insert(lectureInsert)
    .select()
    .single();

  if (insertError || !lecture) {
    return {
      lecture: null,
      joinCode: null,
      error: insertError?.message || "Failed to create lecture",
    };
  }

  const current = getStoredSession();
  const updated: Session = {
    ...current,
    lectureId: lecture.id,
    joinCode: lecture.join_code,
    lectureTitle: lecture.title,
  };
  saveSession(updated);

  return { lecture, joinCode: lecture.join_code, error: null };
}

export async function joinLecture({
  joinCode,
  language,
}: {
  joinCode: string;
  language?: string | undefined;
}): Promise<{
  lecture: Lecture | null;
  enrollment: LectureStudent | null;
  error: string | null;
}> {
  const user = await getCurrentUser();
  if (!user) {
    return { lecture: null, enrollment: null, error: "Student must be authenticated" };
  }

  const cleanCode = joinCode.trim().toUpperCase();
  if (!cleanCode) {
    return { lecture: null, enrollment: null, error: "Please enter a valid 6-character room code" };
  }

  const { data: lecture, error: fetchError } = await supabase
    .from("lectures")
    .select("*")
    .eq("join_code", cleanCode)
    .maybeSingle();

  if (fetchError || !lecture) {
    return {
      lecture: null,
      enrollment: null,
      error: "Lecture not found. Please verify the 6-character code.",
    };
  }

  if (lecture.status === "ended") {
    return {
      lecture: null,
      enrollment: null,
      error: "This lecture has already ended.",
    };
  }

  const targetLang = language || getStoredSession().language || "English";

  // Upsert enrollment (race-safe: concurrent calls won't crash on unique constraint)
  const { data: enrollment, error: enrollError } = await supabase
    .from("lecture_students")
    .upsert(
      {
        lecture_id: lecture.id,
        student_id: user.id,
        language: targetLang,
      },
      { onConflict: "lecture_id,student_id" },
    )
    .select()
    .single();

  if (enrollError) {
    return {
      lecture: null,
      enrollment: null,
      error: enrollError.message || "Failed to join lecture",
    };
  }

  const current = getStoredSession();
  const updated: Session = {
    ...current,
    lectureId: lecture.id,
    joinCode: lecture.join_code,
    lectureTitle: lecture.title,
    language: targetLang,
  };
  saveSession(updated);

  return { lecture, enrollment, error: null };
}

export async function restoreSession(): Promise<Session | null> {
  const {
    data: { session: authSession },
  } = await supabase.auth.getSession();

  if (!authSession?.user) {
    clearSession();
    return null;
  }

  const profile = await getCurrentProfile(authSession.user.id);
  if (!profile) {
    clearSession();
    return null;
  }

  const role: Role = profile.role === "teacher" ? "teacher" : "student";
  const stored = getStoredSession();
  const userMeta = authSession.user.user_metadata as Record<string, unknown> | undefined;

  const session: Session = {
    ...stored,
    userId: authSession.user.id,
    role,
    name: profile.name,
    email: authSession.user.email ?? undefined,
    rollId: (userMeta?.["rollId"] as string) || stored.rollId || "ET-4821",
    language: profile.language || stored.language || "English",
    department: (userMeta?.["department"] as string) || stored.department || "Physics",
  };

  saveSession(session);
  return session;
}

/** Reads the stored session and subscribes to auth and storage updates */
export function useSession(): Session {
  const [session, setSession] = useState<Session>(getStoredSession);

  useEffect(() => {
    setSession(getStoredSession());

    const onSessionChange = () => {
      setSession(getStoredSession());
    };
    window.addEventListener("equatranslate:session", onSessionChange);
    window.addEventListener("storage", onSessionChange);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, authSession) => {
      if (event === "SIGNED_OUT" || !authSession) {
        setSession(DEFAULT_SESSION);
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        restoreSession().then((restored) => {
          if (restored) setSession(restored);
        });
      }
    });

    return () => {
      window.removeEventListener("equatranslate:session", onSessionChange);
      window.removeEventListener("storage", onSessionChange);
      subscription.unsubscribe();
    };
  }, []);

  return session;
}

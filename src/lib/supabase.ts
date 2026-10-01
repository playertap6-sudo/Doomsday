import { createClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert, TablesUpdate } from "./database.types";

export type { Database, Json } from "./database.types";

export type Profile = Tables<"profiles">;
export type ProfileInsert = TablesInsert<"profiles">;
export type ProfileUpdate = TablesUpdate<"profiles">;

export type Lecture = Tables<"lectures">;
export type LectureInsert = TablesInsert<"lectures">;
export type LectureUpdate = TablesUpdate<"lectures">;

export type LectureStudent = Tables<"lecture_students">;
export type LectureStudentInsert = TablesInsert<"lecture_students">;
export type LectureStudentUpdate = TablesUpdate<"lecture_students">;

export type Caption = Tables<"captions">;
export type CaptionInsert = TablesInsert<"captions">;
export type CaptionUpdate = TablesUpdate<"captions">;

export type Note = Tables<"notes">;
export type NoteInsert = TablesInsert<"notes">;
export type NoteUpdate = TablesUpdate<"notes">;

export type Quiz = Tables<"quizzes">;
export type QuizInsert = TablesInsert<"quizzes">;
export type QuizUpdate = TablesUpdate<"quizzes">;

export type QuizAttempt = Tables<"quiz_attempts">;
export type QuizAttemptInsert = TablesInsert<"quiz_attempts">;
export type QuizAttemptUpdate = TablesUpdate<"quiz_attempts">;

export type ProfileRole = "teacher" | "student";
export type LectureStatus = "waiting" | "live" | "ended";

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
  topic: string;
  explanation: string;
}

const supabaseUrl = (import.meta.env["VITE_SUPABASE_URL"] as string | undefined) ?? "";
const supabaseAnonKey = (import.meta.env["VITE_SUPABASE_ANON_KEY"] as string | undefined) ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Please verify your .env file.",
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

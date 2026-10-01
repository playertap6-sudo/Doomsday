-- =============================================================
-- LinguaClass — Supabase PostgreSQL Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================

-- ---------------------------------------------------------------
-- 0. Enable required extensions
-- ---------------------------------------------------------------
create extension if not exists "pgcrypto";   -- for gen_random_bytes()


-- ---------------------------------------------------------------
-- 1. PROFILES
--    Mirrors auth.users; stores display name, role, and language.
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text        not null,
  role        text        not null check (role in ('teacher', 'student')),
  language    text        not null default 'English',  -- student's preferred caption language
  created_at  timestamptz not null default now()
);

-- RLS
alter table public.profiles enable row level security;

-- Any authenticated user can read their own profile
create policy "profiles: own read"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can only insert/update their own row
create policy "profiles: own insert"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: own update"
  on public.profiles for update
  using (auth.uid() = id);


-- ---------------------------------------------------------------
-- 2. LECTURES
--    Created by teachers. join_code is the 6-char room code.
-- ---------------------------------------------------------------
create table if not exists public.lectures (
  id          uuid        primary key default gen_random_uuid(),
  teacher_id  uuid        not null references public.profiles(id) on delete cascade,
  title       text        not null,
  join_code   text        not null unique,          -- 6-char alphanumeric
  status      text        not null default 'waiting'
                          check (status in ('waiting', 'live', 'ended')),
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);

-- RLS
alter table public.lectures enable row level security;

-- Teachers can do everything on their own lectures
create policy "lectures: teacher manage"
  on public.lectures for all
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

-- Students can read any lecture (to join by code)
create policy "lectures: student read"
  on public.lectures for select
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'student'
    )
  );


-- ---------------------------------------------------------------
-- 3. LECTURE_STUDENTS  (join table)
--    Records which student joined which lecture, and in which language.
-- ---------------------------------------------------------------
create table if not exists public.lecture_students (
  id          uuid        primary key default gen_random_uuid(),
  lecture_id  uuid        not null references public.lectures(id) on delete cascade,
  student_id  uuid        not null references public.profiles(id) on delete cascade,
  language    text        not null default 'English',
  joined_at   timestamptz not null default now(),
  unique (lecture_id, student_id)
);

-- RLS
alter table public.lecture_students enable row level security;

-- Students manage their own enrollment row
create policy "lecture_students: student manage"
  on public.lecture_students for all
  using (auth.uid() = student_id)
  with check (auth.uid() = student_id);

-- Teachers can read who is in their lecture
create policy "lecture_students: teacher read"
  on public.lecture_students for select
  using (
    exists (
      select 1 from public.lectures l
      where l.id = lecture_id and l.teacher_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------
-- 4. CAPTIONS
--    One row per translated chunk per language.
--    Realtime is enabled so students get live updates.
-- ---------------------------------------------------------------
create table if not exists public.captions (
  id           uuid        primary key default gen_random_uuid(),
  lecture_id   uuid        not null references public.lectures(id) on delete cascade,
  language     text        not null,          -- 'English', 'Hindi', 'Tamil' …
  text         text        not null,
  chunk_index  integer     not null default 0, -- ordering within a lecture
  created_at   timestamptz not null default now()
);

-- RLS
alter table public.captions enable row level security;

-- Teachers can insert captions for their own lectures
create policy "captions: teacher insert"
  on public.captions for insert
  with check (
    exists (
      select 1 from public.lectures l
      where l.id = lecture_id and l.teacher_id = auth.uid()
    )
  );

-- Edge Functions use the service role key, which bypasses RLS.
-- Students enrolled in a lecture can read its captions
create policy "captions: enrolled student read"
  on public.captions for select
  using (
    exists (
      select 1 from public.lecture_students ls
      where ls.lecture_id = captions.lecture_id
        and ls.student_id = auth.uid()
    )
  );

-- Also allow the teacher to read their own lecture's captions
create policy "captions: teacher read"
  on public.captions for select
  using (
    exists (
      select 1 from public.lectures l
      where l.id = lecture_id and l.teacher_id = auth.uid()
    )
  );

-- Enable Realtime publication for captions
-- (Run once; safe to re-run — the "if not exists" variant isn't available,
--  so we drop/add idempotently via a DO block.)
do $$
begin
  -- Add 'captions' to the default realtime publication
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'captions'
  ) then
    alter publication supabase_realtime add table public.captions;
  end if;
end $$;


-- ---------------------------------------------------------------
-- 5. NOTES
--    AI-generated notes per student per lecture (one row per language).
-- ---------------------------------------------------------------
create table if not exists public.notes (
  id          uuid        primary key default gen_random_uuid(),
  lecture_id  uuid        not null references public.lectures(id) on delete cascade,
  language    text        not null,
  content     text        not null,           -- markdown notes
  created_at  timestamptz not null default now(),
  unique (lecture_id, language)
);

-- RLS
alter table public.notes enable row level security;

-- Enrolled students can read notes for their lecture
create policy "notes: enrolled student read"
  on public.notes for select
  using (
    exists (
      select 1 from public.lecture_students ls
      where ls.lecture_id = notes.lecture_id
        and ls.student_id = auth.uid()
    )
  );

-- Service-role (Edge Function) can insert — bypasses RLS


-- ---------------------------------------------------------------
-- 6. QUIZZES
--    One quiz per lecture, stored as a JSONB array of MCQ objects.
--    Schema: [{ question, options: [str], answer: int (0-3), explanation }]
-- ---------------------------------------------------------------
create table if not exists public.quizzes (
  id          uuid        primary key default gen_random_uuid(),
  lecture_id  uuid        not null references public.lectures(id) on delete cascade,
  language    text        not null default 'English',
  questions   jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  unique (lecture_id, language)
);

-- RLS
alter table public.quizzes enable row level security;

-- Enrolled students read quizzes
create policy "quizzes: enrolled student read"
  on public.quizzes for select
  using (
    exists (
      select 1 from public.lecture_students ls
      where ls.lecture_id = quizzes.lecture_id
        and ls.student_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------
-- 7. QUIZ_ATTEMPTS
--    Students write only their own attempts.
-- ---------------------------------------------------------------
create table if not exists public.quiz_attempts (
  id              uuid        primary key default gen_random_uuid(),
  quiz_id         uuid        not null references public.quizzes(id) on delete cascade,
  student_id      uuid        not null references public.profiles(id) on delete cascade,
  answers         jsonb       not null default '[]'::jsonb,  -- array of chosen option indices
  score           integer     not null default 0,
  total           integer     not null default 0,
  weak_topics     text[]      default '{}',                  -- topics of wrong answers
  submitted_at    timestamptz not null default now(),
  unique (quiz_id, student_id)
);

-- RLS
alter table public.quiz_attempts enable row level security;

-- Students insert only their own attempt
create policy "quiz_attempts: student insert"
  on public.quiz_attempts for insert
  with check (auth.uid() = student_id);

-- Students read only their own attempt
create policy "quiz_attempts: student read"
  on public.quiz_attempts for select
  using (auth.uid() = student_id);

-- Teachers read all attempts for their lectures
create policy "quiz_attempts: teacher read"
  on public.quiz_attempts for select
  using (
    exists (
      select 1
      from public.quizzes q
      join public.lectures l on l.id = q.lecture_id
      where q.id = quiz_id and l.teacher_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------
-- 8. Handy helper function: generate a random 6-char join code
--    Call from Edge Functions or SQL:  select generate_join_code();
-- ---------------------------------------------------------------
create or replace function public.generate_join_code()
returns text
language sql
as $$
  select upper(
    substring(
      encode(gen_random_bytes(6), 'base64')
      from 1 for 6
    )
  );
$$;

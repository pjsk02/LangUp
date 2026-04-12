-- LangUp initial schema for Supabase (Postgres)

-- 1) profiles: extends auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  target_language text,
  proficiency_level int check (proficiency_level between 1 and 5),
  created_at timestamptz not null default now()
);

-- 2) vocabulary: tracks words per user
create table if not exists public.vocabulary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  word_native text not null,
  word_english text not null,
  language text not null,
  times_seen int not null default 0,
  times_clicked int not null default 0,
  mastery_score double precision not null default 0,
  last_seen timestamptz
);

create index if not exists vocabulary_user_id_idx on public.vocabulary (user_id);

-- 3) sessions: one row per reading session
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  content_snippet text not null,
  total_words_swapped int not null,
  words_clicked int not null,
  score double precision not null,
  level_used int not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on public.sessions (user_id);

-- Enable Row Level Security
alter table public.profiles enable row level security;
alter table public.vocabulary enable row level security;
alter table public.sessions enable row level security;

-- profiles policies: users can only access their own profile row
create policy "profiles_select_own"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_delete_own"
  on public.profiles
  for delete
  using (auth.uid() = id);

-- vocabulary policies: users can only access their own vocabulary rows
create policy "vocabulary_select_own"
  on public.vocabulary
  for select
  using (auth.uid() = user_id);

create policy "vocabulary_insert_own"
  on public.vocabulary
  for insert
  with check (auth.uid() = user_id);

create policy "vocabulary_update_own"
  on public.vocabulary
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "vocabulary_delete_own"
  on public.vocabulary
  for delete
  using (auth.uid() = user_id);

-- sessions policies: users can only access their own session rows
create policy "sessions_select_own"
  on public.sessions
  for select
  using (auth.uid() = user_id);

create policy "sessions_insert_own"
  on public.sessions
  for insert
  with check (auth.uid() = user_id);

create policy "sessions_update_own"
  on public.sessions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "sessions_delete_own"
  on public.sessions
  for delete
  using (auth.uid() = user_id);

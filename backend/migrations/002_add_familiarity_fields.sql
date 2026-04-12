-- Migration 002: Add familiarity tracking fields to vocabulary

alter table public.vocabulary
  add column if not exists first_seen timestamptz,
  add column if not exists last_clicked timestamptz;

-- Backfill first_seen for existing rows
update public.vocabulary
set first_seen = coalesce(last_seen, now())
where first_seen is null;

-- Unique constraint to prevent duplicate entries per user+word+language
-- (allows safe upsert logic in application layer)
alter table public.vocabulary
  add constraint vocabulary_user_word_unique
  unique (user_id, word_native, language);

-- Public Talk Outline library (S-99 list) for the Weekend Scheduler's Tema
-- picker, plus weekend-specific columns on meeting_weeks.
--
-- Outlines are imported from the uploaded S-99 PDF (parsed client-side) or
-- maintained manually. Weeks reference outlines by number only (no FK) so a
-- re-uploaded list never invalidates already-scheduled weeks.

create table if not exists public.public_talk_outlines (
  id uuid primary key default gen_random_uuid(),
  talk_number integer not null check (talk_number > 0),
  title text not null,
  language text not null default 'ilo',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (talk_number, language)
);
create index if not exists idx_public_talk_outlines_language
  on public.public_talk_outlines (language, talk_number);
alter table public.public_talk_outlines enable row level security;
-- Congregation-shared data: same policy shape as the other scheduler tables.
drop policy if exists "Single user full access" on public.public_talk_outlines;
create policy "Single user full access"
  on public.public_talk_outlines
  for all
  to authenticated
  using (true)
  with check (true);
-- Explicit grants required for the Data API (see 20261001000000).
grant select, insert, update, delete on public.public_talk_outlines to authenticated;
drop trigger if exists trg_public_talk_outlines_updated_at on public.public_talk_outlines;
create trigger trg_public_talk_outlines_updated_at
before update on public.public_talk_outlines
for each row
execute function public.set_meeting_schedule_updated_at();
comment on table public.public_talk_outlines is
  'Public talk outline list (S-99): number + theme per language, feeding the weekend Tema picker.';
-- Weekend additions: outline number behind public_talk_theme (theme keeps the
-- title only), special weekend events, and a second speaker for symposiums.
alter table public.meeting_weeks
  add column if not exists public_talk_number integer,
  add column if not exists weekend_event text
    check (weekend_event in ('assembly', 'convention', 'special_talk', 'symposium')),
  add column if not exists public_talk_speaker2_name text;
comment on column public.meeting_weeks.public_talk_number is
  'S-99 outline number for public_talk_theme; null for free-text themes (e.g. drama during C.O. visit).';
comment on column public.meeting_weeks.weekend_event is
  'Special weekend event: assembly/convention (no local meeting row content), special_talk, or symposium.';
comment on column public.meeting_weeks.public_talk_speaker2_name is
  'Second speaker when weekend_event = symposium.';

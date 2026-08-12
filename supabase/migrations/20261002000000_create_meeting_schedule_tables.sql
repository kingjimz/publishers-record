-- Meeting Scheduler: one row per week (midweek CLM + weekend programs)
-- plus child rows for the variable midweek program parts.
-- Assignees are referenced by publisher name (no stable publisher id exists),
-- consistent with publisher_pioneer_profiles.

create table if not exists public.meeting_weeks (
  id uuid primary key default gen_random_uuid(),
  week_of date not null unique,
  week_type text not null default 'regular'
    check (week_type in ('regular', 'co_visit', 'no_meeting', 'memorial')),
  notes text,

  -- Midweek (Christian Life and Ministry) meeting
  midweek_date date,
  weekly_bible_reading text,
  song_opening integer,
  song_middle integer,
  song_closing integer,
  chairman_name text,
  opening_prayer_name text,
  closing_prayer_name text,

  -- Weekend meeting
  weekend_date date,
  weekend_chairman_name text,
  public_talk_theme text,
  public_talk_speaker_name text,
  speaker_congregation text,
  wt_article_title text,
  wt_conductor_name text,
  wt_reader_name text,
  weekend_opening_prayer_name text,
  weekend_closing_prayer_name text,
  weekend_song_opening integer,
  weekend_song_middle integer,
  weekend_song_closing integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meeting_weeks_week_of
  on public.meeting_weeks (week_of);

create table if not exists public.meeting_parts (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meeting_weeks (id) on delete cascade,
  section text not null check (section in ('treasures', 'ministry', 'living')),
  sort_order integer not null default 0,
  title text not null,
  duration_minutes integer check (duration_minutes > 0),
  part_type text not null default 'other'
    check (part_type in (
      'talk', 'spiritual_gems', 'bible_reading',
      'student_demo', 'student_talk',
      'living_talk', 'cbs', 'cbs_reader', 'service_talk', 'other'
    )),
  assignee_name text,
  assistant_name text,
  room text not null default 'main' check (room in ('main', 'aux1', 'aux2')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meeting_parts_meeting
  on public.meeting_parts (meeting_id, section, sort_order);

create index if not exists idx_meeting_parts_assignee
  on public.meeting_parts (assignee_name);

alter table public.meeting_weeks enable row level security;
alter table public.meeting_parts enable row level security;

-- Congregation-shared data: same policy shape as publisher_pioneer_profiles.
drop policy if exists "Single user full access" on public.meeting_weeks;
create policy "Single user full access"
  on public.meeting_weeks
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Single user full access" on public.meeting_parts;
create policy "Single user full access"
  on public.meeting_parts
  for all
  to authenticated
  using (true)
  with check (true);

-- Explicit grants required for the Data API (see 20261001000000).
grant select, insert, update, delete on public.meeting_weeks to authenticated;
grant select, insert, update, delete on public.meeting_parts to authenticated;

create or replace function public.set_meeting_schedule_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_meeting_weeks_updated_at on public.meeting_weeks;
create trigger trg_meeting_weeks_updated_at
before update on public.meeting_weeks
for each row
execute function public.set_meeting_schedule_updated_at();

drop trigger if exists trg_meeting_parts_updated_at on public.meeting_parts;
create trigger trg_meeting_parts_updated_at
before update on public.meeting_parts
for each row
execute function public.set_meeting_schedule_updated_at();

comment on table public.meeting_weeks is
  'One row per meeting week: midweek CLM roles/program header plus weekend meeting assignments.';
comment on table public.meeting_parts is
  'Variable midweek program parts (Treasures / Ministry / Living as Christians) with assignees.';

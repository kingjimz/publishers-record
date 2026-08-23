-- Weekend public talk rotation cycles. Weeks stay in meeting_weeks; each row
-- here only defines a cycle's window and the free-text range label printed
-- under the schedule title (e.g. "Agosto - Disiembre 2026").
--
-- speaker_count snapshots the active elder + MS pool when the cycle is
-- created, fixing its length so later pool changes never silently reshape an
-- existing schedule; the next cycle recounts.

create table if not exists public.weekend_schedules (
  id uuid primary key default gen_random_uuid(),
  start_sunday date not null,
  end_sunday date not null check (end_sunday >= start_sunday),
  -- Free text; null/empty falls back to the computed month-range label.
  range_label text,
  speaker_count integer not null check (speaker_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (start_sunday)
);
alter table public.weekend_schedules enable row level security;
-- Congregation-shared data: same policy shape as the other scheduler tables.
drop policy if exists "Single user full access" on public.weekend_schedules;
create policy "Single user full access"
  on public.weekend_schedules
  for all
  to authenticated
  using (true)
  with check (true);
-- Explicit grants required for the Data API (see 20261001000000).
grant select, insert, update, delete on public.weekend_schedules to authenticated;
drop trigger if exists trg_weekend_schedules_updated_at on public.weekend_schedules;
create trigger trg_weekend_schedules_updated_at
before update on public.weekend_schedules
for each row
execute function public.set_meeting_schedule_updated_at();
comment on table public.weekend_schedules is
  'Weekend public talk rotation cycles: window + free-text range label; one row per cycle.';

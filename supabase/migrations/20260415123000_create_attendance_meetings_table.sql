-- Stores one attendance row per meeting. Monthly averages are derived from these rows.
create table if not exists public.attendance_meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  service_year_start integer not null,
  meeting_date date not null,
  meeting_type text not null check (meeting_type in ('midweek', 'weekend')),
  attendance integer not null check (attendance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_attendance_meetings_user_service_year
  on public.attendance_meetings (user_id, service_year_start);

create index if not exists idx_attendance_meetings_service_year_month
  on public.attendance_meetings (service_year_start, meeting_date);

alter table public.attendance_meetings enable row level security;

drop policy if exists "attendance_meetings_select_own" on public.attendance_meetings;
create policy "attendance_meetings_select_own"
  on public.attendance_meetings
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "attendance_meetings_insert_own" on public.attendance_meetings;
create policy "attendance_meetings_insert_own"
  on public.attendance_meetings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "attendance_meetings_update_own" on public.attendance_meetings;
create policy "attendance_meetings_update_own"
  on public.attendance_meetings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "attendance_meetings_delete_own" on public.attendance_meetings;
create policy "attendance_meetings_delete_own"
  on public.attendance_meetings
  for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_attendance_meetings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_attendance_meetings_updated_at on public.attendance_meetings;
create trigger trg_attendance_meetings_updated_at
before update on public.attendance_meetings
for each row
execute function public.set_attendance_meetings_updated_at();

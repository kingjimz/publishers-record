-- Stores monthly attendance entries per service year (Sep-Aug), separated by user.
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  service_year_start integer not null,
  month text not null,
  midweek_entries integer[] not null default '{}',
  weekend_entries integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_records_service_year_month_unique unique (user_id, service_year_start, month)
);

create index if not exists idx_attendance_records_user_service_year
  on public.attendance_records (user_id, service_year_start);

alter table public.attendance_records enable row level security;

drop policy if exists "attendance_records_select_own" on public.attendance_records;
create policy "attendance_records_select_own"
  on public.attendance_records
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "attendance_records_insert_own" on public.attendance_records;
create policy "attendance_records_insert_own"
  on public.attendance_records
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "attendance_records_update_own" on public.attendance_records;
create policy "attendance_records_update_own"
  on public.attendance_records
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "attendance_records_delete_own" on public.attendance_records;
create policy "attendance_records_delete_own"
  on public.attendance_records
  for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.set_attendance_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_attendance_records_updated_at on public.attendance_records;
create trigger trg_attendance_records_updated_at
before update on public.attendance_records
for each row
execute function public.set_attendance_records_updated_at();

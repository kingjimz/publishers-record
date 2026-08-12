-- Logs each wol.jw.org program import (one row per fetch-meeting-program call)
-- so the app can show usage against the Supabase monthly invocation quota.
-- Rows are inserted by the Edge Function with the service role; the app only reads.

create table if not exists public.meeting_import_logs (
  id uuid primary key default gen_random_uuid(),
  year integer,
  week integer,
  status text not null check (status in ('success', 'error')),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_import_logs_created_at
  on public.meeting_import_logs (created_at);

alter table public.meeting_import_logs enable row level security;

-- Read-only for signed-in users; inserts come from the service role (bypasses RLS).
drop policy if exists "Authenticated read access" on public.meeting_import_logs;
create policy "Authenticated read access"
  on public.meeting_import_logs
  for select
  to authenticated
  using (true);

-- Explicit grants required for the Data API (see 20261001000000).
grant select on public.meeting_import_logs to authenticated;

comment on table public.meeting_import_logs is
  'One row per meeting-program import call, for in-app usage monitoring.';

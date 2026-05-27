-- Required before October 30, 2026: Supabase will no longer grant public schema
-- access to new tables by default. These explicit grants ensure PostgREST and
-- supabase-js can reach all tables under the authenticated role.

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.publisher_records to authenticated;
grant select, insert, update, delete on public.publisher_pioneer_profiles to authenticated;
grant select, insert, update, delete on public.attendance_meetings to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;

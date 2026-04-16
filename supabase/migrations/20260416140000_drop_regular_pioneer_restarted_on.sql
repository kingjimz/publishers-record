-- Remove regular pioneer "restarted" tracking (no longer used).

alter table public.publisher_records
  drop column if exists regular_pioneer_restarted_on;

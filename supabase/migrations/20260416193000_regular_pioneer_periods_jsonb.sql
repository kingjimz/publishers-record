-- Multiple regular pioneer stints per publisher.

alter table public.publisher_pioneer_profiles
  add column if not exists regular_pioneer_periods jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'publisher_pioneer_profiles'
      and column_name = 'regular_pioneer_approved_on'
  ) then
    update public.publisher_pioneer_profiles
    set regular_pioneer_periods = jsonb_build_array(
      jsonb_build_object(
        'approved_on', regular_pioneer_approved_on,
        'stopped_on', regular_pioneer_stopped_on
      )
    )
    where regular_pioneer_approved_on is not null
       or regular_pioneer_stopped_on is not null;

    alter table public.publisher_pioneer_profiles
      drop column regular_pioneer_approved_on,
      drop column regular_pioneer_stopped_on;
  end if;
end $$;

comment on column public.publisher_pioneer_profiles.regular_pioneer_periods is
  'JSON array of { approved_on, stopped_on } (ISO dates) for each regular pioneer stint; latest row with null stopped_on means currently active.';

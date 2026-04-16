-- Multiple auxiliary pioneer stints per publisher (same or different service years).

alter table public.publisher_pioneer_profiles
  add column if not exists auxiliary_pioneer_periods jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'publisher_pioneer_profiles'
      and column_name = 'auxiliary_pioneer_approved_on'
  ) then
    update public.publisher_pioneer_profiles
    set auxiliary_pioneer_periods = jsonb_build_array(
      jsonb_build_object(
        'approved_on', auxiliary_pioneer_approved_on,
        'ended_on', auxiliary_pioneer_ended_on
      )
    )
    where auxiliary_pioneer_approved_on is not null
       or auxiliary_pioneer_ended_on is not null;

    alter table public.publisher_pioneer_profiles
      drop column auxiliary_pioneer_approved_on,
      drop column auxiliary_pioneer_ended_on;
  end if;
end $$;

comment on column public.publisher_pioneer_profiles.auxiliary_pioneer_periods is
  'JSON array of { approved_on, ended_on } (ISO dates) for each auxiliary pioneer stint; supports multiple periods per publisher.';

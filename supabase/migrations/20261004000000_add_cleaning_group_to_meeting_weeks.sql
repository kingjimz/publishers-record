-- "Cleaner of the week" group shown on the printed midweek schedule.
alter table public.meeting_weeks
  add column if not exists cleaning_group text;

comment on column public.meeting_weeks.cleaning_group is
  'Cleaning assignment for the week, e.g. "Group 5"; printed on the midweek schedule.';

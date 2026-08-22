-- Reason a week has no meeting (assembly / convention), shown on the printed schedule.
alter table public.meeting_weeks
  add column if not exists no_meeting_reason text;

comment on column public.meeting_weeks.no_meeting_reason is
  'Why there is no meeting this week, e.g. "Kombension ti Rehion"; printed on the schedule.';

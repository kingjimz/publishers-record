-- Ministry-part setting from the workbook (e.g. "PANAGBALAYBALAY", "HOUSE TO HOUSE"),
-- printed after the duration on the midweek schedule.
alter table public.meeting_parts
  add column if not exists setting text;

comment on column public.meeting_parts.setting is
  'Workbook setting for ministry parts, e.g. "HOUSE TO HOUSE" / "PANAGBALAYBALAY".';

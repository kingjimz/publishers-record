-- Optional milestone dates for auxiliary and regular pioneer assignments.

alter table public.publisher_records
  add column if not exists auxiliary_pioneer_approved_on date null,
  add column if not exists auxiliary_pioneer_ended_on date null,
  add column if not exists regular_pioneer_approved_on date null,
  add column if not exists regular_pioneer_stopped_on date null;

comment on column public.publisher_records.auxiliary_pioneer_approved_on is
  'Date the publisher was approved as an auxiliary pioneer (congregation tracking).';
comment on column public.publisher_records.auxiliary_pioneer_ended_on is
  'Date the auxiliary pioneer arrangement ended.';
comment on column public.publisher_records.regular_pioneer_approved_on is
  'Date the publisher was approved as a regular pioneer.';
comment on column public.publisher_records.regular_pioneer_stopped_on is
  'Date regular pioneering ended (e.g. stepped down).';

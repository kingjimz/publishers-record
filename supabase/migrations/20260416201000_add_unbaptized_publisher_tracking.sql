-- Track unbaptized publisher approval per congregation record.

alter table public.publisher_records
  add column if not exists unbaptized_publisher boolean not null default false,
  add column if not exists unbaptized_approved_on date null;

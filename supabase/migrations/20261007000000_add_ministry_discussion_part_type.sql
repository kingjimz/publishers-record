-- Workbooks now include elder/MS-led audience discussions in the
-- "Apply Yourself to the Field Ministry" section (e.g. "What Would You Say?").
-- Add the dedicated part type to the check constraint.
alter table public.meeting_parts
  drop constraint meeting_parts_part_type_check;

alter table public.meeting_parts
  add constraint meeting_parts_part_type_check
    check (part_type in (
      'talk', 'spiritual_gems', 'bible_reading',
      'student_demo', 'student_talk', 'ministry_discussion',
      'living_talk', 'cbs', 'cbs_reader', 'service_talk', 'other'
    ));

import { createEmptyWeek } from '../components/meeting-scheduler/meeting-defaults';
import {
  LABELS,
  assignmentRolePair,
  buildMidweekSections,
  weekRange,
} from './meeting-schedule-model';

describe('buildMidweekSections', () => {
  it('numbers parts continuously across sections and skips the CBS reader', () => {
    const week = createEmptyWeek('2026-08-10');
    const sections = buildMidweekSections(week, LABELS.en);

    expect(sections.map((s) => s.section)).toEqual(['treasures', 'ministry', 'living']);
    expect(sections[0].heading).toBe("TREASURES FROM GOD'S WORD");
    expect(sections[0].color).toBe('#57646e');

    const nums = sections.flatMap((s) => s.rows.map((r) => r.num));
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const types = sections.flatMap((s) => s.rows.map((r) => r.part.part_type));
    expect(types).not.toContain('cbs_reader');
    expect(types).toContain('cbs');
  });

  it('numbers the CO service talk without a CBS row on co_visit weeks', () => {
    const week = createEmptyWeek('2026-08-10', 'co_visit');
    const sections = buildMidweekSections(week, LABELS.en);

    const types = sections.flatMap((s) => s.rows.map((r) => r.part.part_type));
    expect(types).toContain('service_talk');
    expect(types).not.toContain('cbs');
    expect(sections.flatMap((s) => s.rows).at(-1)?.num).toBe(8);
  });

  it('omits empty sections entirely', () => {
    const week = createEmptyWeek('2026-08-10');
    week.parts = week.parts.filter((p) => p.section !== 'ministry');
    const sections = buildMidweekSections(week, LABELS.en);

    expect(sections.map((s) => s.section)).toEqual(['treasures', 'living']);
    // Numbering stays continuous over the remaining parts.
    expect(sections.flatMap((s) => s.rows.map((r) => r.num))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('assignmentRolePair', () => {
  it('maps each split-cell part type to its role labels', () => {
    expect(assignmentRolePair('bible_reading', LABELS.en)).toEqual({
      primary: 'Student:',
      secondary: 'Assistant:',
    });
    expect(assignmentRolePair('student_talk', LABELS.ilo)).toEqual({
      primary: 'Estudiante:',
      secondary: 'Katulonganna:',
    });
    expect(assignmentRolePair('student_demo', LABELS.en)).toEqual({
      primary: 'Preacher:',
      secondary: 'House Holder:',
    });
    expect(assignmentRolePair('cbs', LABELS.ilo)).toEqual({
      primary: 'Konduktor:',
      secondary: 'Parabasa:',
    });
  });

  it('returns null for plain single-name parts', () => {
    expect(assignmentRolePair('talk', LABELS.en)).toBeNull();
    expect(assignmentRolePair('spiritual_gems', LABELS.en)).toBeNull();
    expect(assignmentRolePair('living_talk', LABELS.en)).toBeNull();
    expect(assignmentRolePair('service_talk', LABELS.en)).toBeNull();
    expect(assignmentRolePair('cbs_reader', LABELS.en)).toBeNull();
  });
});

describe('weekRange', () => {
  it('renders a same-month Monday-to-Sunday range', () => {
    expect(weekRange('2026-08-10', LABELS.ilo)).toBe('AGOSTO 10 – 16');
    expect(weekRange('2026-08-10', LABELS.en)).toBe('AUGUST 10 – 16');
  });

  it('names both months when the week crosses a month boundary', () => {
    expect(weekRange('2026-08-31', LABELS.en)).toBe('AUGUST 31 – SEPTEMBER 6');
    expect(weekRange('2026-08-31', LABELS.ilo)).toBe('AGOSTO 31 – SEPTIEMBRE 6');
  });

  it('falls back to the raw input for unparseable dates', () => {
    expect(weekRange('not-a-date', LABELS.en)).toBe('not-a-date');
  });
});

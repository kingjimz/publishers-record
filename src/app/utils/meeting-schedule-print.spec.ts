import { MeetingWeek } from '../services/meeting-schedule.service';
import {
  buildAssignmentSlipsDocument,
  buildMonthScheduleDocument,
  collectAssignmentSlips,
} from './meeting-schedule-print';
import { createEmptyWeek } from '../components/meeting-scheduler/meeting-defaults';

function sampleWeek(): MeetingWeek {
  const week = createEmptyWeek('2026-08-10');
  week.weekly_bible_reading = 'PROVERBS 12';
  week.chairman_name = 'John Chairman';
  week.public_talk_speaker_name = 'Visiting Speaker';
  week.speaker_congregation = 'North Congregation';
  week.wt_conductor_name = 'Sam Conductor';
  const reading = week.parts.find((p) => p.part_type === 'bible_reading')!;
  reading.assignee_name = 'Young Brother';
  const demo = week.parts.find((p) => p.part_type === 'student_demo')!;
  demo.assignee_name = 'Sister Student';
  demo.assistant_name = 'Sister Assistant';
  return week;
}

describe('buildMonthScheduleDocument', () => {
  it('renders the midweek document with section bands and no weekend content', () => {
    const html = buildMonthScheduleDocument(
      [sampleWeek()],
      'Test Congregation',
      'August 2026',
      'midweek'
    );
    expect(html).toContain("TREASURES FROM GOD'S WORD");
    expect(html).toContain('LIVING AS CHRISTIANS');
    expect(html).toContain('John Chairman');
    expect(html).toContain('PROVERBS 12');
    expect(html).not.toContain('Visiting Speaker');
    expect(html).not.toContain('WATCHTOWER STUDY');
  });

  it('renders the manual-sheet details: week range, cleaner group, labels, numbering', () => {
    const week = sampleWeek();
    week.cleaning_group = 'Group 1';
    const demoPart = week.parts.find((p) => p.part_type === 'student_demo')!;
    demoPart.setting = 'Panagbalaybalay';
    const html = buildMonthScheduleDocument([week], 'Test Congregation', 'August 2026', 'midweek', 'ilo');
    expect(html).toContain('AGOSTO 10 – 16');
    expect(html).toContain('GAMENG MANIPUD ITI SAO TI DIOS');
    expect(html).toContain('GROUP 1');
    expect(html).toContain('Tserman:');
    expect(html).toContain('Estudiante:</span> Young Brother');
    expect(html).toContain('Preacher:</span> Sister Student');
    expect(html).toContain('House Holder:</span> Sister Assistant');
    expect(html).toContain('<strong>1. Treasures Talk</strong> (10 min.)');
    expect(html).toContain('<strong>PANAGBALAYBALAY.</strong>');
  });

  it('groups two weeks per printed page', () => {
    const weeks = [sampleWeek(), sampleWeek(), sampleWeek()].map((w, i) => ({
      ...w,
      week_of: `2026-08-${String(3 + i * 7).padStart(2, '0')}`,
    }));
    const html = buildMonthScheduleDocument(weeks, 'Test Congregation', 'August 2026', 'midweek');
    expect(html.match(/class="sheet-page"/g)?.length).toBe(2);
    // CBS reader merges into the CBS row; the reader never gets its own number.
    expect(html).not.toContain('CBS Reader</strong>');
  });

  it('renders the weekend document with speaker and study, no CLM sections', () => {
    const html = buildMonthScheduleDocument(
      [sampleWeek()],
      'Test Congregation',
      'August 2026',
      'weekend'
    );
    expect(html).toContain('PUBLIC TALK');
    expect(html).toContain('WATCHTOWER STUDY');
    expect(html).toContain('Visiting Speaker, North Congregation');
    expect(html).toContain('Sam Conductor');
    expect(html).not.toContain("TREASURES FROM GOD'S WORD");
    expect(html).not.toContain('John Chairman');
  });

  it('renders no-meeting weeks as a full-height placeholder with the reason as headline', () => {
    const week = sampleWeek();
    week.week_type = 'no_meeting';
    week.parts = [];
    week.no_meeting_reason = 'Kombension ti Rehion';
    const html = buildMonthScheduleDocument([week], 'Test Congregation', 'August 2026', 'midweek');
    expect(html).toContain('class="week week-ph week-ph-mid"');
    expect(html).toContain('KOMBENSION TI REHION');
    expect(html).toContain('class="nm-sub">No meeting this week');
    expect(html).not.toContain('PUBLIC TALK');
    expect(html).not.toContain('Treasures Talk');
  });

  it('falls back to the no-meeting label as headline when no reason is set', () => {
    const week = sampleWeek();
    week.week_type = 'no_meeting';
    week.parts = [];
    const html = buildMonthScheduleDocument([week], 'Test Congregation', 'August 2026', 'midweek');
    expect(html).toContain('class="nm-headline">No meeting this week');
    expect(html).not.toContain('class="nm-sub"');
  });

  it('renders the no-meeting placeholder in Iloko and at weekend size', () => {
    const week = sampleWeek();
    week.week_type = 'no_meeting';
    week.parts = [];
    week.no_meeting_reason = 'Asamblea ti Sirkito';
    week.notes = 'Baguio Assembly Hall';
    const html = buildMonthScheduleDocument([week], 'Test Congregation', 'August 2026', 'weekend', 'ilo');
    expect(html).toContain('class="week week-ph week-ph-wknd"');
    expect(html).toContain('ASAMBLEA TI SIRKITO');
    expect(html).toContain('Awan ti gimong iti daytoy a lawas');
    expect(html).toContain('class="nm-notes">Baguio Assembly Hall');
  });

  it('escapes HTML in the no-meeting reason', () => {
    const week = sampleWeek();
    week.week_type = 'no_meeting';
    week.parts = [];
    week.no_meeting_reason = '<b>x</b>';
    const html = buildMonthScheduleDocument([week], 'Test Congregation', 'August 2026', 'midweek');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;B&gt;X&lt;/B&gt;');
  });

  it('prints publisher names in reading order, not the stored "Lastname, Firstname"', () => {
    const week = sampleWeek();
    week.chairman_name = 'Peñera, Eliezer';
    week.opening_prayer_name = 'Galase, Leniel';
    const reading = week.parts.find((p) => p.part_type === 'bible_reading')!;
    reading.assignee_name = 'Dacanay, King Jims';

    const html = buildMonthScheduleDocument([week], 'Test Congregation', 'August 2026', 'midweek');
    expect(html).toContain('Eliezer Peñera');
    expect(html).toContain('Leniel Galase');
    expect(html).toContain('King Jims Dacanay');
    expect(html).not.toContain('Peñera, Eliezer');
    expect(html).not.toContain('Dacanay, King Jims');
  });

  it('escapes HTML in user content', () => {
    const week = sampleWeek();
    week.chairman_name = '<script>alert(1)</script>';
    const html = buildMonthScheduleDocument([week], 'Test Congregation', 'August 2026', 'midweek');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('collectAssignmentSlips', () => {
  it('collects only assigned student parts', () => {
    const slips = collectAssignmentSlips([sampleWeek()]);
    expect(slips.length).toBe(2);
    expect(slips.map((s) => s.studentName)).toEqual(['Young Brother', 'Sister Student']);
    expect(slips[1].assistantName).toBe('Sister Assistant');
  });

  it('skips no-meeting weeks', () => {
    const week = sampleWeek();
    week.week_type = 'no_meeting';
    expect(collectAssignmentSlips([week])).toEqual([]);
  });
});

describe('buildAssignmentSlipsDocument', () => {
  it('renders one slip per assignment with the room checked', () => {
    const slips = collectAssignmentSlips([sampleWeek()]);
    const html = buildAssignmentSlipsDocument(slips, 'Test Congregation');
    expect(html.match(/class="slip"/g)?.length).toBe(2);
    expect(html).toContain('Sister Student');
    expect(html).toContain('☑ Main hall');
  });
});

import { MeetingWeek, WeekendSchedule } from '../services/meeting-schedule.service';
import { PublisherRecord } from '../services/supabase.service';
import { createEmptyWeek } from '../components/meeting-scheduler/meeting-defaults';
import {
  WEEKEND_RANGE_LABELS,
  activeWeekendSchedule,
  buildWeekendRowVM,
  computeScheduleEnd,
  consumesRotationSlot,
  groupWeekendRowsByMonth,
  mondayOf,
  nextSundayOnOrAfter,
  speakingPoolCount,
  sundayOf,
  weekendEventKey,
} from './weekend-range-model';

function week(weekOf: string, patch: Partial<MeetingWeek> = {}): MeetingWeek {
  const w = createEmptyWeek(weekOf);
  w.parts = [];
  return Object.assign(w, patch);
}

function publisher(patch: Partial<PublisherRecord>): PublisherRecord {
  return {
    service_year_start: 2026,
    publisher_name: 'Test, Publisher',
    inactive: false,
    date_of_birth: null,
    date_of_baptism: '2000-01-01',
    unbaptized_publisher: false,
    unbaptized_approved_on: null,
    gender: 'male',
    other_sheep: true,
    anointed: false,
    elder: false,
    ministerial_servant: false,
    regular_pioneer: false,
    special_pioneer: false,
    field_missionary: false,
    months: [],
    ...patch,
  };
}

describe('sundayOf', () => {
  it('uses weekend_date and falls back to week_of + 6', () => {
    expect(sundayOf(week('2026-08-24', { weekend_date: '2026-08-29' }))).toBe('2026-08-29');
    expect(sundayOf(week('2026-08-24', { weekend_date: null }))).toBe('2026-08-30');
  });
});

describe('weekendEventKey', () => {
  it('classifies full-width event rows', () => {
    expect(weekendEventKey(week('2026-08-24', { weekend_event: 'assembly' }))).toBe('assembly');
    expect(weekendEventKey(week('2026-08-24', { weekend_event: 'convention' }))).toBe('convention');
    expect(weekendEventKey(week('2026-08-24', { week_type: 'memorial' }))).toBe('memorial');
    expect(weekendEventKey(week('2026-08-24', { week_type: 'no_meeting' }))).toBe('no_meeting');
    expect(weekendEventKey(week('2026-08-24'))).toBeNull();
    expect(weekendEventKey(week('2026-08-24', { week_type: 'co_visit' }))).toBeNull();
    expect(weekendEventKey(week('2026-08-24', { weekend_event: 'symposium' }))).toBeNull();
  });
});

describe('buildWeekendRowVM', () => {
  it('derives day, month, year, and the numbered theme from the meeting Sunday', () => {
    const vm = buildWeekendRowVM(
      week('2026-08-24', { public_talk_number: 175, public_talk_theme: 'Tema' })
    );
    expect(vm.sunday).toBe('2026-08-30');
    expect(vm.day).toBe(30);
    expect(vm.monthIndex).toBe(7);
    expect(vm.year).toBe(2026);
    expect(vm.kind).toBe('regular');
    expect(vm.themeText).toBe('175. Tema');
  });

  it('keeps free-text themes without a number', () => {
    expect(buildWeekendRowVM(week('2026-08-24', { public_talk_theme: 'Drama' })).themeText).toBe(
      'Drama'
    );
    expect(buildWeekendRowVM(week('2026-08-24')).themeText).toBe('');
  });

  it('classifies row kinds with event first, then C.O. visit, then weekend event', () => {
    expect(buildWeekendRowVM(week('2026-08-24', { weekend_event: 'assembly' })).kind).toBe('event');
    expect(
      buildWeekendRowVM(week('2026-08-24', { week_type: 'co_visit', weekend_event: 'symposium' }))
        .kind
    ).toBe('co_visit');
    expect(buildWeekendRowVM(week('2026-08-24', { weekend_event: 'symposium' })).kind).toBe(
      'symposium'
    );
    expect(buildWeekendRowVM(week('2026-08-24', { weekend_event: 'special_talk' })).kind).toBe(
      'special_talk'
    );
  });

  it('lets notes override the default event label', () => {
    const plain = buildWeekendRowVM(week('2026-08-24', { weekend_event: 'assembly' }));
    expect(plain.eventLabel).toBe('Circuit Assembly Week');
    const custom = buildWeekendRowVM(
      week('2026-08-24', { weekend_event: 'assembly', notes: ' Asambleya ' })
    );
    expect(custom.eventLabel).toBe('Asambleya');
    expect(buildWeekendRowVM(week('2026-08-24')).eventLabel).toBeNull();
  });
});

describe('groupWeekendRowsByMonth', () => {
  const labels = WEEKEND_RANGE_LABELS.ilo;

  it('groups consecutive rows of the same month', () => {
    const rows = ['2026-08-24', '2026-08-31', '2026-09-07'].map((w) =>
      buildWeekendRowVM(week(w))
    );
    const groups = groupWeekendRowsByMonth(rows, labels);
    expect(groups.map((g) => g.monthName)).toEqual(['Agosto', 'Setiembre']);
    expect(groups[0].rows.length).toBe(1); // Aug 30
    expect(groups[1].rows.length).toBe(2); // Sep 6, Sep 13
  });

  it('separates the same month across a year boundary', () => {
    const rows = ['2026-12-21', '2027-12-20'].map((w) => buildWeekendRowVM(week(w)));
    const groups = groupWeekendRowsByMonth(rows, labels);
    expect(groups.length).toBe(2);
    expect(groups[0].monthName).toBe('Disiembre');
    expect(groups[0].year).toBe(2026);
    expect(groups[1].year).toBe(2027);
  });
});

describe('speakingPoolCount', () => {
  it('counts active elders and ministerial servants only', () => {
    const pool = [
      publisher({ elder: true }),
      publisher({ ministerial_servant: true }),
      publisher({ elder: true, inactive: true }),
      publisher({}),
    ];
    expect(speakingPoolCount(pool)).toBe(2);
  });
});

describe('consumesRotationSlot', () => {
  it('treats missing rows and regular weeks as speaking Sundays', () => {
    expect(consumesRotationSlot(undefined)).toBe(true);
    expect(consumesRotationSlot(week('2026-08-24'))).toBe(true);
    expect(consumesRotationSlot(week('2026-08-24', { weekend_event: 'symposium' }))).toBe(true);
  });

  it('skips event weeks', () => {
    expect(consumesRotationSlot(week('2026-08-24', { weekend_event: 'assembly' }))).toBe(false);
    expect(consumesRotationSlot(week('2026-08-24', { weekend_event: 'convention' }))).toBe(false);
    expect(consumesRotationSlot(week('2026-08-24', { week_type: 'memorial' }))).toBe(false);
    expect(consumesRotationSlot(week('2026-08-24', { week_type: 'no_meeting' }))).toBe(false);
  });

  it('counts a C.O. visit only when a local talk is scheduled', () => {
    expect(consumesRotationSlot(week('2026-08-24', { week_type: 'co_visit' }))).toBe(false);
    expect(
      consumesRotationSlot(
        week('2026-08-24', { week_type: 'co_visit', public_talk_speaker_name: 'Doe, John' })
      )
    ).toBe(true);
  });
});

describe('computeScheduleEnd', () => {
  const byS = (weeks: MeetingWeek[]) => new Map(weeks.map((w) => [sundayOf(w), w]));

  it('spans start + (N-1) weeks when there are no events', () => {
    expect(computeScheduleEnd('2026-08-30', 4, new Map())).toBe('2026-09-20');
    expect(computeScheduleEnd('2026-08-30', 1, new Map())).toBe('2026-08-30');
  });

  it('extends past interleaved event weeks', () => {
    const weeks = byS([
      week('2026-09-07', { weekend_event: 'assembly' }), // Sunday Sep 13
      week('2026-09-28', { week_type: 'no_meeting' }), // Sunday Oct 4
    ]);
    // Speaking Sundays: Aug 30, Sep 6, Sep 20, Sep 27, Oct 11 (4th slot pushed twice)
    expect(computeScheduleEnd('2026-08-30', 5, weeks)).toBe('2026-10-11');
  });

  it('crosses year boundaries', () => {
    expect(computeScheduleEnd('2026-12-20', 3, new Map())).toBe('2027-01-03');
  });

  it('never loops past the iteration cap when everything is an event', () => {
    const events = new Map<string, MeetingWeek>();
    let sunday = '2026-08-30';
    for (let i = 0; i < 300; i++) {
      events.set(sunday, week(mondayOf(sunday), { weekend_event: 'assembly' }));
      const d = new Date(`${sunday}T00:00:00`);
      d.setDate(d.getDate() + 7);
      sunday = d.toISOString().slice(0, 10);
    }
    const end = computeScheduleEnd('2026-08-30', 2, events);
    expect(end > '2026-08-30').toBe(true); // returned, did not hang
  });
});

describe('activeWeekendSchedule', () => {
  const schedule = (start: string, end: string): WeekendSchedule => ({
    start_sunday: start,
    end_sunday: end,
    range_label: null,
    speaker_count: 10,
  });

  it('picks the cycle covering today', () => {
    const schedules = [schedule('2026-12-27', '2027-04-25'), schedule('2026-08-30', '2026-12-20')];
    expect(activeWeekendSchedule(schedules, '2026-10-01')?.start_sunday).toBe('2026-08-30');
    expect(activeWeekendSchedule(schedules, '2027-01-15')?.start_sunday).toBe('2026-12-27');
  });

  it('falls back to the latest cycle when all have ended, and null when empty', () => {
    const schedules = [schedule('2026-08-30', '2026-12-20')];
    expect(activeWeekendSchedule(schedules, '2027-06-01')?.start_sunday).toBe('2026-08-30');
    expect(activeWeekendSchedule([], '2026-10-01')).toBeNull();
  });
});

describe('date helpers', () => {
  it('nextSundayOnOrAfter keeps Sundays and advances other days', () => {
    expect(nextSundayOnOrAfter('2026-08-30')).toBe('2026-08-30'); // Sunday
    expect(nextSundayOnOrAfter('2026-08-24')).toBe('2026-08-30'); // Monday
    expect(nextSundayOnOrAfter('2026-08-29')).toBe('2026-08-30'); // Saturday
  });

  it('mondayOf returns the week_of for a meeting Sunday', () => {
    expect(mondayOf('2026-08-30')).toBe('2026-08-24');
  });
});

import {
  addDaysIso,
  assistantWarning,
  buildDefaultWeekParts,
  createEmptyWeek,
  eligibilityWarning,
  partnerRecencyWarning,
  recencyWarning,
  PART_TYPE_RULES,
} from './meeting-defaults';
import {
  buildAssignmentHistory,
  PublisherTypeHistory,
} from '../../services/meeting-schedule.service';
import { PublisherRecord } from '../../services/supabase.service';

function publisher(overrides: Partial<PublisherRecord>): PublisherRecord {
  return {
    service_year_start: 2025,
    publisher_name: 'Test Publisher',
    date_of_birth: null,
    date_of_baptism: '2010-01-01',
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
    ...overrides,
  };
}

describe('buildDefaultWeekParts', () => {
  it('builds the regular week with CBS and reader', () => {
    const parts = buildDefaultWeekParts('regular');
    expect(parts.some((p) => p.part_type === 'cbs')).toBe(true);
    expect(parts.some((p) => p.part_type === 'cbs_reader')).toBe(true);
    expect(parts.some((p) => p.part_type === 'service_talk')).toBe(false);
    expect(parts.filter((p) => p.section === 'treasures').length).toBe(3);
  });

  it('swaps CBS for the service talk on CO visit weeks', () => {
    const parts = buildDefaultWeekParts('co_visit');
    expect(parts.some((p) => p.part_type === 'cbs')).toBe(false);
    expect(parts.some((p) => p.part_type === 'cbs_reader')).toBe(false);
    expect(parts.some((p) => p.part_type === 'service_talk')).toBe(true);
  });

  it('returns no parts for no-meeting and memorial weeks', () => {
    expect(buildDefaultWeekParts('no_meeting')).toEqual([]);
    expect(buildDefaultWeekParts('memorial')).toEqual([]);
  });
});

describe('createEmptyWeek', () => {
  it('sets midweek date to the Monday and weekend date to the Sunday', () => {
    const week = createEmptyWeek('2026-08-10');
    expect(week.midweek_date).toBe('2026-08-10');
    expect(week.weekend_date).toBe('2026-08-16');
    expect(week.parts.length).toBeGreaterThan(0);
  });
});

describe('addDaysIso', () => {
  it('crosses month boundaries', () => {
    expect(addDaysIso('2026-08-31', 6)).toBe('2026-09-06');
  });
});

describe('eligibilityWarning', () => {
  it('warns when a sister is picked for a male-only part', () => {
    const sister = publisher({ gender: 'female' });
    expect(eligibilityWarning(sister, 'male')).not.toBeNull();
    expect(eligibilityWarning(sister, 'any')).toBeNull();
  });

  it('warns for elder_ms parts when the publisher is neither', () => {
    expect(eligibilityWarning(publisher({}), 'elder_ms')).not.toBeNull();
    expect(eligibilityWarning(publisher({ ministerial_servant: true }), 'elder_ms')).toBeNull();
    expect(eligibilityWarning(publisher({ elder: true }), 'elder_ms')).toBeNull();
  });

  it('requires an elder for elder-only parts', () => {
    expect(eligibilityWarning(publisher({ ministerial_servant: true }), 'elder')).not.toBeNull();
    expect(eligibilityWarning(publisher({ elder: true }), 'elder')).toBeNull();
  });

  it('flags unbaptized publishers for prayers', () => {
    const unbaptized = publisher({ date_of_baptism: null, unbaptized_publisher: true });
    expect(eligibilityWarning(unbaptized, 'baptized_male')).not.toBeNull();
    expect(eligibilityWarning(publisher({}), 'baptized_male')).toBeNull();
  });

  it('is silent when the publisher is unknown', () => {
    expect(eligibilityWarning(undefined, 'elder')).toBeNull();
  });
});

describe('assistantWarning', () => {
  it('warns on cross-gender pairings only', () => {
    const brother = publisher({});
    const sister = publisher({ gender: 'female' });
    expect(assistantWarning(brother, sister)).not.toBeNull();
    expect(assistantWarning(sister, publisher({ gender: 'female' }))).toBeNull();
    expect(assistantWarning(brother, undefined)).toBeNull();
  });
});

describe('PART_TYPE_RULES', () => {
  it('only student demonstrations take an assistant', () => {
    const withAssistant = Object.entries(PART_TYPE_RULES)
      .filter(([, rule]) => rule.assistant !== 'none')
      .map(([type]) => type);
    expect(withAssistant).toEqual(['student_demo']);
  });
});

describe('recencyWarning', () => {
  const detail = (key: string, dates: string[]): PublisherTypeHistory =>
    new Map([[key, dates.map((date) => ({ date, title: null, partner: null }))]]);

  it('warns when the same part type falls inside the window', () => {
    expect(recencyWarning(detail('talk', ['2026-07-20']), 'talk', '2026-08-17')).toMatch(/Had/);
  });

  it('is silent outside the window', () => {
    expect(recencyWarning(detail('talk', ['2026-01-05']), 'talk', '2026-08-17')).toBeNull();
  });

  it('never warns about the week being edited itself', () => {
    expect(recencyWarning(detail('talk', ['2026-08-17']), 'talk', '2026-08-17')).toBeNull();
  });

  it('warns about a nearby future week (double booking)', () => {
    expect(recencyWarning(detail('talk', ['2026-09-07']), 'talk', '2026-08-17')).toMatch(/Also has/);
  });

  it('treats all prayer slots as one rotation group', () => {
    const d = detail('closing_prayer_name', ['2026-08-03']);
    expect(recencyWarning(d, 'weekend_opening_prayer_name', '2026-08-17')).not.toBeNull();
  });

  it('ignores other part types', () => {
    expect(recencyWarning(detail('cbs', ['2026-08-10']), 'talk', '2026-08-17')).toBeNull();
  });

  it('is silent for unknown publishers or missing context', () => {
    expect(recencyWarning(undefined, 'talk', '2026-08-17')).toBeNull();
    expect(recencyWarning(detail('talk', ['2026-08-10']), null, '2026-08-17')).toBeNull();
    expect(recencyWarning(detail('talk', ['2026-08-10']), 'talk', null)).toBeNull();
  });

  it('respects a custom window', () => {
    const d = detail('talk', ['2026-07-20']);
    expect(recencyWarning(d, 'talk', '2026-08-17', 2)).toBeNull();
    expect(recencyWarning(d, 'talk', '2026-08-17', 8)).not.toBeNull();
  });
});

describe('partnerRecencyWarning', () => {
  const detailWithPartner = (key: string, date: string, partner: string): PublisherTypeHistory =>
    new Map([[key, [{ date, title: null, partner }]]]);

  it('warns when the same pairing happened within 6 months', () => {
    const d = detailWithPartner('assistant', '2026-06-01', 'Reyes, Pedro');
    expect(partnerRecencyWarning(d, 'Reyes, Pedro', '2026-08-17')).toMatch(/paired with/);
  });

  it('is silent beyond the window', () => {
    const d = detailWithPartner('assistant', '2025-12-01', 'Reyes, Pedro');
    expect(partnerRecencyWarning(d, 'Reyes, Pedro', '2026-08-17')).toBeNull();
  });

  it('ignores different partners', () => {
    const d = detailWithPartner('assistant', '2026-08-03', 'Cruz, Juan');
    expect(partnerRecencyWarning(d, 'Reyes, Pedro', '2026-08-17')).toBeNull();
  });

  it('never warns about the week being edited itself', () => {
    const d = detailWithPartner('assistant', '2026-08-17', 'Reyes, Pedro');
    expect(partnerRecencyWarning(d, 'Reyes, Pedro', '2026-08-17')).toBeNull();
  });

  it('matches pairings recorded under any history key', () => {
    const d = detailWithPartner('student_demo', '2026-07-06', 'Reyes, Pedro');
    expect(partnerRecencyWarning(d, 'Reyes, Pedro', '2026-08-17')).not.toBeNull();
  });

  it('is silent for missing detail, partner, or week', () => {
    const d = detailWithPartner('assistant', '2026-08-03', 'Reyes, Pedro');
    expect(partnerRecencyWarning(undefined, 'Reyes, Pedro', '2026-08-17')).toBeNull();
    expect(partnerRecencyWarning(d, null, '2026-08-17')).toBeNull();
    expect(partnerRecencyWarning(d, 'Reyes, Pedro', null)).toBeNull();
  });
});

describe('buildAssignmentHistory', () => {
  const week = (id: string, weekOf: string, roles: Record<string, string> = {}) =>
    ({ id, week_of: weekOf, ...roles }) as Parameters<typeof buildAssignmentHistory>[0][number];

  it('folds week roles and parts into per-key events, newest first', () => {
    const history = buildAssignmentHistory(
      [
        week('w1', '2026-08-03', { chairman_name: 'Cruz, Juan' }),
        week('w2', '2026-08-10', { chairman_name: 'Cruz, Juan' }),
      ],
      [
        { meeting_id: 'w1', assignee_name: 'Cruz, Juan', assistant_name: null, part_type: 'talk', title: 'Treasures Talk' },
        { meeting_id: 'w2', assignee_name: 'Reyes, Pedro', assistant_name: 'Santos, Ana', part_type: 'student_demo', title: 'Following Up' },
      ]
    );

    const juan = history.byPublisher.get('Cruz, Juan')!;
    expect(juan.get('chairman_name')!.map((e) => e.date)).toEqual(['2026-08-10', '2026-08-03']);
    expect(juan.get('talk')![0]).toEqual({
      date: '2026-08-03',
      title: 'Treasures Talk',
      partner: null,
    });

    const ana = history.byPublisher.get('Santos, Ana')!;
    expect(ana.get('assistant')![0].title).toBe('Following Up');
  });

  it('records the demo partner on both sides of the pairing', () => {
    const history = buildAssignmentHistory(
      [week('w1', '2026-08-03')],
      [
        {
          meeting_id: 'w1',
          assignee_name: 'Reyes, Pedro',
          assistant_name: 'Santos, Ana',
          part_type: 'student_demo',
          title: 'Starting a Conversation',
        },
      ]
    );

    const student = history.byPublisher.get('Reyes, Pedro')!.get('student_demo')![0];
    expect(student.partner).toBe('Santos, Ana');

    const assistant = history.byPublisher.get('Santos, Ana')!.get('assistant')![0];
    expect(assistant.partner).toBe('Reyes, Pedro');
  });

  it('leaves partner null for solo parts, roles, and blank assistants', () => {
    const history = buildAssignmentHistory(
      [week('w1', '2026-08-03', { chairman_name: 'Cruz, Juan' })],
      [
        {
          meeting_id: 'w1',
          assignee_name: 'Reyes, Pedro',
          assistant_name: '  ',
          part_type: 'bible_reading',
          title: null,
        },
      ]
    );

    expect(history.byPublisher.get('Cruz, Juan')!.get('chairman_name')![0].partner).toBeNull();
    expect(history.byPublisher.get('Reyes, Pedro')!.get('bible_reading')![0].partner).toBeNull();
  });

  it('keeps lastAssigned as the most recent date across everything', () => {
    const history = buildAssignmentHistory(
      [week('w1', '2026-08-03', { chairman_name: 'Cruz, Juan' })],
      [{ meeting_id: 'w1', assignee_name: 'Cruz, Juan', assistant_name: null, part_type: 'talk', title: null }]
    );
    expect(history.lastAssigned.get('Cruz, Juan')).toBe('2026-08-03');
  });

  it('skips blank names and parts with unknown weeks', () => {
    const history = buildAssignmentHistory(
      [week('w1', '2026-08-03')],
      [
        { meeting_id: 'w1', assignee_name: '  ', assistant_name: null, part_type: 'talk', title: null },
        { meeting_id: 'missing', assignee_name: 'Cruz, Juan', assistant_name: null, part_type: 'talk', title: null },
      ]
    );
    expect(history.byPublisher.size).toBe(0);
    expect(history.lastAssigned.size).toBe(0);
  });
});

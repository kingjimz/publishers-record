import {
  addDaysIso,
  assistantWarning,
  buildDefaultWeekParts,
  createEmptyWeek,
  eligibilityWarning,
  PART_TYPE_RULES,
} from './meeting-defaults';
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

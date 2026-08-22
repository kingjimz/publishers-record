import {
  AssignmentEvent,
  MeetingPart,
  MeetingPartType,
  MeetingWeek,
  MeetingWeekType,
  PublisherTypeHistory,
} from '../../services/meeting-schedule.service';
import { PublisherRecord } from '../../services/supabase.service';
import { displayPublisherName } from '../../utils/publisher-name';

/**
 * Assignment eligibility per the CLM meeting instructions (S-38). These are
 * soft guidance only: the picker shows a warning but never blocks a choice,
 * since local circumstances (qualified MS, visiting speakers) vary.
 */
export type Eligibility = 'elder_ms' | 'elder' | 'baptized_male' | 'male' | 'any';

export interface PartRule {
  eligibility: Eligibility;
  assistant: 'none' | 'same_gender';
}

export const PART_TYPE_RULES: Record<MeetingPartType, PartRule> = {
  talk: { eligibility: 'elder_ms', assistant: 'none' },
  spiritual_gems: { eligibility: 'elder_ms', assistant: 'none' },
  bible_reading: { eligibility: 'male', assistant: 'same_gender' },
  student_demo: { eligibility: 'any', assistant: 'same_gender' },
  student_talk: { eligibility: 'male', assistant: 'none' },
  ministry_discussion: { eligibility: 'elder_ms', assistant: 'none' },
  living_talk: { eligibility: 'elder_ms', assistant: 'none' },
  cbs: { eligibility: 'elder', assistant: 'none' },
  cbs_reader: { eligibility: 'male', assistant: 'none' },
  service_talk: { eligibility: 'elder', assistant: 'none' },
  other: { eligibility: 'any', assistant: 'none' },
};

/** Week-level roles (columns on meeting_weeks) and their eligibility. */
export const ROLE_RULES: Record<string, Eligibility> = {
  chairman_name: 'elder_ms',
  opening_prayer_name: 'baptized_male',
  closing_prayer_name: 'baptized_male',
  weekend_chairman_name: 'elder_ms',
  public_talk_speaker_name: 'elder_ms',
  wt_conductor_name: 'elder',
  wt_reader_name: 'male',
  weekend_opening_prayer_name: 'baptized_male',
  weekend_closing_prayer_name: 'baptized_male',
};

export const PART_TYPE_LABELS: Record<MeetingPartType, string> = {
  talk: 'Talk (Treasures)',
  spiritual_gems: 'Spiritual Gems',
  bible_reading: 'Bible Reading',
  student_demo: 'Student Demonstration',
  student_talk: 'Student Talk',
  ministry_discussion: 'Discussion (Ministry)',
  living_talk: 'Living as Christians Part',
  cbs: 'Congregation Bible Study',
  cbs_reader: 'CBS Reader',
  service_talk: 'Service Talk (CO)',
  other: 'Other',
};

/** Part types that produce a printable student assignment slip (S-89 style). */
export const STUDENT_PART_TYPES: readonly MeetingPartType[] = [
  'bible_reading',
  'student_demo',
  'student_talk',
];

function part(
  section: MeetingPart['section'],
  sortOrder: number,
  title: string,
  minutes: number | null,
  partType: MeetingPartType
): MeetingPart {
  return {
    section,
    sort_order: sortOrder,
    title,
    duration_minutes: minutes,
    part_type: partType,
    setting: null,
    assignee_name: null,
    assistant_name: null,
    room: 'main',
  };
}

/**
 * Default midweek program skeleton. Regular weeks follow the common workbook
 * shape; circuit overseer weeks drop the CBS and add the service talk.
 * Titles are placeholders the secretary overwrites (or the import fills).
 */
export function buildDefaultWeekParts(weekType: MeetingWeekType): MeetingPart[] {
  if (weekType === 'no_meeting' || weekType === 'memorial') return [];

  const parts: MeetingPart[] = [
    part('treasures', 0, 'Treasures Talk', 10, 'talk'),
    part('treasures', 1, 'Spiritual Gems', 10, 'spiritual_gems'),
    part('treasures', 2, 'Bible Reading', 4, 'bible_reading'),
    part('ministry', 0, 'Starting a Conversation', 3, 'student_demo'),
    part('ministry', 1, 'Following Up', 4, 'student_demo'),
    part('ministry', 2, 'Making Disciples', 5, 'student_demo'),
    part('living', 0, 'Living as Christians Part', 15, 'living_talk'),
  ];

  if (weekType === 'co_visit') {
    parts.push(part('living', 1, 'Service Talk by Circuit Overseer', 30, 'service_talk'));
  } else {
    parts.push(part('living', 1, 'Congregation Bible Study', 30, 'cbs'));
    parts.push(part('living', 2, 'CBS Reader', null, 'cbs_reader'));
  }

  return parts;
}

/** ISO date (yyyy-mm-dd) offset by `days` from another ISO date. */
export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/** New in-memory week for a given Monday, prefilled from the default template. */
export function createEmptyWeek(weekOfIso: string, weekType: MeetingWeekType = 'regular'): MeetingWeek {
  return {
    week_of: weekOfIso,
    week_type: weekType,
    notes: null,
    cleaning_group: null,
    midweek_date: weekOfIso,
    weekly_bible_reading: null,
    song_opening: null,
    song_middle: null,
    song_closing: null,
    chairman_name: null,
    opening_prayer_name: null,
    closing_prayer_name: null,
    weekend_date: addDaysIso(weekOfIso, 6),
    weekend_chairman_name: null,
    public_talk_theme: null,
    public_talk_speaker_name: null,
    speaker_congregation: null,
    wt_article_title: null,
    wt_conductor_name: null,
    wt_reader_name: null,
    weekend_opening_prayer_name: null,
    weekend_closing_prayer_name: null,
    weekend_song_opening: null,
    weekend_song_middle: null,
    weekend_song_closing: null,
    parts: buildDefaultWeekParts(weekType),
  };
}

/**
 * Soft-warning text when a publisher does not match the eligibility guidance,
 * or null when the pick looks fine. Never blocks the assignment.
 */
export function eligibilityWarning(
  publisher: PublisherRecord | undefined,
  eligibility: Eligibility
): string | null {
  if (!publisher) return null;

  const isMale = publisher.gender === 'male';
  const isBaptized = !publisher.unbaptized_publisher && !!publisher.date_of_baptism;
  const isElder = !!publisher.elder;
  const isMs = !!publisher.ministerial_servant;

  switch (eligibility) {
    case 'elder':
      if (!isElder) return 'Usually handled by an elder.';
      return null;
    case 'elder_ms':
      if (!isElder && !isMs) return 'Usually handled by an elder or ministerial servant.';
      return null;
    case 'baptized_male':
      if (!isMale) return 'Usually handled by a baptized brother.';
      if (!isBaptized) return 'Publisher is not recorded as baptized.';
      return null;
    case 'male':
      if (!isMale) return 'This part is usually assigned to a brother.';
      return null;
    case 'any':
    default:
      return null;
  }
}

/** Soft warning for a student/assistant pairing (assistants should be the same gender). */
export function assistantWarning(
  student: PublisherRecord | undefined,
  assistant: PublisherRecord | undefined
): string | null {
  if (!student || !assistant) return null;
  if (student.gender && assistant.gender && student.gender !== assistant.gender) {
    return 'Assistants are usually the same gender as the student.';
  }
  return null;
}

/** Soft rotation window: the same part type within this many weeks draws a warning. */
export const RECENCY_WINDOW_WEEKS = 8;

/** Display labels for every history key: part types, week-level roles, assistant slots. */
export const HISTORY_KEY_LABELS: Record<string, string> = {
  ...PART_TYPE_LABELS,
  chairman_name: 'Chairman (Midweek)',
  opening_prayer_name: 'Opening Prayer (Midweek)',
  closing_prayer_name: 'Closing Prayer (Midweek)',
  weekend_chairman_name: 'Chairman (Weekend)',
  public_talk_speaker_name: 'Public Talk Speaker',
  wt_conductor_name: 'Watchtower Conductor',
  wt_reader_name: 'Watchtower Reader',
  weekend_opening_prayer_name: 'Opening Prayer (Weekend)',
  weekend_closing_prayer_name: 'Closing Prayer (Weekend)',
  assistant: 'Assistant',
};

const PRAYER_KEYS = [
  'opening_prayer_name',
  'closing_prayer_name',
  'weekend_opening_prayer_name',
  'weekend_closing_prayer_name',
];

/** History keys treated as equivalent for rotation purposes (a prayer is a prayer). */
export function recencyKeyGroup(historyKey: string): string[] {
  return PRAYER_KEYS.includes(historyKey) ? PRAYER_KEYS : [historyKey];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Nearest event to `weekOf` (either direction) within the window, skipping the week itself. */
function nearestEventWithin(
  events: Iterable<AssignmentEvent>,
  weekOf: string,
  windowWeeks: number,
  matches: (event: AssignmentEvent) => boolean = () => true
): { date: string; distanceMs: number } | null {
  const target = new Date(`${weekOf}T00:00:00`).getTime();
  if (Number.isNaN(target)) return null;

  const windowMs = windowWeeks * WEEK_MS;
  let nearest: { date: string; distanceMs: number } | null = null;
  for (const event of events) {
    if (event.date === weekOf || !matches(event)) continue;
    const then = new Date(`${event.date}T00:00:00`).getTime();
    if (Number.isNaN(then)) continue;
    const distanceMs = Math.abs(target - then);
    if (distanceMs <= windowMs && (!nearest || distanceMs < nearest.distanceMs)) {
      nearest = { date: event.date, distanceMs };
    }
  }
  return nearest;
}

/** "the same week" / "1 wk" / "5 wks" plus a short date, e.g. "(Jul 12)". */
function distanceWording(nearest: { date: string; distanceMs: number }): {
  distance: string;
  when: string;
  sameWeek: boolean;
} {
  const weeks = Math.round(nearest.distanceMs / WEEK_MS);
  const when = new Date(`${nearest.date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  return {
    distance: weeks <= 0 ? 'the same week' : weeks === 1 ? '1 wk' : `${weeks} wks`,
    when,
    sameWeek: weeks <= 0,
  };
}

/**
 * Soft-warning text when the publisher already had this part type close to the
 * week being scheduled (past or upcoming), or null when the rotation looks fine.
 * The week being edited itself never warns, so a saved assignment stays quiet.
 */
export function recencyWarning(
  detail: PublisherTypeHistory | undefined,
  historyKey: string | null,
  weekOf: string | null,
  windowWeeks = RECENCY_WINDOW_WEEKS
): string | null {
  if (!detail || !historyKey || !weekOf) return null;

  const events = recencyKeyGroup(historyKey).flatMap((key) => detail.get(key) ?? []);
  const nearest = nearestEventWithin(events, weekOf, windowWeeks);
  if (!nearest) return null;

  const label = HISTORY_KEY_LABELS[historyKey] ?? historyKey;
  const { distance, when, sameWeek } = distanceWording(nearest);
  if (nearest.date > weekOf) {
    return sameWeek
      ? `Also has "${label}" ${distance} (${when}).`
      : `Also has "${label}" ${distance} later (${when}).`;
  }
  return sameWeek
    ? `Had "${label}" ${distance} (${when}).`
    : `Had "${label}" ${distance} ago (${when}).`;
}

/** Soft rotation window for repeat student/assistant pairings (~6 months). */
export const PARTNER_WINDOW_WEEKS = 26;

/**
 * Soft-warning text when the candidate already worked with the same partner
 * (student/assistant pairing) close to the week being scheduled, or null when
 * the pairing is fresh enough. Never blocks the assignment.
 */
export function partnerRecencyWarning(
  detail: PublisherTypeHistory | undefined,
  partner: string | null,
  weekOf: string | null,
  windowWeeks = PARTNER_WINDOW_WEEKS
): string | null {
  if (!detail || !partner || !weekOf) return null;

  const events = [...detail.values()].flat();
  const nearest = nearestEventWithin(events, weekOf, windowWeeks, (e) => e.partner === partner);
  if (!nearest) return null;

  const name = displayPublisherName(partner);
  const { distance, when, sameWeek } = distanceWording(nearest);
  if (nearest.date > weekOf) {
    return sameWeek
      ? `Also paired with ${name} ${distance} (${when}).`
      : `Also paired with ${name} ${distance} later (${when}).`;
  }
  return sameWeek
    ? `Was paired with ${name} ${distance} (${when}).`
    : `Was paired with ${name} ${distance} ago (${when}).`;
}

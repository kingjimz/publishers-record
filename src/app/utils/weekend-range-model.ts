import { MeetingWeek, WeekendSchedule } from '../services/meeting-schedule.service';
import { PublisherRecord } from '../services/supabase.service';
import { addDaysIso } from '../components/meeting-scheduler/meeting-defaults';
import { ScheduleLanguage } from './meeting-schedule-model';

/**
 * Shared model for the weekend public talk range schedule: the same labels,
 * row classification, and month grouping drive both the on-screen editable
 * sheet (weekend-range-sheet.component) and the printed/exported document
 * (weekend-range-print.ts). Keep every rendering decision here so the two
 * can never drift apart.
 */

export interface WeekendRangeLabels {
  title: string;
  date: string;
  speaker: string;
  chairman: string;
  theme: string;
  reader: string;
  symposium: string;
  months: string[];
}

export const WEEKEND_RANGE_LABELS: Record<ScheduleLanguage, WeekendRangeLabels> = {
  en: {
    title: 'Public Talk Schedule',
    date: 'Date',
    speaker: 'Speaker',
    chairman: 'Chairman',
    theme: 'Theme',
    reader: 'Paragraph Reader (Watchtower)',
    symposium: 'Symposium:',
    months: [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ],
  },
  ilo: {
    title: 'Eskedyul Para iti Palawag Publiko',
    date: 'Petsa',
    speaker: 'Ispiker',
    chairman: 'Tserman',
    theme: 'Tema',
    reader: 'Parabasa iti Parapo (Pagwanawanan)',
    symposium: 'Simposium:',
    months: [
      'Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunio',
      'Hulio', 'Agosto', 'Setiembre', 'Oktubre', 'Nobiembre', 'Disiembre',
    ],
  },
};

export function weekendRangeLabels(language: ScheduleLanguage): WeekendRangeLabels {
  return WEEKEND_RANGE_LABELS[language] ?? WEEKEND_RANGE_LABELS.ilo;
}

/** Full-width event labels, kept in English like the congregation's sheet. */
export const WEEKEND_EVENT_LABELS: Record<string, string> = {
  assembly: 'Circuit Assembly Week',
  convention: 'Regional Convention Week',
  memorial: 'Memorial',
  no_meeting: 'No Meeting',
};

/** Band + header background of the printed sheet (asserted by the sheet spec). */
export const WEEKEND_BAND_COLOR = '#2f5496';

/** "Agosto – Disiembre 2026" (or "Nobiembre 2026 – Marso 2027" across years). */
export function weekendRangeLabel(
  startMonth: string,
  endMonth: string,
  language: ScheduleLanguage = 'ilo'
): string {
  const labels = weekendRangeLabels(language);
  const [startYear, startM] = startMonth.split('-').map(Number);
  const [endYear, endM] = endMonth.split('-').map(Number);
  const start = labels.months[startM - 1];
  const end = labels.months[endM - 1];
  if (startYear !== endYear) return `${start} ${startYear} – ${end} ${endYear}`;
  if (startM === endM) return `${start} ${startYear}`;
  return `${start} – ${end} ${startYear}`;
}

/** Sunday the weekend meeting is held (falls back to week_of + 6). */
export function sundayOf(week: MeetingWeek): string {
  return week.weekend_date ?? addDaysIso(week.week_of, 6);
}

export type WeekendEventKey = 'assembly' | 'convention' | 'memorial' | 'no_meeting';

/** Full-width event row key, or null for a week with its own program row. */
export function weekendEventKey(week: MeetingWeek): WeekendEventKey | null {
  if (week.weekend_event === 'assembly' || week.weekend_event === 'convention') {
    return week.weekend_event;
  }
  if (week.week_type === 'memorial') return 'memorial';
  if (week.week_type === 'no_meeting') return 'no_meeting';
  return null;
}

export type WeekendRowKind = 'event' | 'co_visit' | 'symposium' | 'special_talk' | 'regular';

export interface WeekendRowVM {
  week: MeetingWeek;
  /** Meeting Sunday, ISO. */
  sunday: string;
  day: number;
  monthIndex: number;
  year: number;
  kind: WeekendRowKind;
  /** Unescaped label for event rows (notes override the default); null otherwise. */
  eventLabel: string | null;
  /** Unescaped "175. Title" (or free text) for non-event rows; empty when unset. */
  themeText: string;
}

export function buildWeekendRowVM(week: MeetingWeek): WeekendRowVM {
  const sunday = sundayOf(week);
  const [year, month, day] = sunday.split('-').map(Number);
  const eventKey = weekendEventKey(week);

  const kind: WeekendRowKind = eventKey
    ? 'event'
    : week.week_type === 'co_visit'
      ? 'co_visit'
      : week.weekend_event === 'symposium'
        ? 'symposium'
        : week.weekend_event === 'special_talk'
          ? 'special_talk'
          : 'regular';

  const themeText =
    week.public_talk_number && week.public_talk_theme
      ? `${week.public_talk_number}. ${week.public_talk_theme}`
      : (week.public_talk_theme ?? '');

  return {
    week,
    sunday,
    day,
    monthIndex: month - 1,
    year,
    kind,
    eventLabel: eventKey ? week.notes?.trim() || WEEKEND_EVENT_LABELS[eventKey] : null,
    themeText,
  };
}

export interface WeekendMonthGroup {
  monthName: string;
  year: number;
  rows: WeekendRowVM[];
}

/** Consecutive rows in the same calendar month share one vertical band cell. */
export function groupWeekendRowsByMonth(
  rows: WeekendRowVM[],
  labels: WeekendRangeLabels
): WeekendMonthGroup[] {
  const groups: WeekendMonthGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const monthName = labels.months[row.monthIndex];
    if (last && last.monthName === monthName && last.year === row.year) {
      last.rows.push(row);
    } else {
      groups.push({ monthName, year: row.year, rows: [row] });
    }
  }
  return groups;
}

/* ------------------------------------------------------------------------ */
/* Rotation: schedule length is one speaking Sunday per active elder + MS.  */
/* ------------------------------------------------------------------------ */

/** Active elders + ministerial servants; one talk slot each per cycle. */
export function speakingPoolCount(publishers: PublisherRecord[]): number {
  return publishers.filter((p) => !p.inactive && (p.elder || p.ministerial_servant)).length;
}

/**
 * Whether a Sunday consumes a rotation slot. Event weeks (assembly,
 * convention, memorial, no meeting) never do; a C.O. visit does only when a
 * local talk is scheduled. A Sunday with no saved row yet counts as a slot.
 */
export function consumesRotationSlot(week: MeetingWeek | undefined): boolean {
  if (!week) return true;
  if (weekendEventKey(week)) return false;
  if (week.week_type === 'co_visit') return !!week.public_talk_speaker_name?.trim();
  return true;
}

/**
 * Walks Sundays from `startSunday` until `slotCount` speaking Sundays fit;
 * event Sundays extend the end. Capped at slotCount + 104 Sundays so a data
 * mistake can never loop forever.
 */
export function computeScheduleEnd(
  startSunday: string,
  slotCount: number,
  weekBySunday: ReadonlyMap<string, MeetingWeek>
): string {
  let sunday = startSunday;
  let slots = 0;
  const maxSundays = slotCount + 104;
  for (let i = 0; i < maxSundays; i++) {
    if (consumesRotationSlot(weekBySunday.get(sunday))) slots++;
    if (slots >= slotCount) return sunday;
    sunday = addDaysIso(sunday, 7);
  }
  return sunday;
}

/** The cycle covering today (first with end_sunday >= today), else the latest, else null. */
export function activeWeekendSchedule(
  schedules: WeekendSchedule[],
  todayIso: string
): WeekendSchedule | null {
  if (schedules.length === 0) return null;
  const sorted = [...schedules].sort((a, b) => a.start_sunday.localeCompare(b.start_sunday));
  return sorted.find((s) => s.end_sunday >= todayIso) ?? sorted[sorted.length - 1];
}

/** The given day if it is a Sunday, otherwise the next Sunday after it. */
export function nextSundayOnOrAfter(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  const offset = (7 - date.getDay()) % 7;
  return addDaysIso(iso, offset);
}

/** Monday (`week_of`) of the week whose meeting Sunday is given. */
export function mondayOf(sundayIso: string): string {
  return addDaysIso(sundayIso, -6);
}

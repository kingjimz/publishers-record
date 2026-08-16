import { MeetingWeek } from '../services/meeting-schedule.service';
import { addDaysIso } from '../components/meeting-scheduler/meeting-defaults';
import { ScheduleLanguage, esc, escName } from './meeting-schedule-print';

/**
 * Weekend public talk schedule as one compact table covering a month range
 * (the elder/MS rotation cycle), modeled on the congregation's board sheet:
 * a vertical month band, then Petsa | Ispiker | Tserman | Tema | Parabasa iti
 * Parapo, with special rows for assemblies, conventions, C.O. visits,
 * special talks, and symposiums.
 *
 * The markup is XML-safe (numeric entities only) so it renders through the
 * SVG-foreignObject PNG pipeline in html-to-png.ts.
 */

interface RangeLabels {
  title: string;
  date: string;
  speaker: string;
  chairman: string;
  theme: string;
  reader: string;
  symposium: string;
  months: string[];
}

const RANGE_LABELS: Record<ScheduleLanguage, RangeLabels> = {
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

/** Full-width event labels, kept in English like the congregation's sheet. */
const EVENT_LABELS: Record<string, string> = {
  assembly: 'Circuit Assembly Week',
  convention: 'Regional Convention Week',
  memorial: 'Memorial',
  no_meeting: 'No Meeting',
};

/** Rough page budget; a month group never splits across pages. */
const MAX_ROWS_PER_PAGE = 24;

interface RangeRow {
  monthIndex: number;
  year: number;
  /** All cells after the month band, as `<td>` markup. */
  cells: string;
}

/** "Agosto – Disiembre 2026" (or "Nobiembre 2026 – Marso 2027" across years). */
export function weekendRangeLabel(
  startMonth: string,
  endMonth: string,
  language: ScheduleLanguage = 'ilo'
): string {
  const labels = RANGE_LABELS[language] ?? RANGE_LABELS.ilo;
  const [startYear, startM] = startMonth.split('-').map(Number);
  const [endYear, endM] = endMonth.split('-').map(Number);
  const start = labels.months[startM - 1];
  const end = labels.months[endM - 1];
  if (startYear !== endYear) return `${start} ${startYear} – ${end} ${endYear}`;
  if (startM === endM) return `${start} ${startYear}`;
  return `${start} – ${end} ${startYear}`;
}

/** Sunday the weekend meeting is held (falls back to week_of + 6). */
function sundayOf(week: MeetingWeek): string {
  return week.weekend_date ?? addDaysIso(week.week_of, 6);
}

function themeCell(week: MeetingWeek): string {
  if (week.public_talk_number && week.public_talk_theme) {
    return `${week.public_talk_number}. ${esc(week.public_talk_theme)}`;
  }
  return esc(week.public_talk_theme) || '&#160;';
}

function speakerCell(week: MeetingWeek, labels: RangeLabels): string {
  const congregation = week.speaker_congregation
    ? `<div class="sub">${esc(week.speaker_congregation)}</div>`
    : '';

  if (week.week_type === 'co_visit') {
    const name = escName(week.public_talk_speaker_name);
    return `${name ? `${name}${congregation}` : ''}<div class="note">(C.O's Visit)</div>`;
  }
  if (week.weekend_event === 'symposium') {
    const names = [week.public_talk_speaker_name, week.public_talk_speaker2_name]
      .map((n) => escName(n))
      .filter(Boolean)
      .join('<br/>');
    return `<div class="note">${esc(labels.symposium)}</div>${names || '&#160;'}`;
  }

  const name = escName(week.public_talk_speaker_name) || '&#160;';
  const specialNote =
    week.weekend_event === 'special_talk' ? '<div class="note">(Special Talk)</div>' : '';
  return `${name}${congregation}${specialNote}`;
}

function buildRow(week: MeetingWeek, labels: RangeLabels): RangeRow {
  const sunday = sundayOf(week);
  const [year, month, day] = sunday.split('-').map(Number);
  const dayCell = `<td class="day">${day}</td>`;

  const eventKey =
    week.weekend_event === 'assembly' || week.weekend_event === 'convention'
      ? week.weekend_event
      : week.week_type === 'memorial'
        ? 'memorial'
        : week.week_type === 'no_meeting'
          ? 'no_meeting'
          : null;

  if (eventKey) {
    const label = esc(week.notes?.trim() || EVENT_LABELS[eventKey]);
    return {
      monthIndex: month - 1,
      year,
      cells: `${dayCell}<td colspan="4" class="event">${label}</td>`,
    };
  }

  return {
    monthIndex: month - 1,
    year,
    cells: `${dayCell}
      <td>${speakerCell(week, labels)}</td>
      <td>${escName(week.weekend_chairman_name) || '&#160;'}</td>
      <td class="theme">${themeCell(week)}</td>
      <td>${escName(week.wt_reader_name) || '&#160;'}</td>`,
  };
}

function headerRow(labels: RangeLabels): string {
  return `<tr class="head">
    <th colspan="2">${esc(labels.date)}</th>
    <th>${esc(labels.speaker)}</th>
    <th>${esc(labels.chairman)}</th>
    <th>${esc(labels.theme)}</th>
    <th>${esc(labels.reader)}</th>
  </tr>`;
}

/** Rows of one month become a group sharing a vertical month-band cell. */
function monthGroupHtml(monthName: string, rows: RangeRow[]): string {
  return rows
    .map((row, i) => {
      const band =
        i === 0
          ? `<td class="month-band" rowspan="${rows.length}"><div class="vert">${esc(monthName)}</div></td>`
          : '';
      return `<tr>${band}${row.cells}</tr>`;
    })
    .join('');
}

export function buildWeekendRangeDocument(
  weeks: MeetingWeek[],
  congregationName: string,
  rangeLabel: string,
  language: ScheduleLanguage = 'ilo'
): string {
  const labels = RANGE_LABELS[language] ?? RANGE_LABELS.ilo;

  const rows = [...weeks]
    .sort((a, b) => sundayOf(a).localeCompare(sundayOf(b)))
    .map((week) => buildRow(week, labels));

  // Consecutive rows in the same calendar month share one band cell.
  const groups: { monthName: string; rows: RangeRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const monthName = labels.months[row.monthIndex];
    if (last && last.monthName === monthName && last.rows[0].year === row.year) {
      last.rows.push(row);
    } else {
      groups.push({ monthName, rows: [row] });
    }
  }

  // Pack whole month groups into pages; every page repeats the table header.
  const pages: string[] = [];
  let pageGroups: string[] = [];
  let pageRowCount = 0;
  const flush = () => {
    if (pageGroups.length === 0) return;
    pages.push(
      `<div class="sheet-page"><table class="range">${headerRow(labels)}${pageGroups.join('')}</table></div>`
    );
    pageGroups = [];
    pageRowCount = 0;
  };
  for (const group of groups) {
    if (pageRowCount > 0 && pageRowCount + group.rows.length > MAX_ROWS_PER_PAGE) flush();
    pageGroups.push(monthGroupHtml(group.monthName, group.rows));
    pageRowCount += group.rows.length;
  }
  flush();

  return `<!DOCTYPE html>
<html lang="${language === 'ilo' ? 'ilo' : 'en'}">
<head>
<meta charset="utf-8" />
<title>${esc(labels.title)} ${esc(rangeLabel)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: letter portrait; margin: 10mm; }
  body {
    font-family: 'Century Gothic', 'Trebuchet MS', Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.3;
    color: #000;
    margin: 0;
    padding: 2px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cong { text-align: center; font-weight: bold; font-size: 15pt; margin: 0; }
  .doc-title { text-align: center; font-weight: bold; font-size: 12pt; margin: 10px 0 0 0; text-decoration: underline; }
  .range-label { text-align: center; font-size: 11pt; margin: 2px 0 10px 0; }
  .sheet-page { page-break-after: always; }
  .sheet-page:last-child { page-break-after: auto; }
  table.range { width: 100%; border-collapse: collapse; border: 2px solid #000; }
  table.range th, table.range td { border: 1px solid #333; padding: 5px 7px; vertical-align: middle; }
  tr.head th {
    background: #2f5496;
    color: #fff;
    font-weight: bold;
    text-align: center;
    font-size: 10pt;
    padding: 7px 6px;
  }
  td { text-align: center; }
  td.month-band { background: #2f5496; color: #fff; width: 26px; padding: 2px; }
  .vert {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    margin: 0 auto;
    font-weight: bold;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  td.day { font-weight: bold; width: 34px; }
  td.theme { width: 34%; }
  td.event { font-weight: bold; text-align: center; }
  .note { color: #c00000; font-weight: bold; font-style: italic; }
  .sub { font-size: 8.5pt; color: #333; }
</style>
</head>
<body>
  <p class="cong">${esc(congregationName)}</p>
  <p class="doc-title">${esc(labels.title)}</p>
  <p class="range-label">(${esc(rangeLabel)})</p>
  ${pages.join('')}
</body>
</html>`;
}

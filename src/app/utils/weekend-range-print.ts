import { MeetingWeek } from '../services/meeting-schedule.service';
import { ScheduleLanguage, esc, escName } from './meeting-schedule-print';
import {
  WeekendRangeLabels,
  WeekendRowVM,
  buildWeekendRowVM,
  groupWeekendRowsByMonth,
  weekendRangeLabels,
} from './weekend-range-model';

/**
 * Weekend public talk schedule as one compact table covering a month range
 * (the elder/MS rotation cycle), modeled on the congregation's board sheet:
 * a vertical month band, then Petsa | Ispiker | Tserman | Tema | Parabasa iti
 * Parapo, with special rows for assemblies, conventions, C.O. visits,
 * special talks, and symposiums.
 *
 * All rendering decisions (labels, row classification, month grouping) live
 * in weekend-range-model.ts, shared with the on-screen editable sheet; this
 * file only turns that model into markup. The markup is XML-safe (numeric
 * entities only) so it renders through the SVG-foreignObject PNG pipeline in
 * html-to-png.ts.
 */

export { weekendRangeLabel } from './weekend-range-model';

/** Rough page budget; a month group never splits across pages. */
const MAX_ROWS_PER_PAGE = 24;

function themeCell(vm: WeekendRowVM): string {
  return esc(vm.themeText) || '&#160;';
}

function speakerCell(vm: WeekendRowVM, labels: WeekendRangeLabels): string {
  const week = vm.week;
  const congregation = week.speaker_congregation
    ? `<div class="sub">${esc(week.speaker_congregation)}</div>`
    : '';

  if (vm.kind === 'co_visit') {
    const name = escName(week.public_talk_speaker_name);
    return `${name ? `${name}${congregation}` : ''}<div class="note">(C.O's Visit)</div>`;
  }
  if (vm.kind === 'symposium') {
    const names = [week.public_talk_speaker_name, week.public_talk_speaker2_name]
      .map((n) => escName(n))
      .filter(Boolean)
      .join('<br/>');
    return `<div class="note">${esc(labels.symposium)}</div>${names || '&#160;'}`;
  }

  const name = escName(week.public_talk_speaker_name) || '&#160;';
  const specialNote = vm.kind === 'special_talk' ? '<div class="note">(Special Talk)</div>' : '';
  return `${name}${congregation}${specialNote}`;
}

/** All cells after the month band, as `<td>` markup. */
function rowCells(vm: WeekendRowVM, labels: WeekendRangeLabels): string {
  const dayCell = `<td class="day">${vm.day}</td>`;

  if (vm.kind === 'event') {
    return `${dayCell}<td colspan="4" class="event">${esc(vm.eventLabel)}</td>`;
  }

  return `${dayCell}
      <td>${speakerCell(vm, labels)}</td>
      <td>${escName(vm.week.weekend_chairman_name) || '&#160;'}</td>
      <td class="theme">${themeCell(vm)}</td>
      <td>${escName(vm.week.wt_reader_name) || '&#160;'}</td>`;
}

function headerRow(labels: WeekendRangeLabels): string {
  return `<tr class="head">
    <th colspan="2">${esc(labels.date)}</th>
    <th>${esc(labels.speaker)}</th>
    <th>${esc(labels.chairman)}</th>
    <th>${esc(labels.theme)}</th>
    <th>${esc(labels.reader)}</th>
  </tr>`;
}

/** Rows of one month become a group sharing a vertical month-band cell. */
function monthGroupHtml(monthName: string, rows: WeekendRowVM[], labels: WeekendRangeLabels): string {
  return rows
    .map((vm, i) => {
      const band =
        i === 0
          ? `<td class="month-band" rowspan="${rows.length}"><div class="vert">${esc(monthName)}</div></td>`
          : '';
      return `<tr>${band}${rowCells(vm, labels)}</tr>`;
    })
    .join('');
}

export function buildWeekendRangeDocument(
  weeks: MeetingWeek[],
  congregationName: string,
  rangeLabel: string,
  language: ScheduleLanguage = 'ilo'
): string {
  const labels = weekendRangeLabels(language);

  const rows = [...weeks]
    .map((week) => buildWeekendRowVM(week))
    .sort((a, b) => a.sunday.localeCompare(b.sunday));

  const groups = groupWeekendRowsByMonth(rows, labels);

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
    pageGroups.push(monthGroupHtml(group.monthName, group.rows, labels));
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

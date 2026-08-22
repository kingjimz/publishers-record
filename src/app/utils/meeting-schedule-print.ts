import {
  MeetingPart,
  MeetingWeek,
} from '../services/meeting-schedule.service';
import { STUDENT_PART_TYPES } from '../components/meeting-scheduler/meeting-defaults';
import {
  LABELS,
  SECTION_COLORS,
  ScheduleLabels,
  ScheduleLanguage,
  assignmentRolePair,
  buildMidweekSections,
  weekRange,
} from './meeting-schedule-model';
import { displayPublisherName } from './publisher-name';

export type { ScheduleLanguage } from './meeting-schedule-model';

function esc(s: string | null | undefined): string {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escaped publisher name in reading order ("Firstname Lastname"). */
function escName(s: string | null | undefined): string {
  return esc(displayPublisherName(s));
}

function displayDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type ScheduleDocumentMode = 'midweek' | 'weekend';

type PrintLabels = ScheduleLabels;

/** Two-line assignment cell: "Label: Name" rows. */
function labeledNames(pairs: [string, string | null | undefined][]): string {
  const rows = pairs
    .filter(([, name]) => !!name)
    .map(([label, name]) => `<span class="alabel">${esc(label)}</span> ${escName(name)}`)
    .join('<br/>');
  return rows || '&#160;';
}

function assignmentCell(
  part: MeetingPart,
  readerName: string | null,
  labels: PrintLabels
): string {
  const pair = assignmentRolePair(part.part_type, labels);
  if (!pair) {
    return part.assignee_name ? escName(part.assignee_name) : '&#160;';
  }
  const secondaryName = part.part_type === 'cbs' ? readerName : part.assistant_name;
  return labeledNames([
    [pair.primary, part.assignee_name],
    [pair.secondary, secondaryName],
  ]);
}

function partTitleCell(part: MeetingPart, num: number): string {
  const minutes = part.duration_minutes ? ` (${part.duration_minutes} min.)` : '';
  const setting = part.setting ? ` <strong>${esc(part.setting.toUpperCase())}.</strong>` : '';
  return `<strong>${num}. ${esc(part.title)}</strong>${minutes}${setting}`;
}

/**
 * Full-height placeholder for a week with no meeting, so the paired week on
 * the page keeps its normal position instead of riding to the top.
 */
function noMeetingBlock(heading: string, week: MeetingWeek, labels: PrintLabels, mode: 'mid' | 'wknd'): string {
  const reason = week.no_meeting_reason?.trim();
  const headline = reason ? esc(reason.toUpperCase()) : labels.noMeeting;
  const subtitle = reason ? `<p class="nm-sub">${labels.noMeeting}</p>` : '';
  const notes = week.notes ? `<p class="nm-notes">${esc(week.notes)}</p>` : '';
  return `<div class="week week-ph week-ph-${mode}">
    <div class="week-head">${heading}</div>
    <div class="nm-panel">
      <p class="nm-headline">${headline}</p>
      ${subtitle}
      ${notes}
    </div>
  </div>`;
}

function midweekBlock(week: MeetingWeek, labels: PrintLabels): string {
  const heading = `${esc(weekRange(week.week_of, labels))}${
    week.weekly_bible_reading ? ` | ${esc(week.weekly_bible_reading.toUpperCase())}` : ''
  }`;

  if (week.week_type === 'no_meeting') {
    return noMeetingBlock(heading, week, labels, 'mid');
  }

  const typeNote =
    week.week_type === 'co_visit'
      ? `<p class="special">${labels.coVisit}</p>`
      : week.week_type === 'memorial'
        ? `<p class="special">${labels.memorial}</p>`
        : '';

  const readerName =
    week.parts.find((p) => p.part_type === 'cbs_reader')?.assignee_name ?? null;

  const sectionRows = buildMidweekSections(week, labels)
    .map((sectionVm) => {
      // The middle song opens the Living as Christians section.
      const songRow =
        sectionVm.section === 'living' && week.song_middle
          ? `<tr><td class="left">♫ ${labels.song} ${week.song_middle}</td><td class="right">&#160;</td></tr>`
          : '';

      const rows = sectionVm.rows
        .map(
          ({ part, num }) => `<tr>
            <td class="left">${partTitleCell(part, num)}</td>
            <td class="right">${assignmentCell(part, readerName, labels)}</td>
          </tr>`
        )
        .join('');

      return `<tr><td colspan="2" class="section" style="background:${sectionVm.color}">${sectionVm.heading}</td></tr>${songRow}${rows}`;
    })
    .join('');

  const cleanerRow = week.cleaning_group
    ? `<tr><td class="left">&#160;</td><td class="right split"><span class="rlabel">${labels.cleaner}</span><span class="rvalue"><strong>${esc(week.cleaning_group.toUpperCase())}</strong></span></td></tr>`
    : '';

  return `<div class="week">
    <div class="week-head">${heading}</div>
    ${typeNote}
    <table class="program">
      ${cleanerRow}
      <tr><td class="left">&#160;</td><td class="right split"><span class="rlabel">${labels.chairman}</span><span class="rvalue">${escName(week.chairman_name) || '&#160;'}</span></td></tr>
      <tr>
        <td class="left">${week.song_opening ? `♫ ${labels.song} ${week.song_opening}` : '&#160;'}</td>
        <td class="right split"><span class="rlabel">${labels.prayer}</span><span class="rvalue">${escName(week.opening_prayer_name) || '&#160;'}</span></td>
      </tr>
      <tr><td class="left">● ${labels.openingComments}</td><td class="right">${escName(week.chairman_name) || '&#160;'}</td></tr>
      ${sectionRows}
      <tr><td class="left">● ${labels.closingComments}</td><td class="right">${escName(week.chairman_name) || '&#160;'}</td></tr>
      <tr>
        <td class="left">${week.song_closing ? `♫ ${labels.song} ${week.song_closing} ${labels.andPrayer}` : '&#160;'}</td>
        <td class="right split"><span class="rlabel">${labels.prayer}</span><span class="rvalue">${escName(week.closing_prayer_name) || '&#160;'}</span></td>
      </tr>
    </table>
    ${week.notes ? `<p class="notes">${esc(week.notes)}</p>` : ''}
  </div>`;
}

function weekendBlock(week: MeetingWeek, labels: PrintLabels): string {
  const heading = esc(weekRange(week.week_of, labels));

  if (week.week_type === 'no_meeting') {
    return noMeetingBlock(heading, week, labels, 'wknd');
  }

  const typeNote =
    week.week_type === 'co_visit' ? `<p class="special">${labels.coVisit}</p>` : '';

  const speaker = [escName(week.public_talk_speaker_name), esc(week.speaker_congregation)]
    .filter(Boolean)
    .join(', ');

  return `<div class="week">
    <div class="week-head">${heading}</div>
    ${typeNote}
    <table class="program">
      <tr><td class="left">&#160;</td><td class="right split"><span class="rlabel">${labels.chairman}</span><span class="rvalue">${escName(week.weekend_chairman_name) || '&#160;'}</span></td></tr>
      <tr><td colspan="2" class="section" style="background:${SECTION_COLORS.treasures}">${labels.publicTalk}${week.weekend_song_opening ? ` &#160;•&#160; ♫ ${labels.song} ${week.weekend_song_opening}` : ''}</td></tr>
      <tr><td class="left">${week.public_talk_theme ? `<strong>${esc(week.public_talk_theme)}</strong>` : '&#160;'}</td><td class="right">${speaker || '&#160;'}</td></tr>
      <tr><td colspan="2" class="section" style="background:${SECTION_COLORS.living}">${labels.watchtowerStudy}${week.weekend_song_middle ? ` &#160;•&#160; ♫ ${labels.song} ${week.weekend_song_middle}` : ''}</td></tr>
      <tr><td class="left">${week.wt_article_title ? `<strong>${esc(week.wt_article_title)}</strong>` : '&#160;'}</td><td class="right">${labeledNames([
        [labels.conductor, week.wt_conductor_name],
        [labels.reader, week.wt_reader_name],
      ])}</td></tr>
      <tr>
        <td class="left">${week.weekend_song_closing ? `♫ ${labels.song} ${week.weekend_song_closing} ${labels.andPrayer}` : '&#160;'}</td>
        <td class="right">${labeledNames([
          [labels.prayer, week.weekend_opening_prayer_name],
          [labels.prayer, week.weekend_closing_prayer_name],
        ])}</td>
      </tr>
    </table>
    ${week.notes ? `<p class="notes">${esc(week.notes)}</p>` : ''}
  </div>`;
}

/**
 * Board schedule matching the congregation's manual sheet: centered header,
 * dark week band with date range and Bible reading, colored section bands,
 * continuous part numbering, and per-role assignment labels.
 */
export function buildMonthScheduleDocument(
  weeks: MeetingWeek[],
  congregationName: string,
  monthLabel: string,
  mode: ScheduleDocumentMode,
  language: ScheduleLanguage = 'en'
): string {
  const labels = LABELS[language] ?? LABELS.en;
  const title = mode === 'midweek' ? labels.midweekTitle : labels.weekendTitle;

  const weekBlocks = [...weeks]
    .sort((a, b) => a.week_of.localeCompare(b.week_of))
    .map((week) => (mode === 'midweek' ? midweekBlock(week, labels) : weekendBlock(week, labels)));

  // Two weeks per printed page, like the congregation's manual sheet.
  const pages: string[] = [];
  for (let i = 0; i < weekBlocks.length; i += 2) {
    pages.push(`<div class="sheet-page">${weekBlocks.slice(i, i + 2).join('')}</div>`);
  }
  const blocks = pages.join('');

  return `<!DOCTYPE html>
<html lang="${language === 'ilo' ? 'ilo' : 'en'}">
<head>
<meta charset="utf-8" />
<title>${esc(title)} ${esc(monthLabel)}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: letter portrait; margin: 8mm; }
  body {
    font-family: 'Century Gothic', 'Trebuchet MS', Arial, sans-serif;
    font-size: 10.5pt;
    line-height: 1.25;
    color: #000;
    margin: 0;
    padding: 2px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cong { text-align: center; font-weight: bold; font-size: 10pt; margin: 0; text-transform: uppercase; letter-spacing: 0.02em; }
  .doc-title { text-align: center; font-weight: bold; font-size: 13pt; margin: 1px 0 8px 0; }
  /* The PNG exporter renders each page inside a fixed-height flex column, so
     the sheet fills the page and flexible blocks can absorb leftover space. */
  .sheet-page { page-break-after: always; flex: 1 0 auto; display: flex; flex-direction: column; }
  .sheet-page:last-child { page-break-after: auto; }
  .week { page-break-inside: avoid; }
  .week + .week { margin-top: 30px; }
  .week-head { background: #595959; color: #fff; text-align: center; font-weight: bold; font-size: 10.5pt; padding: 4px 8px; }
  .program { width: 100%; border-collapse: collapse; }
  .program td { border: 1px solid #bfbfbf; padding: 2px 8px; vertical-align: top; }
  .section { color: #fff; font-weight: bold; text-align: center; font-size: 10.5pt; letter-spacing: 0.02em; padding: 2px 8px; }
  .left { width: 58%; }
  .right { width: 42%; font-size: 10.5pt; }
  .right.split { padding: 0; }
  .right.split .rlabel { display: inline-block; width: 45%; text-align: right; font-weight: bold; font-size: 8pt; padding: 3px 6px; vertical-align: middle; }
  .right.split .rvalue { display: inline-block; width: 54%; border-left: 1px solid #bfbfbf; padding: 2px 8px; vertical-align: middle; }
  .alabel { font-weight: bold; }
  .special { border: 1px solid #bfbfbf; border-top: none; padding: 5px 8px; margin: 0; font-style: italic; }
  .notes { border: 1px solid #bfbfbf; border-top: none; padding: 4px 8px; margin: 0; font-size: 8.5pt; color: #333; }
  .week-ph { display: flex; flex-direction: column; }
  /* Grows to exactly the space a normal week would use, never past the page,
     so the paired week keeps its position and no page needs shrinking. */
  .week-ph-mid { flex: 1 0 auto; }
  .week-ph-wknd { min-height: 230px; }
  .nm-panel { flex: 1; border: 1px solid #bfbfbf; border-top: none; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8px; padding: 24px 32px; }
  .nm-headline { margin: 0; font-weight: bold; font-size: 15pt; text-transform: uppercase; letter-spacing: 0.04em; color: #c00000; }
  .nm-sub { margin: 0; font-style: italic; font-size: 11pt; color: #333; }
  .nm-notes { margin: 6px 0 0 0; font-size: 9pt; color: #555; }
</style>
</head>
<body>
  <p class="cong">${esc(congregationName)}</p>
  <p class="doc-title">${esc(title)}</p>
  ${blocks}
</body>
</html>`;
}

/**
 * Wraps pre-rendered letter-size page images (from the PNG exporter) in a
 * printable document, so the print output is pixel-identical to the PNG
 * download. The images already carry their own page margins, so the page
 * prints edge to edge.
 */
export function buildImagePrintDocument(pageDataUrls: string[], title: string): string {
  const pages = pageDataUrls
    .map((src) => `<img class="page" src="${src}" alt="" />`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  @page { size: letter portrait; margin: 0; }
  html, body { margin: 0; padding: 0; }
  .page { display: block; width: 100%; height: auto; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
</style>
</head>
<body>${pages}</body>
</html>`;
}

export interface AssignmentSlip {
  studentName: string;
  assistantName: string | null;
  date: string | null;
  partTitle: string;
  room: string;
}

/** Student assignments (Bible reading + ministry parts) with an assignee, for slip printing. */
export function collectAssignmentSlips(weeks: MeetingWeek[]): AssignmentSlip[] {
  const slips: AssignmentSlip[] = [];
  for (const week of [...weeks].sort((a, b) => a.week_of.localeCompare(b.week_of))) {
    if (week.week_type === 'no_meeting') continue;
    for (const part of week.parts) {
      if (!STUDENT_PART_TYPES.includes(part.part_type)) continue;
      if (!part.assignee_name) continue;
      slips.push({
        studentName: part.assignee_name,
        assistantName: part.assistant_name,
        date: week.midweek_date ?? week.week_of,
        partTitle: part.title,
        room: part.room,
      });
    }
  }
  return slips;
}

function slipBox(slip: AssignmentSlip): string {
  const roomBox = (key: string, label: string) =>
    `<span class="room">${slip.room === key ? '☑' : '☐'} ${label}</span>`;

  return `<div class="slip">
    <p class="slip-title">OUR CHRISTIAN LIFE AND MINISTRY MEETING ASSIGNMENT</p>
    <p class="field"><span class="label">Name:</span> <span class="value">${escName(slip.studentName)}</span></p>
    <p class="field"><span class="label">Assistant:</span> <span class="value">${escName(slip.assistantName) || ''}</span></p>
    <p class="field"><span class="label">Date:</span> <span class="value">${displayDate(slip.date)}</span></p>
    <p class="field"><span class="label">Assignment:</span> <span class="value">${esc(slip.partTitle)}</span></p>
    <p class="field"><span class="label">To be given in:</span></p>
    <p class="rooms">${roomBox('main', 'Main hall')} ${roomBox('aux1', 'Auxiliary classroom 1')} ${roomBox('aux2', 'Auxiliary classroom 2')}</p>
    <p class="note">Note to student: The source material and study point for your assignment are shown in the Life and Ministry Meeting Workbook.</p>
  </div>`;
}

/**
 * Student assignment slips (S-89-inspired), four per letter page with cut borders.
 */
export function buildAssignmentSlipsDocument(
  slips: AssignmentSlip[],
  congregationName: string
): string {
  const boxes = slips.map(slipBox).join('');
  const firstDate = slips.find((s) => s.date)?.date ?? null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Assignment Slips ${esc(congregationName)}${firstDate ? ` ${shortDate(firstDate)}` : ''}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: letter portrait; margin: 10mm; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10pt;
    color: #000;
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { display: flex; flex-wrap: wrap; }
  .slip {
    width: 50%;
    padding: 14px 16px;
    border: 1px dashed #888;
    min-height: 3.4in;
    page-break-inside: avoid;
  }
  .slip-title { text-align: center; font-weight: bold; font-size: 9.5pt; margin: 0 0 12px 0; }
  .field { margin: 0 0 8px 0; }
  .label { font-weight: bold; }
  .value { border-bottom: 1px solid #000; padding: 0 4px; min-width: 120px; display: inline-block; }
  .rooms { margin: 0 0 10px 0; display: flex; flex-direction: column; gap: 3px; }
  .room { display: block; }
  .note { font-size: 8pt; color: #333; margin: 8px 0 0 0; }
</style>
</head>
<body>
  <div class="sheet">${boxes}</div>
</body>
</html>`;
}

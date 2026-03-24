import { PublisherRecord } from '../services/supabase.service';

/** Ballot box symbols for print-faithful checkmarks */
function bx(on: boolean): string {
  return on ? '\u2611' : '\u2610';
}

function esc(s: string | null | undefined): string {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayDate(s: string | null | undefined): string {
  if (s == null || s === '') return '';
  return esc(s);
}

/**
 * Full HTML document matching the official "Congregation's Publisher Record" layout
 * (header, personal fields with shaded areas, role/gender checkboxes, monthly grid Sept–Aug, total row).
 */
export function buildPublisherRecordPrintDocument(record: PublisherRecord): string {
  const y = record.service_year_start;
  const yearLabel = `${y}\u2013${y + 1}`;
  const months = record.months ?? [];

  const male = record.gender === 'male';
  const female = record.gender === 'female';
  const genderOther = record.gender === 'other';

  const monthRows = months
    .map((m) => {
      const bs =
        m.bibleStudies != null && m.bibleStudies !== 0 ? String(m.bibleStudies) : '';
      const hrs = m.hours != null && m.hours !== 0 ? String(m.hours) : '';
      const rem = esc(m.remarks?.trim() || '');
      return `<tr>
        <td class="month-cell">${esc(m.month)}</td>
        <td class="center">${bx(m.sharedInMinistry)}</td>
        <td class="center field-lite">${bs}</td>
        <td class="center">${bx(m.auxiliaryPioneer)}</td>
        <td class="center field-lite">${hrs}</td>
        <td class="remarks">${rem}</td>
      </tr>`;
    })
    .join('');

  const totalHours = months.reduce((sum, m) => sum + (m.hours ?? 0), 0);

  const css = `
    * { box-sizing: border-box; }
    @page { size: letter portrait; margin: 12mm; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10.5pt;
      color: #000;
      margin: 0;
      padding: 8px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .doc-title {
      text-align: center;
      font-weight: bold;
      font-size: 12pt;
      letter-spacing: 0.02em;
      margin: 0 0 14px 0;
      text-transform: uppercase;
    }
    .top-grid {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
    }
    .top-grid td, .top-grid th {
      border: 1px solid #000;
      padding: 4px 6px;
      vertical-align: middle;
    }
    .label { font-weight: bold; white-space: nowrap; }
    .field {
      background: #d6e8f5;
      border: 1px solid #000;
      min-height: 22px;
      padding: 3px 6px;
    }
    .field-lite {
      background: #e8f2fa;
    }
    .checks { font-size: 9.5pt; line-height: 1.5; }
    .checks span { margin-right: 14px; white-space: nowrap; }
    table.data {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    table.data th, table.data td {
      border: 1px solid #000;
      padding: 3px 4px;
      vertical-align: middle;
    }
    table.data th {
      font-weight: bold;
      text-align: center;
      font-size: 9pt;
      background: #fff;
    }
    .sy-head { width: 14%; }
    .min-head { width: 12%; }
    .bs-head { width: 10%; }
    .aux-head { width: 12%; }
    .hr-head { width: 10%; }
    .rm-head { width: 42%; }
    .month-cell { font-weight: bold; font-size: 9.5pt; }
    .center { text-align: center; }
    .remarks { font-size: 9pt; word-wrap: break-word; }
    .year-box {
      background: #d6e8f5;
      border: 1px solid #000;
      text-align: center;
      font-weight: bold;
      padding: 4px;
      margin-top: 4px;
    }
    .total-row td { font-weight: bold; }
    .total-label { text-align: right; padding-right: 8px; }
    @media print {
      body { padding: 0; }
    }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Publisher Record — ${esc(record.publisher_name)}</title>
  <style>${css}</style>
</head>
<body>
  <h1 class="doc-title">Congregation's Publisher Record</h1>

  <table class="top-grid" role="presentation">
    <tr>
      <td class="label" style="width:110px">Name</td>
      <td class="field" colspan="5">${esc(record.publisher_name)}</td>
    </tr>
    <tr>
      <td class="label">Date of birth</td>
      <td class="field" style="width:22%">${displayDate(record.date_of_birth)}</td>
      <td class="label" style="width:130px">Date of baptism</td>
      <td class="field" style="width:22%">${displayDate(record.date_of_baptism)}</td>
      <td class="checks" colspan="2" style="border:1px solid #000;padding:6px;">
        <span>${bx(male)} Male</span>
        <span>${bx(female)} Female</span>
        <span>${bx(genderOther)} Other</span>
        <br />
        <span>${bx(record.other_sheep)} Other sheep</span>
        <span>${bx(record.anointed)} Anointed</span>
      </td>
    </tr>
    <tr>
      <td class="checks" colspan="6" style="padding:6px;">
        <span>${bx(record.elder)} Elder</span>
        <span>${bx(record.ministerial_servant)} Ministerial servant</span>
        <span>${bx(record.regular_pioneer)} Regular pioneer</span>
        <span>${bx(record.special_pioneer)} Special pioneer</span>
        <span>${bx(record.field_missionary)} Field missionary</span>
      </td>
    </tr>
  </table>

  <table class="data" aria-label="Monthly publisher record">
    <thead>
      <tr>
        <th class="sy-head">Service Year</th>
        <th class="min-head">Shared in<br />Ministry</th>
        <th class="bs-head">Bible<br />Studies</th>
        <th class="aux-head">Auxiliary<br />Pioneer</th>
        <th class="hr-head">Hours<br /><span style="font-weight:normal;font-size:8pt">(If pioneer or field missionary)</span></th>
        <th class="rm-head">Remarks</th>
      </tr>
      <tr>
        <th style="padding:4px;">
          <div class="year-box">${esc(yearLabel)}</div>
        </th>
        <th colspan="5"></th>
      </tr>
    </thead>
    <tbody>
      ${monthRows}
      <tr class="total-row">
        <td colspan="3"></td>
        <td class="total-label">Total</td>
        <td class="center field-lite">${totalHours > 0 ? String(totalHours) : ''}</td>
        <td></td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;
}

export function sanitizeFilenamePart(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'publisher';
}

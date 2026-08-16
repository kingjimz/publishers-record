import { MeetingWeek } from '../services/meeting-schedule.service';
import { createEmptyWeek } from '../components/meeting-scheduler/meeting-defaults';
import { buildWeekendRangeDocument, weekendRangeLabel } from './weekend-range-print';

function weekendWeek(weekOf: string): MeetingWeek {
  const week = createEmptyWeek(weekOf);
  week.parts = [];
  week.weekend_chairman_name = 'Galase, Leniel';
  week.public_talk_speaker_name = 'Peñera, Enrique';
  week.public_talk_number = 175;
  week.public_talk_theme = 'Ania Dagiti Pammaneknek a ti Biblia ket Naipaltiing a Sao ti Dios?';
  week.wt_reader_name = 'Galase, Wesley';
  return week;
}

describe('weekendRangeLabel', () => {
  it('formats a same-year range in the schedule language', () => {
    expect(weekendRangeLabel('2026-08', '2026-12', 'ilo')).toBe('Agosto – Disiembre 2026');
  });

  it('formats cross-year ranges and single months', () => {
    expect(weekendRangeLabel('2026-11', '2027-03', 'ilo')).toBe('Nobiembre 2026 – Marso 2027');
    expect(weekendRangeLabel('2026-08', '2026-08', 'en')).toBe('August 2026');
  });
});

describe('buildWeekendRangeDocument', () => {
  it('renders the header, month band, and a regular talk row with the outline number', () => {
    const html = buildWeekendRangeDocument(
      [weekendWeek('2026-08-24')],
      'Bolaoen Congregation',
      'Agosto – Disiembre 2026',
      'ilo'
    );
    expect(html).toContain('Bolaoen Congregation');
    expect(html).toContain('Eskedyul Para iti Palawag Publiko');
    expect(html).toContain('(Agosto – Disiembre 2026)');
    expect(html).toContain('Petsa');
    expect(html).toContain('Parabasa iti Parapo (Pagwanawanan)');
    // week_of 2026-08-24 -> Sunday Aug 30
    expect(html).toContain('class="vert">Agosto');
    expect(html).toContain('<td class="day">30</td>');
    expect(html).toContain('175. Ania Dagiti Pammaneknek');
    expect(html).toContain('Enrique Peñera');
    expect(html).toContain('Leniel Galase');
    expect(html).toContain('Wesley Galase');
  });

  it('spans one month band across all of that month\'s rows', () => {
    const weeks = [weekendWeek('2026-10-05'), weekendWeek('2026-10-12'), weekendWeek('2026-10-19')];
    const html = buildWeekendRangeDocument(weeks, 'Test', 'Oktubre 2026', 'ilo');
    expect(html).toContain('rowspan="3"');
    expect(html.match(/class="month-band"/g)?.length).toBe(1);
  });

  it('renders assembly and convention weeks as full-width event rows', () => {
    const assembly = weekendWeek('2026-09-07');
    assembly.weekend_event = 'assembly';
    const convention = weekendWeek('2026-09-14');
    convention.weekend_event = 'convention';
    const html = buildWeekendRangeDocument([assembly, convention], 'Test', 'Setiembre 2026', 'ilo');
    expect(html).toContain('Circuit Assembly Week');
    expect(html).toContain('Regional Convention Week');
    expect(html.match(/colspan="4"/g)?.length).toBe(2);
    // Event weeks never print their assignments.
    expect(html).not.toContain('Enrique Peñera');
  });

  it('marks C.O. visit weeks and prints the free-text theme without a number', () => {
    const week = weekendWeek('2026-11-16');
    week.week_type = 'co_visit';
    week.public_talk_speaker_name = null;
    week.public_talk_number = null;
    week.public_talk_theme = 'DRAMA: Ti Naimbag a Damag Sigun ken Jesus (Paset 1)';
    const html = buildWeekendRangeDocument([week], 'Test', 'Nobiembre 2026', 'ilo');
    expect(html).toContain("(C.O's Visit)");
    expect(html).toContain('DRAMA: Ti Naimbag a Damag Sigun ken Jesus (Paset 1)');
    expect(html).not.toContain('175.');
  });

  it('stacks both symposium speakers under the symposium note', () => {
    const week = weekendWeek('2026-12-14');
    week.weekend_event = 'symposium';
    week.public_talk_speaker2_name = 'Abellera, Eleazar';
    const html = buildWeekendRangeDocument([week], 'Test', 'Disiembre 2026', 'ilo');
    expect(html).toContain('Simposium:');
    expect(html).toContain('Enrique Peñera<br/>Eleazar Abellera');
  });

  it('adds a special talk note under the speaker', () => {
    const week = weekendWeek('2026-09-21');
    week.weekend_event = 'special_talk';
    const html = buildWeekendRangeDocument([week], 'Test', 'Setiembre 2026', 'ilo');
    expect(html).toContain('(Special Talk)');
  });

  it('splits long ranges into pages, repeating the table header', () => {
    const weeks: MeetingWeek[] = [];
    let monday = '2026-01-05';
    for (let i = 0; i < 40; i++) {
      weeks.push(weekendWeek(monday));
      const d = new Date(`${monday}T00:00:00`);
      d.setDate(d.getDate() + 7);
      monday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const html = buildWeekendRangeDocument(weeks, 'Test', 'Enero – Oktubre 2026', 'ilo');
    const pageCount = html.match(/class="sheet-page"/g)?.length ?? 0;
    expect(pageCount).toBeGreaterThan(1);
    expect(html.match(/tr class="head"/g)?.length).toBe(pageCount);
  });

  it('escapes user content', () => {
    const week = weekendWeek('2026-08-24');
    week.public_talk_theme = '<script>alert(1)</script>';
    week.public_talk_number = null;
    const html = buildWeekendRangeDocument([week], 'Test', 'Agosto 2026', 'ilo');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

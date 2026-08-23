import { TestBed } from '@angular/core/testing';

import { MeetingWeek } from '../../services/meeting-schedule.service';
import { createEmptyWeek } from './meeting-defaults';
import { WeekendRangeSheetComponent } from './weekend-range-sheet.component';

function week(weekOf: string, patch: Partial<MeetingWeek> = {}): MeetingWeek {
  const w = createEmptyWeek(weekOf);
  w.parts = [];
  return Object.assign(w, patch);
}

describe('WeekendRangeSheetComponent', () => {
  function render(
    weeks: MeetingWeek[],
    inputs: Partial<{ readonly: boolean; language: string; rangeLabel: string }> = {}
  ) {
    const fixture = TestBed.createComponent(WeekendRangeSheetComponent);
    fixture.componentRef.setInput('weeks', weeks);
    fixture.componentRef.setInput('congregationName', 'Bolaoen Congregation');
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('renders the printed header and Iloko column labels by default', () => {
    const fixture = render([week('2026-08-24')], { rangeLabel: 'Agosto – Disiembre 2026' });
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.ws-cong')?.textContent).toContain('Bolaoen Congregation');
    expect(el.querySelector('.ws-title')?.textContent).toContain(
      'Eskedyul Para iti Palawag Publiko'
    );
    const heads = [...el.querySelectorAll('tr.ws-head th')].map((h) => h.textContent?.trim());
    expect(heads).toEqual([
      'Petsa',
      'Ispiker',
      'Tserman',
      'Tema',
      'Parabasa iti Parapo (Pagwanawanan)',
    ]);
  });

  it('uses English labels when the language input is en', () => {
    const fixture = render([week('2026-08-24')], { language: 'en' });
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.ws-title')?.textContent).toContain('Public Talk Schedule');
    const heads = [...el.querySelectorAll('tr.ws-head th')].map((h) => h.textContent?.trim());
    expect(heads).toEqual(['Date', 'Speaker', 'Chairman', 'Theme', 'Paragraph Reader (Watchtower)']);
  });

  it('renders the day number and one month band spanning the whole month group', () => {
    const fixture = render([
      week('2026-10-05'),
      week('2026-10-12'),
      week('2026-10-19'),
    ]);
    const el: HTMLElement = fixture.nativeElement;

    const bands = [...el.querySelectorAll<HTMLTableCellElement>('td.ws-band')];
    expect(bands.length).toBe(1);
    expect(bands[0].rowSpan).toBe(3);
    expect(bands[0].textContent).toContain('Oktubre');
    expect(bands[0].style.background).toBe('rgb(47, 84, 150)');

    // week_of 2026-10-05 -> Sunday Oct 11
    const days = [...el.querySelectorAll('.ws-day-num')].map((d) => d.textContent?.trim());
    expect(days).toEqual(['11', '18', '25']);
  });

  it('renders event weeks as one full-width cell with the default label as placeholder', async () => {
    const fixture = render([week('2026-08-24', { weekend_event: 'assembly' })]);
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;

    const eventCell = el.querySelector<HTMLTableCellElement>('td.ws-event');
    expect(eventCell?.colSpan).toBe(4);
    const input = eventCell?.querySelector<HTMLInputElement>('input.ws-event-input');
    expect(input?.placeholder).toBe('Circuit Assembly Week');
    expect(el.querySelectorAll('app-assignee-picker').length).toBe(0);
  });

  it('shows custom notes on event rows and as plain text when read-only', async () => {
    const fixture = render(
      [week('2026-08-24', { weekend_event: 'convention', notes: 'Kombension ti Rehion' })],
      { readonly: true }
    );
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('td.ws-event')?.textContent).toContain('Kombension ti Rehion');
    expect(el.querySelector('td.ws-event input')).toBeNull();
  });

  it('stacks two speaker pickers under the Simposium note on symposium weeks', () => {
    const fixture = render([week('2026-08-24', { weekend_event: 'symposium' })]);
    const el: HTMLElement = fixture.nativeElement;

    const speakerCell = el.querySelector('td.ws-day + td:not(.ws-event)')
      ? el.querySelectorAll('tr')[1].cells[2]
      : null;
    expect(speakerCell?.querySelector('.ws-note')?.textContent).toContain('Simposium:');
    expect(speakerCell?.querySelectorAll('app-assignee-picker').length).toBe(2);
    // No congregation line on symposium rows.
    expect(speakerCell?.querySelector('.ws-cong-input')).toBeNull();
  });

  it('renders the C.O. visit and special talk notes', () => {
    const co = render([week('2026-08-24', { week_type: 'co_visit' })]);
    expect(co.nativeElement.querySelector('.ws-note')?.textContent).toContain("(C.O's Visit)");

    const special = render([week('2026-08-24', { weekend_event: 'special_talk' })]);
    expect(special.nativeElement.querySelector('.ws-note')?.textContent).toContain(
      '(Special Talk)'
    );
  });

  it('emits rangeLabelChange when the header label is typed into', async () => {
    const fixture = render([week('2026-08-24')], { rangeLabel: 'Agosto 2026' });
    await fixture.whenStable();
    const emitted: string[] = [];
    fixture.componentInstance.rangeLabelChange.subscribe((v: string) => emitted.push(v));

    const el: HTMLElement = fixture.nativeElement;
    const input = el.querySelector<HTMLInputElement>('.ws-range-input');
    expect(input?.value).toBe('Agosto 2026');
    input!.value = 'Agosto – Disiembre';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(emitted).toEqual(['Agosto – Disiembre']);
  });

  it('renders read-only: label as text, no pickers, no kind selects, names in reading order', () => {
    const fixture = render(
      [
        week('2026-08-24', {
          public_talk_speaker_name: 'Peñera, Enrique',
          weekend_chairman_name: 'Galase, Leniel',
          wt_reader_name: 'Galase, Wesley',
          public_talk_number: 175,
          public_talk_theme: 'Tema',
        }),
      ],
      { readonly: true, rangeLabel: 'Agosto – Disiembre 2026' }
    );
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.ws-range-input')).toBeNull();
    expect(el.querySelector('.ws-range-label')?.textContent).toContain('(Agosto – Disiembre 2026)');
    expect(el.querySelectorAll('app-assignee-picker button').length).toBe(0);
    expect(el.querySelectorAll('app-talk-outline-picker button').length).toBe(0);
    expect(el.querySelector('.ws-kind')).toBeNull();
    expect(el.textContent).toContain('Enrique Peñera');
    expect(el.textContent).toContain('Leniel Galase');
    expect(el.textContent).toContain('Wesley Galase');
    expect(el.textContent).toContain('175. Tema');
  });

  it('remaps week_type and weekend_event when the row kind changes', () => {
    const w = week('2026-08-24', {
      weekend_event: 'symposium',
      public_talk_speaker2_name: 'Doe, John',
    });
    const fixture = render([w]);
    const emitted: MeetingWeek[] = [];
    fixture.componentInstance.rowKindChange.subscribe((changed: MeetingWeek) =>
      emitted.push(changed)
    );

    const component = fixture.componentInstance as unknown as {
      onRowKind(week: MeetingWeek, kind: string): void;
    };
    component.onRowKind(w, 'assembly');
    expect(w.week_type).toBe('regular');
    expect(w.weekend_event).toBe('assembly');
    expect(w.public_talk_speaker2_name).toBeNull(); // cleared on leaving symposium

    component.onRowKind(w, 'co_visit');
    expect(w.week_type).toBe('co_visit');
    expect(w.weekend_event).toBeNull();
    expect(emitted.length).toBe(2);
  });
});

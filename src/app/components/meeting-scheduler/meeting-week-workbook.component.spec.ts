import { TestBed } from '@angular/core/testing';

import { createEmptyWeek } from './meeting-defaults';
import { MeetingWeekWorkbookComponent } from './meeting-week-workbook.component';

describe('MeetingWeekWorkbookComponent', () => {
  function render(week = createEmptyWeek('2026-08-10')) {
    const fixture = TestBed.createComponent(MeetingWeekWorkbookComponent);
    fixture.componentRef.setInput('week', week);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the sheet like the printed template: head band, sections, numbering', () => {
    const week = createEmptyWeek('2026-08-10');
    week.chairman_name = 'Chairman, John';
    week.cleaning_group = 'Group 3';
    const fixture = render(week);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.wb-head')?.textContent).toContain('AUGUST 10 – 16');

    const bands = [...el.querySelectorAll('.wb-section')].map((b) => b.textContent?.trim());
    expect(bands).toEqual([
      "TREASURES FROM GOD'S WORD",
      'APPLY YOURSELF TO THE FIELD MINISTRY',
      'LIVING AS CHRISTIANS',
    ]);
    expect(
      [...el.querySelectorAll<HTMLElement>('.wb-section')].map((b) => b.style.background)
    ).toEqual(['rgb(87, 100, 110)', 'rgb(191, 143, 0)', 'rgb(149, 55, 52)']);

    // Continuous numbering; the CBS reader merges into the CBS row.
    const nums = [...el.querySelectorAll('.wb-num')].map((n) => n.textContent?.trim());
    expect(nums).toEqual(['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.']);

    // Chairman mirrors into the comments rows in reading order.
    const mirrors = [...el.querySelectorAll('.wb-mirror')].map((m) => m.textContent?.trim());
    expect(mirrors).toEqual(['John Chairman', 'John Chairman']);
  });

  it('renders role-pair labels for student and CBS rows', () => {
    const fixture = render();
    const labels = [...fixture.nativeElement.querySelectorAll('.wb-alabel')].map((l) =>
      l.textContent?.trim()
    );
    // Bible reading + 3 demos + CBS, each with a primary and secondary role.
    expect(labels).toEqual([
      'Student:', 'Assistant:',
      'Preacher:', 'House Holder:',
      'Preacher:', 'House Holder:',
      'Preacher:', 'House Holder:',
      'Conductor:', 'Reader:',
    ]);
  });

  it('shows the red no-meeting panel with reason chips instead of the program', async () => {
    const week = createEmptyWeek('2026-08-10', 'no_meeting');
    week.no_meeting_reason = 'Regional Convention Week';
    const fixture = render(week);
    // ngModel writes into the input in a microtask after change detection.
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.wb-program')).toBeNull();
    expect(el.querySelector<HTMLInputElement>('.wb-nm-headline')?.value).toBe(
      'Regional Convention Week'
    );
    expect(el.querySelectorAll('.wb-nm-chip').length).toBe(2);
    expect(el.querySelector('.wb-nm-chip-active')?.textContent).toContain(
      'Regional Convention Week'
    );
  });

  it('renders the CO visit note and no CBS pair on co_visit weeks', () => {
    const fixture = render(createEmptyWeek('2026-08-10', 'co_visit'));
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.wb-special')?.textContent).toContain('Circuit overseer visit');
    const labels = [...el.querySelectorAll('.wb-alabel')].map((l) => l.textContent?.trim());
    expect(labels).not.toContain('Conductor:');
  });

  it('uses Iloko labels when the language input is ilo', () => {
    const fixture = TestBed.createComponent(MeetingWeekWorkbookComponent);
    fixture.componentRef.setInput('week', createEmptyWeek('2026-08-10'));
    fixture.componentRef.setInput('language', 'ilo');
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.wb-head')?.textContent).toContain('AGOSTO 10 – 16');
    expect(el.querySelector('.wb-section')?.textContent).toContain(
      'GAMENG MANIPUD ITI SAO TI DIOS'
    );
    const labels = [...el.querySelectorAll('.wb-alabel')].map((l) => l.textContent?.trim());
    expect(labels).toContain('Estudiante:');
    expect(labels).toContain('Parabasa:');
  });
});

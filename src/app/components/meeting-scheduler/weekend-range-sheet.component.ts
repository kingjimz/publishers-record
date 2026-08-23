import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MeetingWeek, PublisherTypeHistory } from '../../services/meeting-schedule.service';
import { PublisherRecord } from '../../services/supabase.service';
import { TalkOutline } from '../../services/talk-outline.service';
import { ScheduleLanguage } from '../../utils/meeting-schedule-model';
import {
  WEEKEND_BAND_COLOR,
  WeekendMonthGroup,
  WeekendRangeLabels,
  buildWeekendRowVM,
  groupWeekendRowsByMonth,
  weekendRangeLabels,
} from '../../utils/weekend-range-model';
import { displayPublisherName } from '../../utils/publisher-name';
import { AssigneePickerComponent } from './assignee-picker.component';
import { TalkOutlinePickerComponent, TalkThemePick } from './talk-outline-picker.component';
import { Eligibility, ROLE_RULES } from './meeting-defaults';

/** One choice in the per-row week-kind select. */
export type WeekendRowKindValue =
  | 'regular'
  | 'co_visit'
  | 'special_talk'
  | 'symposium'
  | 'assembly'
  | 'convention'
  | 'memorial'
  | 'no_meeting';

const ROW_KIND_OPTIONS: { value: WeekendRowKindValue; label: string }[] = [
  { value: 'regular', label: 'Public Talk' },
  { value: 'co_visit', label: "C.O's Visit" },
  { value: 'special_talk', label: 'Special Talk' },
  { value: 'symposium', label: 'Symposium' },
  { value: 'assembly', label: 'Circuit Assembly' },
  { value: 'convention', label: 'Regional Convention' },
  { value: 'memorial', label: 'Memorial' },
  { value: 'no_meeting', label: 'No Meeting' },
];

/** Weekend role columns folded into the per-row duplicate check. */
const WEEKEND_SLOT_LABELS: Record<string, string> = {
  weekend_chairman_name: 'Chairman',
  public_talk_speaker_name: 'Speaker',
  public_talk_speaker2_name: 'Speaker',
  wt_conductor_name: 'Watchtower Conductor',
  wt_reader_name: 'Watchtower Reader',
  weekend_opening_prayer_name: 'Opening Prayer',
  weekend_closing_prayer_name: 'Closing Prayer',
};

/**
 * WYSIWYG weekend range sheet: renders the whole rotation cycle exactly like
 * the printed schedule (same shared view model as weekend-range-print.ts)
 * with inline editing. Mutates the draft weeks in place, the same contract as
 * the midweek workbook sheet; saving stays with the page.
 */
@Component({
  selector: 'app-weekend-range-sheet',
  standalone: true,
  imports: [CommonModule, FormsModule, AssigneePickerComponent, TalkOutlinePickerComponent],
  templateUrl: './weekend-range-sheet.component.html',
  styleUrl: './weekend-range-sheet.component.css',
  host: { '[class.ws-readonly]': 'readonly' },
})
export class WeekendRangeSheetComponent {
  /** Draft rows, one per Sunday of the cycle, mutated in place. */
  @Input({ required: true }) weeks!: MeetingWeek[];
  @Input({ required: true }) congregationName!: string;
  /** Free-text label under the title, e.g. "Agosto – Disiembre 2026". */
  @Input() rangeLabel = '';
  @Output() rangeLabelChange = new EventEmitter<string>();
  /** Render the sheet as a non-editable summary. */
  @Input() readonly = false;
  @Input() publishers: PublisherRecord[] = [];
  @Input() history: Map<string, string> = new Map();
  @Input() historyDetail: Map<string, PublisherTypeHistory> = new Map();
  @Input() outlines: TalkOutline[] = [];
  /** talk number -> ISO date the outline was last given. */
  @Input() outlineUsage: Map<number, string> = new Map();
  @Input() language: ScheduleLanguage = 'ilo';
  /** Fired after a row's kind changes so the page can offer the extend/shorten prompt. */
  @Output() rowKindChange = new EventEmitter<MeetingWeek>();

  protected readonly rowKindOptions = ROW_KIND_OPTIONS;
  /** Band/header blue from the shared model, inline so specs can assert it. */
  protected readonly bandColor = WEEKEND_BAND_COLOR;

  protected get labels(): WeekendRangeLabels {
    return weekendRangeLabels(this.language);
  }

  protected get groups(): WeekendMonthGroup[] {
    const rows = this.weeks
      .map((week) => buildWeekendRowVM(week))
      .sort((a, b) => a.sunday.localeCompare(b.sunday));
    return groupWeekendRowsByMonth(rows, this.labels);
  }

  protected roleEligibility(role: string): Eligibility {
    return ROLE_RULES[role] ?? 'any';
  }

  /** name -> slot labels already filled on this row, for the duplicate warning. */
  protected assignmentsFor(week: MeetingWeek): Map<string, string[]> {
    const assignments = new Map<string, string[]>();
    for (const [column, label] of Object.entries(WEEKEND_SLOT_LABELS)) {
      const name = (week as unknown as Record<string, string | null>)[column]?.trim();
      if (!name) continue;
      const labels = assignments.get(name) ?? [];
      labels.push(label);
      assignments.set(name, labels);
    }
    return assignments;
  }

  protected displayName(name: string | null): string {
    return displayPublisherName(name);
  }

  protected rowKindValue(week: MeetingWeek): WeekendRowKindValue {
    if (week.weekend_event === 'assembly' || week.weekend_event === 'convention') {
      return week.weekend_event;
    }
    if (week.week_type === 'memorial' || week.week_type === 'no_meeting') return week.week_type;
    if (week.week_type === 'co_visit') return 'co_visit';
    if (week.weekend_event === 'symposium' || week.weekend_event === 'special_talk') {
      return week.weekend_event;
    }
    return 'regular';
  }

  protected onRowKind(week: MeetingWeek, kind: WeekendRowKindValue): void {
    if (kind !== 'symposium') week.public_talk_speaker2_name = null;

    switch (kind) {
      case 'co_visit':
        week.week_type = 'co_visit';
        week.weekend_event = null;
        break;
      case 'memorial':
      case 'no_meeting':
        week.week_type = kind;
        week.weekend_event = null;
        break;
      case 'special_talk':
      case 'symposium':
      case 'assembly':
      case 'convention':
        week.week_type = 'regular';
        week.weekend_event = kind;
        break;
      default:
        week.week_type = 'regular';
        week.weekend_event = null;
    }
    this.rowKindChange.emit(week);
  }

  protected onThemePicked(week: MeetingWeek, pick: TalkThemePick): void {
    week.public_talk_number = pick.number;
    week.public_talk_theme = pick.theme;
  }

  protected onRangeLabelInput(value: string): void {
    this.rangeLabel = value;
    this.rangeLabelChange.emit(value);
  }
}

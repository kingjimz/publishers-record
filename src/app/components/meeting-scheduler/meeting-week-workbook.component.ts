import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  MeetingPart,
  MeetingWeek,
  PublisherTypeHistory,
} from '../../services/meeting-schedule.service';
import { PublisherRecord } from '../../services/supabase.service';
import {
  AssignmentRolePair,
  LABELS,
  MidweekSectionVM,
  ScheduleLabels,
  ScheduleLanguage,
  assignmentRolePair,
  buildMidweekSections,
  weekRange,
} from '../../utils/meeting-schedule-model';
import { displayPublisherName } from '../../utils/publisher-name';
import { AssigneePickerComponent } from './assignee-picker.component';
import { Eligibility, PART_TYPE_LABELS, PART_TYPE_RULES, ROLE_RULES } from './meeting-defaults';

/**
 * WYSIWYG midweek sheet: renders the week exactly like the printed schedule
 * (same shared view model as meeting-schedule-print.ts) with inline editing.
 * Mutates the draft week in place, the same contract as the form view.
 */
@Component({
  selector: 'app-meeting-week-workbook',
  standalone: true,
  imports: [CommonModule, FormsModule, AssigneePickerComponent],
  templateUrl: './meeting-week-workbook.component.html',
  styleUrl: './meeting-week-workbook.component.css',
  host: { '[class.wb-readonly]': 'readonly' },
})
export class MeetingWeekWorkbookComponent {
  @Input({ required: true }) week!: MeetingWeek;
  /** Render the sheet as a non-editable summary (saved week card). */
  @Input() readonly = false;
  @Input() publishers: PublisherRecord[] = [];
  @Input() history: Map<string, string> = new Map();
  @Input() historyDetail: Map<string, PublisherTypeHistory> = new Map();
  /** name -> slot labels already filled in the draft; pass the editor's draftAssignments. */
  @Input() weekAssignments: Map<string, string[]> = new Map();
  @Input() language: ScheduleLanguage = 'en';

  protected readonly cleaningGroups = Array.from({ length: 10 }, (_, i) => `Group ${i + 1}`);

  /** Common reasons offered as one-tap picks when the week has no meeting. */
  protected readonly noMeetingReasons: string[] = [
    'Regional Convention Week',
    'Circuit Assembly Week',
  ];

  protected get labels(): ScheduleLabels {
    return LABELS[this.language] ?? LABELS.en;
  }

  protected get headingRange(): string {
    return weekRange(this.week.week_of, this.labels);
  }

  protected get sections(): MidweekSectionVM[] {
    return buildMidweekSections(this.week, this.labels);
  }

  /** The CBS row's Reader name lives on the separate cbs_reader part. */
  protected get cbsReaderPart(): MeetingPart | null {
    return this.week.parts.find((p) => p.part_type === 'cbs_reader') ?? null;
  }

  /** Chairman name mirrored into the opening/closing comments rows, reading order. */
  protected get chairmanDisplay(): string {
    return displayPublisherName(this.week.chairman_name);
  }

  protected rolePair(part: MeetingPart): AssignmentRolePair | null {
    return assignmentRolePair(part.part_type, this.labels);
  }

  protected roleEligibility(role: string): Eligibility {
    return ROLE_RULES[role] ?? 'any';
  }

  protected partEligibility(part: MeetingPart): Eligibility {
    return PART_TYPE_RULES[part.part_type]?.eligibility ?? 'any';
  }

  protected partSlotLabel(part: MeetingPart): string {
    return part.title?.trim() || PART_TYPE_LABELS[part.part_type] || 'Part';
  }

  protected trackRow(index: number): number {
    return index;
  }
}

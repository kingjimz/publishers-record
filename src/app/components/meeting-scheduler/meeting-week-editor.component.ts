import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  MeetingPart,
  MeetingPartType,
  MeetingSection,
  MeetingWeek,
  MeetingWeekType,
} from '../../services/meeting-schedule.service';
import { PublisherRecord } from '../../services/supabase.service';
import { AssigneePickerComponent } from './assignee-picker.component';
import {
  Eligibility,
  PART_TYPE_LABELS,
  PART_TYPE_RULES,
  ROLE_RULES,
  buildDefaultWeekParts,
} from './meeting-defaults';

/** Edits one week's midweek program and weekend assignments in place on a draft copy. */
@Component({
  selector: 'app-meeting-week-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, AssigneePickerComponent],
  templateUrl: './meeting-week-editor.component.html',
})
export class MeetingWeekEditorComponent {
  @Input({ required: true }) week!: MeetingWeek;
  /** Which meeting's panel to show; the other meeting's data is preserved untouched. */
  @Input() mode: 'midweek' | 'weekend' = 'midweek';
  @Input() publishers: PublisherRecord[] = [];
  @Input() history: Map<string, string> = new Map();
  @Input() saving = false;
  @Output() save = new EventEmitter<void>();
  @Output() cancelEdit = new EventEmitter<void>();

  protected readonly partTypeLabels = PART_TYPE_LABELS;
  protected readonly partTypeOptions = Object.keys(PART_TYPE_LABELS) as MeetingPartType[];

  protected readonly sections: { key: MeetingSection; label: string; icon: string }[] = [
    { key: 'treasures', label: "Treasures From God's Word", icon: 'bi-gem' },
    { key: 'ministry', label: 'Apply Yourself to the Field Ministry', icon: 'bi-briefcase' },
    { key: 'living', label: 'Living as Christians', icon: 'bi-heart' },
  ];

  protected get hasMeeting(): boolean {
    return this.week.week_type !== 'no_meeting';
  }

  protected get isMemorial(): boolean {
    return this.week.week_type === 'memorial';
  }

  protected partsFor(section: MeetingSection): MeetingPart[] {
    return this.week.parts.filter((p) => p.section === section);
  }

  protected roleEligibility(role: string): Eligibility {
    return ROLE_RULES[role] ?? 'any';
  }

  protected partEligibility(part: MeetingPart): Eligibility {
    return PART_TYPE_RULES[part.part_type]?.eligibility ?? 'any';
  }

  protected allowsAssistant(part: MeetingPart): boolean {
    return (PART_TYPE_RULES[part.part_type]?.assistant ?? 'none') !== 'none';
  }

  protected onWeekTypeChange(newType: MeetingWeekType): void {
    const hadAssignments = this.week.parts.some((p) => p.assignee_name || p.assistant_name);
    if (hadAssignments) {
      const proceed = window.confirm(
        'Changing the week type rebuilds the midweek program and clears part assignments. Continue?'
      );
      if (!proceed) return;
    }
    this.week.week_type = newType;
    this.week.parts = buildDefaultWeekParts(newType);
  }

  protected addPart(section: MeetingSection): void {
    const sectionParts = this.partsFor(section);
    const defaults: Record<MeetingSection, { title: string; type: MeetingPartType }> = {
      treasures: { title: '', type: 'talk' },
      ministry: { title: '', type: 'student_demo' },
      living: { title: '', type: 'living_talk' },
    };
    this.week.parts = [
      ...this.week.parts,
      {
        section,
        sort_order: sectionParts.length,
        title: defaults[section].title,
        duration_minutes: null,
        part_type: defaults[section].type,
        setting: null,
        assignee_name: null,
        assistant_name: null,
        room: 'main',
      },
    ];
  }

  protected removePart(part: MeetingPart): void {
    this.week.parts = this.week.parts.filter((p) => p !== part);
  }

  protected movePart(part: MeetingPart, direction: -1 | 1): void {
    const sectionParts = this.partsFor(part.section);
    const index = sectionParts.indexOf(part);
    const target = index + direction;
    if (target < 0 || target >= sectionParts.length) return;

    const reordered = [...sectionParts];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];

    const others = this.week.parts.filter((p) => p.section !== part.section);
    const ordered: MeetingPart[] = [];
    for (const s of this.sections) {
      if (s.key === part.section) {
        ordered.push(...reordered);
      } else {
        ordered.push(...others.filter((p) => p.section === s.key));
      }
    }
    this.week.parts = ordered;
  }

  /** When a part type stops allowing an assistant, drop the stale assistant. */
  protected onPartTypeChange(part: MeetingPart): void {
    if (!this.allowsAssistant(part)) {
      part.assistant_name = null;
    }
  }

  protected trackPart(index: number): number {
    return index;
  }
}

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  MeetingPart,
  MeetingPartType,
  MeetingSection,
  MeetingWeek,
  MeetingWeekType,
  PublisherTypeHistory,
} from '../../services/meeting-schedule.service';
import { PublisherRecord } from '../../services/supabase.service';
import { ScheduleLanguage } from '../../utils/meeting-schedule-model';
import { AssigneePickerComponent } from './assignee-picker.component';
import {
  Eligibility,
  PART_TYPE_LABELS,
  PART_TYPE_RULES,
  ROLE_RULES,
  buildDefaultWeekParts,
} from './meeting-defaults';
import { MeetingWeekWorkbookComponent } from './meeting-week-workbook.component';

/** Preferred editor view, persisted per device. */
const EDITOR_VIEW_STORAGE_KEY = 'pr-meeting-editor-view';
type EditorViewMode = 'workbook' | 'form';

/** Edits one week's midweek program and weekend assignments in place on a draft copy. */
@Component({
  selector: 'app-meeting-week-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, AssigneePickerComponent, MeetingWeekWorkbookComponent],
  templateUrl: './meeting-week-editor.component.html',
})
export class MeetingWeekEditorComponent {
  @Input({ required: true }) week!: MeetingWeek;
  /** Which meeting's panel to show; the other meeting's data is preserved untouched. */
  @Input() mode: 'midweek' | 'weekend' = 'midweek';
  @Input() publishers: PublisherRecord[] = [];
  @Input() history: Map<string, string> = new Map();
  @Input() historyDetail: Map<string, PublisherTypeHistory> = new Map();
  /** Schedule language, so the workbook view matches the export. */
  @Input() language: ScheduleLanguage = 'en';
  @Input() saving = false;
  @Output() save = new EventEmitter<void>();
  @Output() cancelEdit = new EventEmitter<void>();

  /** Workbook (WYSIWYG sheet) or classic form view; midweek only. */
  protected viewMode: EditorViewMode = MeetingWeekEditorComponent.storedViewMode();

  private static storedViewMode(): EditorViewMode {
    try {
      const stored = localStorage.getItem(EDITOR_VIEW_STORAGE_KEY);
      if (stored === 'form' || stored === 'workbook') return stored;
    } catch {
      // Storage unavailable (private mode); fall through to the default.
    }
    return 'workbook';
  }

  protected setViewMode(mode: EditorViewMode): void {
    this.viewMode = mode;
    try {
      localStorage.setItem(EDITOR_VIEW_STORAGE_KEY, mode);
    } catch {
      // Storage unavailable; the choice still applies for this session.
    }
  }

  /** The workbook sheet only exists for the midweek program. */
  protected get workbookAvailable(): boolean {
    return this.mode === 'midweek';
  }

  protected get showWorkbook(): boolean {
    return this.workbookAvailable && this.viewMode === 'workbook';
  }

  protected readonly partTypeLabels = PART_TYPE_LABELS;

  /** Cleaning group choices for the Cleaner of the Week dropdown. */
  protected readonly cleaningGroups = Array.from({ length: 10 }, (_, i) => `Group ${i + 1}`);
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

  /**
   * name -> slot labels currently filled in this draft (including unsaved
   * changes). Feeds the pickers' "already assigned this week" warning.
   */
  protected get draftAssignments(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    const add = (name: string | null | undefined, label: string) => {
      if (!name) return;
      const list = map.get(name) ?? [];
      list.push(label);
      map.set(name, list);
    };

    add(this.week.chairman_name, 'Chairman');
    add(this.week.opening_prayer_name, 'Opening Prayer');
    add(this.week.closing_prayer_name, 'Closing Prayer');
    add(this.week.weekend_chairman_name, 'Chairman (Weekend)');
    add(this.week.public_talk_speaker_name, 'Public Talk');
    add(this.week.wt_conductor_name, 'WT Conductor');
    add(this.week.wt_reader_name, 'WT Reader');
    add(this.week.weekend_opening_prayer_name, 'Opening Prayer (Weekend)');
    add(this.week.weekend_closing_prayer_name, 'Closing Prayer (Weekend)');
    for (const part of this.week.parts) {
      const label = this.partSlotLabel(part);
      add(part.assignee_name, label);
      add(part.assistant_name, `Assistant: ${label}`);
    }
    return map;
  }

  /** Human label for a part slot; falls back to the part-type label for untitled parts. */
  protected partSlotLabel(part: MeetingPart): string {
    return part.title?.trim() || PART_TYPE_LABELS[part.part_type] || 'Part';
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

  /** Week type awaiting confirmation because applying it would clear assignments. */
  protected pendingWeekType: MeetingWeekType | null = null;

  protected onWeekTypeChange(newType: MeetingWeekType): void {
    const hadAssignments = this.week.parts.some((p) => p.assignee_name || p.assistant_name);
    if (hadAssignments && newType !== this.week.week_type) {
      this.pendingWeekType = newType;
      return;
    }
    this.pendingWeekType = null;
    this.applyWeekType(newType);
  }

  protected confirmWeekTypeChange(): void {
    if (!this.pendingWeekType) return;
    this.applyWeekType(this.pendingWeekType);
    this.pendingWeekType = null;
  }

  protected cancelWeekTypeChange(): void {
    this.pendingWeekType = null;
  }

  private applyWeekType(newType: MeetingWeekType): void {
    this.week.week_type = newType;
    this.week.parts = buildDefaultWeekParts(newType);
    if (newType !== 'no_meeting') this.week.no_meeting_reason = null;
  }

  /** Common reasons offered as one-tap picks when the week has no meeting. */
  protected readonly noMeetingReasons: string[] = [
    'Regional Convention Week',
    'Circuit Assembly Week',
  ];

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

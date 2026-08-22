import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PublisherTypeHistory } from '../../services/meeting-schedule.service';
import { PublisherRecord } from '../../services/supabase.service';
import { displayPublisherName } from '../../utils/publisher-name';
import {
  Eligibility,
  HISTORY_KEY_LABELS,
  assistantWarning,
  eligibilityWarning,
  partnerRecencyWarning,
  recencyKeyGroup,
  recencyWarning,
} from './meeting-defaults';

interface PickerOption {
  /** Canonical stored name ("Lastname, Firstname"); what selection emits. */
  name: string;
  /** Reading order shown to the user. */
  label: string;
  eligible: boolean;
  warnings: string[];
  /** True when the only concern is rotation recency (sorts above hard mismatches). */
  recentOnly: boolean;
  badge: string | null;
  lastAssigned: string | null;
  /** How many times this publisher had this part type within the loaded window. */
  historyCount: number;
  /** All assignments across every part type and role within the loaded window. */
  totalHistoryCount: number;
}

/** One row in the full-history modal: any assignment, newest first. */
interface HistoryTimelineEntry {
  date: string;
  label: string;
  title: string | null;
  partner: string | null;
}

/** Preferred panel width in px; shrinks on narrow viewports. */
const PANEL_WIDTH = 460;
/** Preferred max height of the options list in px (matches the old max-h-96). */
const LIST_MAX_HEIGHT = 384;
/** Viewport margin the panel keeps clear on every side. */
const PANEL_MARGIN = 16;
/** Approximate height of the search bar and padding above the scroll list. */
const PANEL_CHROME = 70;

/**
 * Searchable publisher select for meeting assignments. Eligibility mismatches
 * show a soft warning but are always selectable; `allowFreeText` also lets the
 * user keep arbitrary names (visiting speakers).
 */
@Component({
  selector: 'app-assignee-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './assignee-picker.component.html',
})
export class AssigneePickerComponent implements OnDestroy {
  @Input() publishers: PublisherRecord[] = [];
  /** 'field' renders the standard bordered control; 'inline' renders a
   * borderless trigger that inherits the surrounding typography (workbook view). */
  @Input() variant: 'field' | 'inline' = 'field';
  /** Inline variant only: render the value as plain text, no panel (saved-week sheet). */
  @Input() readonly = false;
  @Input() eligibility: Eligibility = 'any';
  @Input() history: Map<string, string> = new Map();
  /** Per-publisher assignment breakdown by part type / role key. */
  @Input() historyDetail: Map<string, PublisherTypeHistory> = new Map();
  /** History key of the slot being filled: part_type, role column, or 'assistant'. */
  @Input() historyKey: string | null = null;
  /** Week being edited; anchors the recency window and excludes itself. */
  @Input() weekOf: string | null = null;
  @Input() value: string | null = null;
  @Input() placeholder = 'Select publisher';
  @Input() allowFreeText = false;
  /** Student the pick will assist; enables the same-gender warning. */
  @Input() pairWith: string | null = null;
  /** name -> slot labels already filled in the week being edited (unsaved draft included). */
  @Input() weekAssignments: Map<string, string[]> = new Map();
  /** Label of the slot this picker fills; its own occurrence is excluded from the duplicate check. */
  @Input() slotLabel: string | null = null;
  @Output() valueChange = new EventEmitter<string | null>();

  @ViewChild('trigger') private trigger?: ElementRef<HTMLElement>;

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected open = false;
  protected query = '';
  protected historyModalFor: PickerOption | null = null;

  /** Fixed-position panel coordinates; computed from the trigger so ancestor
   * overflow-hidden containers (the week card) can never clip the dropdown.
   * Always opens below the field; the list shrinks when space is tight. */
  protected panelLeft = 0;
  protected panelTop = 0;
  protected panelWidth = PANEL_WIDTH;
  protected listMaxHeight = LIST_MAX_HEIGHT;

  /** Recomputes the panel position when the window resizes. */
  private readonly reposition = () => {
    if (!this.open) return;
    this.positionPanel();
    this.cdr.detectChanges();
  };

  /** Page scroll closes the dropdown (a fixed panel would detach from its
   * trigger); scrolling the options list or history modal keeps it open. */
  private readonly onPageScroll = (event: Event) => {
    if (!this.open) return;
    if (event.target instanceof Node && this.host.nativeElement.contains(event.target)) return;
    this.closePanel();
    this.cdr.detectChanges();
  };

  ngOnDestroy(): void {
    this.removeRepositionListeners();
  }

  protected get displayValue(): string {
    return displayPublisherName(this.value);
  }

  protected get currentWarning(): string | null {
    if (!this.value) return null;
    const publisher = this.findPublisher(this.value);
    if (!publisher) {
      return this.allowFreeText ? null : 'Not in the current publisher list.';
    }
    const warnings = this.warningsFor(publisher);
    return warnings.length > 0 ? warnings.join(' ') : null;
  }

  protected get options(): PickerOption[] {
    const q = this.query.trim().toLowerCase();
    const matches = this.publishers
      .filter((p) => !p.inactive)
      .map((p) => ({ publisher: p, label: displayPublisherName(p.publisher_name) }))
      // Match either order, so "Juan Cruz" and "Cruz, Juan" both find the same person.
      .filter(
        ({ publisher, label }) =>
          !q ||
          publisher.publisher_name.toLowerCase().includes(q) ||
          label.toLowerCase().includes(q)
      )
      .map(({ publisher, label }) => {
        const warnings = this.warningsFor(publisher);
        const recent = this.recencyFor(publisher.publisher_name);
        return {
          name: publisher.publisher_name,
          label,
          eligible: warnings.length === 0,
          warnings,
          recentOnly: warnings.length > 0 && warnings.every((w) => w === recent),
          badge: publisher.elder ? 'Elder' : publisher.ministerial_servant ? 'MS' : null,
          lastAssigned: this.lastAssignedLabel(publisher.publisher_name),
          historyCount: this.historyCountFor(publisher.publisher_name),
          totalHistoryCount: this.totalHistoryCountFor(publisher.publisher_name),
        };
      });

    // Three tiers: clean picks, rotation-only concerns, eligibility mismatches.
    const tier = (o: PickerOption) => (o.eligible ? 0 : o.recentOnly ? 1 : 2);
    return matches.sort((a, b) => {
      const byTier = tier(a) - tier(b);
      if (byTier !== 0) return byTier;
      // Sort by what the user reads, so the list looks alphabetical on screen.
      return a.label.localeCompare(b.label);
    });
  }

  protected get freeTextCandidate(): string | null {
    if (!this.allowFreeText) return null;
    const typed = this.query.trim();
    if (!typed) return null;
    const exact = this.publishers.some(
      (p) => p.publisher_name.toLowerCase() === typed.toLowerCase()
    );
    return exact ? null : typed;
  }

  /** Every assignment the modal publisher had, across all part types and roles, newest first. */
  protected get historyTimeline(): HistoryTimelineEntry[] {
    if (!this.historyModalFor) return [];
    const detail = this.historyDetail.get(this.historyModalFor.name);
    if (!detail) return [];
    const entries: HistoryTimelineEntry[] = [];
    for (const [key, events] of detail) {
      const label = HISTORY_KEY_LABELS[key] ?? key;
      for (const event of events) {
        entries.push({ date: event.date, label, title: event.title, partner: event.partner });
      }
    }
    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }

  protected openPanel(): void {
    this.open = true;
    this.query = '';
    this.positionPanel();
    window.addEventListener('resize', this.reposition);
    // Capture phase: the page scrolls inside layout containers, not only on window.
    window.addEventListener('scroll', this.onPageScroll, true);
  }

  protected closePanel(): void {
    this.open = false;
    this.query = '';
    this.removeRepositionListeners();
  }

  private removeRepositionListeners(): void {
    window.removeEventListener('resize', this.reposition);
    window.removeEventListener('scroll', this.onPageScroll, true);
  }

  private positionPanel(): void {
    const rect = this.trigger?.nativeElement.getBoundingClientRect();
    if (!rect) return;

    this.panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - PANEL_MARGIN * 2);
    this.panelLeft = Math.max(
      PANEL_MARGIN,
      Math.min(rect.left, window.innerWidth - this.panelWidth - PANEL_MARGIN)
    );

    this.panelTop = rect.bottom + 4;
    const spaceBelow = window.innerHeight - rect.bottom - PANEL_MARGIN;
    this.listMaxHeight = Math.max(160, Math.min(LIST_MAX_HEIGHT, spaceBelow - PANEL_CHROME));
  }

  protected select(name: string): void {
    this.value = name;
    this.valueChange.emit(name);
    this.closePanel();
  }

  protected clear(): void {
    this.value = null;
    this.valueChange.emit(null);
    this.closePanel();
  }

  protected openHistory(option: PickerOption, event: Event): void {
    // Keep the click from selecting the option or hitting the panel backdrop.
    event.stopPropagation();
    this.historyModalFor = option;
  }

  protected closeHistory(event?: Event): void {
    event?.stopPropagation();
    this.historyModalFor = null;
  }

  protected formatEventDate(iso: string): string {
    const date = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private findPublisher(name: string): PublisherRecord | undefined {
    return this.publishers.find((p) => p.publisher_name === name);
  }

  private warningsFor(publisher: PublisherRecord): string[] {
    const warnings: string[] = [];
    const base = eligibilityWarning(publisher, this.eligibility);
    if (base) warnings.push(base);
    if (this.pairWith) {
      const pairing = assistantWarning(this.findPublisher(this.pairWith), publisher);
      if (pairing) warnings.push(pairing);
      const repeatPartner = partnerRecencyWarning(
        this.historyDetail.get(publisher.publisher_name),
        this.pairWith,
        this.weekOf
      );
      if (repeatPartner) warnings.push(repeatPartner);
    }
    const duplicate = this.duplicateWarning(publisher.publisher_name);
    if (duplicate) warnings.push(duplicate);
    const recent = this.recencyFor(publisher.publisher_name);
    if (recent) warnings.push(recent);
    return warnings;
  }

  /** Warns when the candidate already holds another slot in the week being edited. */
  private duplicateWarning(name: string): string | null {
    const labels = this.weekAssignments.get(name);
    if (!labels || labels.length === 0) return null;

    let others = labels;
    if (name === this.value && this.slotLabel) {
      const own = labels.indexOf(this.slotLabel);
      if (own >= 0) others = [...labels.slice(0, own), ...labels.slice(own + 1)];
    }
    if (others.length === 0) return null;

    const unique = [...new Set(others)];
    return `Already assigned this week: ${unique.join(', ')}.`;
  }

  private recencyFor(name: string): string | null {
    return recencyWarning(this.historyDetail.get(name), this.historyKey, this.weekOf);
  }

  private historyCountFor(name: string): number {
    if (!this.historyKey) return 0;
    const detail = this.historyDetail.get(name);
    if (!detail) return 0;
    return recencyKeyGroup(this.historyKey).reduce(
      (sum, key) => sum + (detail.get(key)?.length ?? 0),
      0
    );
  }

  private totalHistoryCountFor(name: string): number {
    const detail = this.historyDetail.get(name);
    if (!detail) return 0;
    let total = 0;
    for (const events of detail.values()) total += events.length;
    return total;
  }

  protected partnerLabel(partner: string): string {
    return displayPublisherName(partner);
  }

  private lastAssignedLabel(name: string): string | null {
    const iso = this.history.get(name);
    if (!iso) return null;
    const then = new Date(`${iso}T00:00:00`).getTime();
    if (Number.isNaN(then)) return null;
    const weeks = Math.floor((Date.now() - then) / (7 * 24 * 60 * 60 * 1000));
    if (weeks <= 0) return 'this week';
    if (weeks === 1) return '1 wk ago';
    return `${weeks} wks ago`;
  }
}

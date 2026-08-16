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

import { TalkOutline } from '../../services/talk-outline.service';

/** What selecting an outline (or typing free text) sets on the week. */
export interface TalkThemePick {
  number: number | null;
  theme: string | null;
}

interface OutlineOption {
  talkNumber: number;
  title: string;
  /** "NNN. Title" as shown in the list and on the trigger. */
  label: string;
  lastGiven: string | null;
}

/** Same fixed-panel dimensions as the assignee picker. */
const PANEL_WIDTH = 460;
const LIST_MAX_HEIGHT = 384;
const PANEL_MARGIN = 16;
const PANEL_CHROME = 70;

/**
 * Searchable public talk theme select fed by the S-99 outline library.
 * Selecting an outline sets both the number and the title; free text (drama
 * titles, un-imported outlines) sets the title only and clears the number.
 */
@Component({
  selector: 'app-talk-outline-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './talk-outline-picker.component.html',
})
export class TalkOutlinePickerComponent implements OnDestroy {
  @Input() outlines: TalkOutline[] = [];
  /** talk number -> ISO date the outline was last given. */
  @Input() usage: Map<number, string> = new Map();
  @Input() talkNumber: number | null = null;
  @Input() theme: string | null = null;
  @Input() placeholder = 'Select talk theme';
  @Output() picked = new EventEmitter<TalkThemePick>();

  @ViewChild('trigger') private trigger?: ElementRef<HTMLElement>;

  private readonly cdr = inject(ChangeDetectorRef);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected open = false;
  protected query = '';

  protected panelLeft = 0;
  protected panelTop = 0;
  protected panelWidth = PANEL_WIDTH;
  protected listMaxHeight = LIST_MAX_HEIGHT;

  private readonly reposition = () => {
    if (!this.open) return;
    this.positionPanel();
    this.cdr.detectChanges();
  };

  private readonly onPageScroll = (event: Event) => {
    if (!this.open) return;
    if (event.target instanceof Node && this.host.nativeElement.contains(event.target)) return;
    this.closePanel();
    this.cdr.detectChanges();
  };

  ngOnDestroy(): void {
    this.removeListeners();
  }

  protected get displayValue(): string {
    if (!this.theme) return '';
    return this.talkNumber ? `${this.talkNumber}. ${this.theme}` : this.theme;
  }

  protected get options(): OutlineOption[] {
    const q = this.query.trim().toLowerCase();
    return this.outlines
      .filter((o) => o.is_active)
      .filter(
        (o) =>
          !q || String(o.talk_number).startsWith(q) || o.title.toLowerCase().includes(q)
      )
      .map((o) => ({
        talkNumber: o.talk_number,
        title: o.title,
        label: `${o.talk_number}. ${o.title}`,
        lastGiven: this.lastGivenLabel(o.talk_number),
      }));
  }

  /** Typed text offered as a free-text theme when it matches no outline. */
  protected get freeTextCandidate(): string | null {
    const typed = this.query.trim();
    if (!typed) return null;
    const exact = this.outlines.some((o) => o.title.toLowerCase() === typed.toLowerCase());
    return exact ? null : typed;
  }

  protected openPanel(): void {
    this.open = true;
    this.query = '';
    this.positionPanel();
    window.addEventListener('resize', this.reposition);
    window.addEventListener('scroll', this.onPageScroll, true);
  }

  protected closePanel(): void {
    this.open = false;
    this.query = '';
    this.removeListeners();
  }

  private removeListeners(): void {
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

  protected select(option: OutlineOption): void {
    this.talkNumber = option.talkNumber;
    this.theme = option.title;
    this.picked.emit({ number: option.talkNumber, theme: option.title });
    this.closePanel();
  }

  protected selectFreeText(text: string): void {
    this.talkNumber = null;
    this.theme = text;
    this.picked.emit({ number: null, theme: text });
    this.closePanel();
  }

  protected clear(): void {
    this.talkNumber = null;
    this.theme = null;
    this.picked.emit({ number: null, theme: null });
    this.closePanel();
  }

  private lastGivenLabel(talkNumber: number): string | null {
    const iso = this.usage.get(talkNumber);
    if (!iso) return null;
    const then = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(then.getTime())) return null;
    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}

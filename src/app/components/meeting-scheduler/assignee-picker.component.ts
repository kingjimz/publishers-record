import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { PublisherRecord } from '../../services/supabase.service';
import { displayPublisherName } from '../../utils/publisher-name';
import { Eligibility, assistantWarning, eligibilityWarning } from './meeting-defaults';

interface PickerOption {
  /** Canonical stored name ("Lastname, Firstname"); what selection emits. */
  name: string;
  /** Reading order shown to the user. */
  label: string;
  eligible: boolean;
  warning: string | null;
  badge: string | null;
  lastAssigned: string | null;
}

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
export class AssigneePickerComponent {
  @Input() publishers: PublisherRecord[] = [];
  @Input() eligibility: Eligibility = 'any';
  @Input() history: Map<string, string> = new Map();
  @Input() value: string | null = null;
  @Input() placeholder = 'Select publisher';
  @Input() allowFreeText = false;
  /** Student the pick will assist; enables the same-gender warning. */
  @Input() pairWith: string | null = null;
  @Output() valueChange = new EventEmitter<string | null>();

  protected open = false;
  protected query = '';

  protected get displayValue(): string {
    return displayPublisherName(this.value);
  }

  protected get currentWarning(): string | null {
    if (!this.value) return null;
    const publisher = this.findPublisher(this.value);
    if (!publisher) {
      return this.allowFreeText ? null : 'Not in the current publisher list.';
    }
    return this.warningFor(publisher);
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
        const warning = this.warningFor(publisher);
        return {
          name: publisher.publisher_name,
          label,
          eligible: warning === null,
          warning,
          badge: publisher.elder ? 'Elder' : publisher.ministerial_servant ? 'MS' : null,
          lastAssigned: this.lastAssignedLabel(publisher.publisher_name),
        };
      });

    return matches.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
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

  protected openPanel(): void {
    this.open = true;
    this.query = '';
  }

  protected closePanel(): void {
    this.open = false;
    this.query = '';
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

  private findPublisher(name: string): PublisherRecord | undefined {
    return this.publishers.find((p) => p.publisher_name === name);
  }

  private warningFor(publisher: PublisherRecord): string | null {
    const base = eligibilityWarning(publisher, this.eligibility);
    if (base) return base;
    if (this.pairWith) {
      return assistantWarning(this.findPublisher(this.pairWith), publisher);
    }
    return null;
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

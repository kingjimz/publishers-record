import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  PublisherMonthlyRecord,
  PublisherPioneerProfile,
  PublisherRecord,
  SupabaseService,
} from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { groupPublishersForSidebar } from '../../utils/group-publishers';
import { ServiceYearSelectorComponent } from '../service-year-selector/service-year-selector.component';

@Component({
  selector: 'app-add-records',
  standalone: true,
  imports: [CommonModule, FormsModule, ServiceYearSelectorComponent],
  templateUrl: './add-records.component.html',
  styleUrl: './add-records.component.css',
})
export class AddRecordsComponent implements OnInit {
  /** Fixed choices stored as publisher_group in the database. */
  protected static readonly publisherGroupChoices = [
    'Group 1',
    'Group 2',
    'Group 3',
    'Group 4',
    'Group 5',
  ] as const;

  protected readonly publisherGroupOptions = AddRecordsComponent.publisherGroupChoices;

  protected saving = false;
  protected recordsLoading = false;
  protected copying = false;

  protected publisherName = '';
  /** One of publisherGroupChoices or '' for no group (saved as publisher_group). */
  protected publisherGroup = '';
  protected dateOfBirth = '';
  protected dateOfBaptism = '';
  protected unbaptizedApprovedOn = '';
  protected gender: 'male' | 'female' | 'other' | '' = '';
  protected otherSheep = false;
  protected anointed = false;
  protected unbaptizedPublisher = false;
  protected elder = false;
  protected ministerialServant = false;
  protected regularPioneer = false;
  protected specialPioneer = false;
  protected fieldMissionary = false;
  protected showPioneerDates = false;
  /** Multiple auxiliary stints (e.g. Sep–Apr, then approved again later in the service year). */
  protected auxiliaryPeriods: { approvedOn: string; endedOn: string }[] = [
    { approvedOn: '', endedOn: '' },
  ];
  protected regularPioneerPeriods: { approvedOn: string; stoppedOn: string }[] = [
    { approvedOn: '', stoppedOn: '' },
  ];
  protected monthlyRecords: PublisherMonthlyRecord[] = this.createDefaultMonths();
  protected yearRecords: PublisherRecord[] = [];
  /** Filters the right-hand publisher list (name contains, case-insensitive). */
  protected sidebarPublisherSearch = '';

  /** JSON snapshot of last loaded/saved payload; null = new unsaved entry (only name required). */
  private editBaselineJson: string | null = null;

  /** True when we loaded/edit an existing publisher (sidebar selection or after saving). */
  protected get hasSelectedPublisher(): boolean {
    return this.editBaselineJson !== null;
  }

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadRecordsForYear();
  }

  protected async onYearChanged(): Promise<void> {
    this.sidebarPublisherSearch = '';
    await this.loadRecordsForYear();
  }

  /** Publishers in the sidebar list after applying the search filter. */
  protected get filteredYearRecords(): PublisherRecord[] {
    const q = this.sidebarPublisherSearch.trim().toLowerCase();
    if (!q) return this.yearRecords;
    return this.yearRecords.filter((r) =>
      r.publisher_name.toLowerCase().includes(q)
    );
  }

  /** Sidebar sections grouped by publisher_group (names sorted within each group). */
  protected get sidebarPublisherGroups(): { label: string; records: PublisherRecord[] }[] {
    return groupPublishersForSidebar(this.filteredYearRecords);
  }

  protected clearSidebarPublisherSearch(): void {
    this.sidebarPublisherSearch = '';
    this.cdr.markForCheck();
  }

  protected async onCopyFromPreviousYear(): Promise<void> {
    if (this.copying || this.saving || this.recordsLoading) {
      return;
    }
    this.copying = true;
    this.toast.dismiss();
    this.cdr.detectChanges();

    try {
      const currentYear = this.supabase.serviceYear();
      const previousYear = currentYear - 1;
      const count = await this.supabase.copyPublishersFromYear(previousYear, currentYear);

      if (count === 0) {
        this.toast.showSuccess('No new publishers copied (already in this year).');
      } else {
        const n = count === 1 ? 'publisher' : 'publishers';
        this.toast.showSuccess(`${count} ${n} copied from last year.`);
      }
      await this.loadRecordsForYear();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to copy publishers.');
    } finally {
      this.copying = false;
      this.cdr.detectChanges();
    }
  }

  protected addAuxiliaryPeriodRow(): void {
    this.auxiliaryPeriods = [...this.auxiliaryPeriods, { approvedOn: '', endedOn: '' }];
    this.cdr.markForCheck();
  }

  protected removeAuxiliaryPeriodRow(index: number): void {
    this.pendingPioneerRemoval = { type: 'auxiliary', index };
    this.cdr.markForCheck();
  }

  protected removeRegularPioneerPeriodRow(index: number): void {
    this.pendingPioneerRemoval = { type: 'regular', index };
    this.cdr.markForCheck();
  }

  protected pendingPioneerRemoval: { type: 'auxiliary' | 'regular'; index: number } | null = null;

  protected cancelPioneerPeriodRemoval(): void {
    this.pendingPioneerRemoval = null;
    this.cdr.markForCheck();
  }

  protected confirmPioneerPeriodRemoval(): void {
    const pending = this.pendingPioneerRemoval;
    if (!pending) return;
    if (pending.type === 'auxiliary') {
      this.auxiliaryPeriods = this.auxiliaryPeriods.filter((_, i) => i !== pending.index);
      if (this.auxiliaryPeriods.length === 0) {
        this.auxiliaryPeriods = [{ approvedOn: '', endedOn: '' }];
      }
    } else {
      this.regularPioneerPeriods = this.regularPioneerPeriods.filter((_, i) => i !== pending.index);
      if (this.regularPioneerPeriods.length === 0) {
        this.regularPioneerPeriods = [{ approvedOn: '', stoppedOn: '' }];
      }
    }
    this.pendingPioneerRemoval = null;
    this.cdr.markForCheck();
  }

  protected addRegularPioneerPeriodRow(): void {
    this.regularPioneerPeriods = [...this.regularPioneerPeriods, { approvedOn: '', stoppedOn: '' }];
    this.cdr.markForCheck();
  }

  protected async onEditRecord(record: PublisherRecord): Promise<void> {
    this.publisherName = record.publisher_name;
    this.publisherGroup = this.normalizePublisherGroup(record.publisher_group ?? '');
    this.dateOfBirth = record.date_of_birth ?? '';
    this.dateOfBaptism = record.date_of_baptism ?? '';
    this.unbaptizedApprovedOn = record.unbaptized_approved_on ?? '';
    this.gender = record.gender ?? '';
    this.otherSheep = record.other_sheep;
    this.anointed = record.anointed;
    this.unbaptizedPublisher = !!record.unbaptized_publisher;
    this.elder = record.elder;
    this.ministerialServant = record.ministerial_servant;
    this.regularPioneer = record.regular_pioneer;
    this.specialPioneer = record.special_pioneer;
    this.fieldMissionary = record.field_missionary;

    const defaultMonths = this.createDefaultMonths();
    this.monthlyRecords = defaultMonths.map((month) => {
      const existing = record.months.find((item) => item.month === month.month);
      return existing
        ? {
            month: existing.month,
            sharedInMinistry: Boolean(existing.sharedInMinistry),
            bibleStudies: existing.bibleStudies ?? null,
            auxiliaryPioneer: Boolean(existing.auxiliaryPioneer),
            hours: existing.hours ?? null,
            remarks: existing.remarks ?? '',
          }
        : month;
    });
    await this.loadPioneerProfileForPublisher(record.publisher_name);
    this.toast.showSuccess(`Opened: ${record.publisher_name}`);
    this.captureEditBaseline();
    this.cdr.detectChanges();
  }

  /** Keeps Save button state in sync under zoneless change detection. */
  protected onFormInteraction(): void {
    this.cdr.markForCheck();
  }

  protected formatHumanDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const raw = String(dateStr).trim();
    const datePart = raw.length >= 10 ? raw.slice(0, 10) : raw;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
    if (!match) return raw;

    const year = match[1];
    const month = Number(match[2]);
    const dayPadded = match[3];
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    if (month < 1 || month > 12) return raw;
    return `${monthNames[month - 1]} ${dayPadded}, ${year}`;
  }

  protected openDatePicker(input: HTMLInputElement): void {
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.click();
    }
  }

  /**
   * Save disabled when: in-flight ops, no name, or form matches last loaded/saved snapshot.
   */
  protected isSaveDisabled(): boolean {
    if (this.saving || this.recordsLoading || this.copying) {
      return true;
    }
    if (!this.publisherName.trim()) {
      return true;
    }
    if (this.editBaselineJson === null) {
      return false;
    }
    return this.currentPayloadFingerprint() === this.editBaselineJson;
  }

  protected async onSaveRecord(): Promise<void> {
    if (this.saving || this.recordsLoading || this.copying) {
      return;
    }
    if (!this.publisherName.trim()) {
      this.toast.showError('Publisher name is required.');
      return;
    }
    if (this.editBaselineJson !== null && this.currentPayloadFingerprint() === this.editBaselineJson) {
      this.toast.showInfo('No changes to save.');
      return;
    }

    this.saving = true;
    this.toast.dismiss();
    this.cdr.detectChanges();

    try {
      const payload = this.buildSavePayload();

      await this.supabase.upsertPublisherRecord(payload);
      await this.supabase.upsertPublisherPioneerProfile(this.buildPioneerProfilePayload());
      await this.loadRecordsForYear();
      this.onResetForm();
      this.toast.showSuccess(`Record saved for ${payload.publisher_name}.`);
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to save publisher record.');
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  protected onCancelEdit(): void {
    if (!this.hasSelectedPublisher) return;
    this.onResetForm();
  }

  protected togglePioneerDates(): void {
    this.showPioneerDates = !this.showPioneerDates;
    this.cdr.markForCheck();
  }

  protected confirmingDelete: string | null = null;

  protected onConfirmDelete(record: PublisherRecord): void {
    this.confirmingDelete = record.id ?? null;
  }

  protected onCancelDelete(): void {
    this.confirmingDelete = null;
  }

  protected async onDeleteRecord(record: PublisherRecord): Promise<void> {
    if (!record.id) return;
    this.toast.dismiss();
    this.confirmingDelete = null;
    this.cdr.detectChanges();

    try {
      await this.supabase.deletePublisherRecord(record.id, record.service_year_start);
      if (this.publisherName === record.publisher_name) {
        this.onResetForm();
      }
      this.toast.showSuccess(`Record removed for ${record.publisher_name}.`);

      await this.loadRecordsForYear();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to delete record.');
    } finally {
      this.cdr.detectChanges();
    }
  }

  protected onResetForm(): void {
    this.publisherName = '';
    this.publisherGroup = '';
    this.dateOfBirth = '';
    this.dateOfBaptism = '';
    this.unbaptizedApprovedOn = '';
    this.gender = '';
    this.otherSheep = false;
    this.anointed = false;
    this.unbaptizedPublisher = false;
    this.elder = false;
    this.ministerialServant = false;
    this.regularPioneer = false;
    this.specialPioneer = false;
    this.fieldMissionary = false;
    this.showPioneerDates = false;
    this.auxiliaryPeriods = [{ approvedOn: '', endedOn: '' }];
    this.regularPioneerPeriods = [{ approvedOn: '', stoppedOn: '' }];
    this.monthlyRecords = this.createDefaultMonths();
    this.editBaselineJson = null;
    this.toast.dismiss();
    this.cdr.markForCheck();
  }

  private async loadRecordsForYear(): Promise<void> {
    this.recordsLoading = true;
    this.cdr.detectChanges();

    try {
      this.yearRecords = await this.supabase.getPublisherRecordsByServiceYear(
        this.supabase.serviceYear()
      );
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to load service year records.');
    } finally {
      this.recordsLoading = false;
      this.cdr.detectChanges();
    }
  }

  private buildSavePayload(): PublisherRecord {
    const publisherName = this.publisherName.trim();
    const groupTrimmed = this.publisherGroup.trim();
    return {
      service_year_start: this.supabase.serviceYear(),
      publisher_name: publisherName,
      publisher_group: groupTrimmed ? groupTrimmed : null,
      date_of_birth: this.dateOfBirth || null,
      date_of_baptism: this.dateOfBaptism || null,
      unbaptized_publisher: this.unbaptizedPublisher,
      unbaptized_approved_on: this.unbaptizedApprovedOn || null,
      gender: this.gender || null,
      other_sheep: this.otherSheep,
      anointed: this.anointed,
      elder: this.elder,
      ministerial_servant: this.ministerialServant,
      regular_pioneer: this.regularPioneer,
      special_pioneer: this.specialPioneer,
      field_missionary: this.fieldMissionary,
      months: this.monthlyRecords.map((item) => ({
        month: item.month,
        sharedInMinistry: item.sharedInMinistry,
        bibleStudies: this.coerceNullableNumber(item.bibleStudies),
        auxiliaryPioneer: item.auxiliaryPioneer,
        hours: this.coerceNullableNumber(item.hours),
        remarks: item.remarks?.trim() ?? '',
      })),
    };
  }

  private buildPioneerProfilePayload(): PublisherPioneerProfile {
    const publisherName = this.publisherName.trim();
    const periods = this.auxiliaryPeriods
      .map((p) => ({
        approved_on: p.approvedOn.trim() || null,
        ended_on: p.endedOn.trim() || null,
      }))
      .filter((p) => p.approved_on != null || p.ended_on != null);
    const regularPeriods = this.regularPioneerPeriods
      .map((p) => ({
        approved_on: p.approvedOn.trim() || null,
        stopped_on: p.stoppedOn.trim() || null,
      }))
      .filter((p) => p.approved_on != null || p.stopped_on != null);
    return {
      publisher_name: publisherName,
      auxiliary_pioneer_periods: periods,
      regular_pioneer_periods: regularPeriods,
    };
  }

  private async loadPioneerProfileForPublisher(publisherName: string): Promise<void> {
    const toInputDate = (v: string | null | undefined): string => {
      if (v == null || v === '') return '';
      const t = String(v).trim();
      return t.length >= 10 ? t.slice(0, 10) : t;
    };
    try {
      const prof = await this.supabase.getPioneerProfileByPublisherName(publisherName.trim());
      const periods = prof?.auxiliary_pioneer_periods ?? [];
      this.auxiliaryPeriods =
        periods.length > 0
          ? periods.map((p) => ({
              approvedOn: toInputDate(p.approved_on),
              endedOn: toInputDate(p.ended_on),
            }))
          : [{ approvedOn: '', endedOn: '' }];
      const regularPeriods = prof?.regular_pioneer_periods ?? [];
      this.regularPioneerPeriods =
        regularPeriods.length > 0
          ? regularPeriods.map((p) => ({
              approvedOn: toInputDate(p.approved_on),
              stoppedOn: toInputDate(p.stopped_on),
            }))
          : [{ approvedOn: '', stoppedOn: '' }];
      this.showPioneerDates = this.hasAnyPioneerDateData();
    } catch {
      this.auxiliaryPeriods = [{ approvedOn: '', endedOn: '' }];
      this.regularPioneerPeriods = [{ approvedOn: '', stoppedOn: '' }];
      this.showPioneerDates = false;
    }
  }

  private hasAnyPioneerDateData(): boolean {
    if (this.regularPioneerPeriods.some((p) => p.approvedOn.trim() || p.stoppedOn.trim())) {
      return true;
    }
    return this.auxiliaryPeriods.some((p) => p.approvedOn.trim() || p.endedOn.trim());
  }

  private coerceNullableNumber(value: unknown): number | null {
    if (value == null || value === '') {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** Stable JSON for comparing “same data” regardless of object identity. */
  private normalizeRecordFingerprint(r: PublisherRecord): string {
    const normalized = {
      service_year_start: r.service_year_start,
      publisher_name: r.publisher_name.trim(),
      publisher_group: (() => {
        const t = (r.publisher_group ?? '').trim();
        return t || null;
      })(),
      date_of_birth: r.date_of_birth ?? null,
      date_of_baptism: r.date_of_baptism ?? null,
      unbaptized_publisher: !!r.unbaptized_publisher,
      unbaptized_approved_on: r.unbaptized_approved_on ?? null,
      gender: r.gender ?? null,
      other_sheep: !!r.other_sheep,
      anointed: !!r.anointed,
      elder: !!r.elder,
      ministerial_servant: !!r.ministerial_servant,
      regular_pioneer: !!r.regular_pioneer,
      special_pioneer: !!r.special_pioneer,
      field_missionary: !!r.field_missionary,
      months: r.months.map((m) => {
        const bs = m.bibleStudies == null ? null : Number(m.bibleStudies);
        const h = m.hours == null ? null : Number(m.hours);
        return {
          month: m.month,
          sharedInMinistry: !!m.sharedInMinistry,
          bibleStudies: Number.isFinite(bs as number) ? bs : null,
          auxiliaryPioneer: !!m.auxiliaryPioneer,
          hours: Number.isFinite(h as number) ? h : null,
          remarks: (m.remarks ?? '').trim(),
        };
      }),
    };
    return JSON.stringify(normalized);
  }

  private pioneerStateFingerprint(): string {
    return JSON.stringify({
      auxiliaryPeriods: this.auxiliaryPeriods.map((p) => ({
        approvedOn: p.approvedOn.trim() || null,
        endedOn: p.endedOn.trim() || null,
      })),
      regularPioneerPeriods: this.regularPioneerPeriods.map((p) => ({
        approvedOn: p.approvedOn.trim() || null,
        stoppedOn: p.stoppedOn.trim() || null,
      })),
    });
  }

  private currentPayloadFingerprint(): string {
    return JSON.stringify({
      record: this.normalizeRecordFingerprint(this.buildSavePayload()),
      pioneer: this.pioneerStateFingerprint(),
    });
  }

  private captureEditBaseline(): void {
    this.editBaselineJson = this.currentPayloadFingerprint();
  }

  private captureEditBaselineFromPayload(payload: PublisherRecord): void {
    this.editBaselineJson = this.normalizeRecordFingerprint(payload);
  }

  /** Maps legacy free-text values to '' so the dropdown stays valid. */
  private normalizePublisherGroup(value: string): string {
    const t = value.trim();
    const allowed = AddRecordsComponent.publisherGroupChoices as readonly string[];
    return allowed.includes(t) ? t : '';
  }

  private createDefaultMonths(): PublisherMonthlyRecord[] {
    return [
      'September', 'October', 'November', 'December',
      'January', 'February', 'March', 'April',
      'May', 'June', 'July', 'August',
    ].map((month) => ({
      month,
      sharedInMinistry: false,
      bibleStudies: null,
      auxiliaryPioneer: false,
      hours: null,
      remarks: '',
    }));
  }

}

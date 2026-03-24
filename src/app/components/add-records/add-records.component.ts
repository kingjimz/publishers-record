import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  PublisherMonthlyRecord,
  PublisherRecord,
  SupabaseService,
} from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { ServiceYearSelectorComponent } from '../service-year-selector/service-year-selector.component';

@Component({
  selector: 'app-add-records',
  standalone: true,
  imports: [CommonModule, FormsModule, ServiceYearSelectorComponent],
  templateUrl: './add-records.component.html',
  styleUrl: './add-records.component.css',
})
export class AddRecordsComponent implements OnInit {
  protected saving = false;
  protected recordsLoading = false;
  protected copying = false;

  protected publisherName = '';
  protected dateOfBirth = '';
  protected dateOfBaptism = '';
  protected gender: 'male' | 'female' | 'other' | '' = '';
  protected otherSheep = false;
  protected anointed = false;
  protected elder = false;
  protected ministerialServant = false;
  protected regularPioneer = false;
  protected specialPioneer = false;
  protected fieldMissionary = false;
  protected monthlyRecords: PublisherMonthlyRecord[] = this.createDefaultMonths();
  protected yearRecords: PublisherRecord[] = [];
  /** Filters the right-hand publisher list (name contains, case-insensitive). */
  protected sidebarPublisherSearch = '';

  /** JSON snapshot of last loaded/saved payload; null = new unsaved entry (only name required). */
  private editBaselineJson: string | null = null;

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

  protected onEditRecord(record: PublisherRecord): void {
    this.publisherName = record.publisher_name;
    this.dateOfBirth = record.date_of_birth ?? '';
    this.dateOfBaptism = record.date_of_baptism ?? '';
    this.gender = record.gender ?? '';
    this.otherSheep = record.other_sheep;
    this.anointed = record.anointed;
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
    this.toast.showSuccess(`Opened: ${record.publisher_name}`);
    this.captureEditBaseline();
    this.cdr.detectChanges();
  }

  /** Keeps Save button state in sync under zoneless change detection. */
  protected onFormInteraction(): void {
    this.cdr.markForCheck();
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
      this.toast.showSuccess(`Record saved for ${payload.publisher_name}.`);
      this.captureEditBaselineFromPayload(payload);
      await this.loadRecordsForYear();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to save publisher record.');
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
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
    this.dateOfBirth = '';
    this.dateOfBaptism = '';
    this.gender = '';
    this.otherSheep = false;
    this.anointed = false;
    this.elder = false;
    this.ministerialServant = false;
    this.regularPioneer = false;
    this.specialPioneer = false;
    this.fieldMissionary = false;
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
    return {
      service_year_start: this.supabase.serviceYear(),
      publisher_name: publisherName,
      date_of_birth: this.dateOfBirth || null,
      date_of_baptism: this.dateOfBaptism || null,
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
      date_of_birth: r.date_of_birth ?? null,
      date_of_baptism: r.date_of_baptism ?? null,
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

  private currentPayloadFingerprint(): string {
    return this.normalizeRecordFingerprint(this.buildSavePayload());
  }

  private captureEditBaseline(): void {
    this.editBaselineJson = this.currentPayloadFingerprint();
  }

  private captureEditBaselineFromPayload(payload: PublisherRecord): void {
    this.editBaselineJson = this.normalizeRecordFingerprint(payload);
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

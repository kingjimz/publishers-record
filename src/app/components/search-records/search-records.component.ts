import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

import {
  PublisherMonthlyRecord,
  PublisherRecord,
  SupabaseService,
} from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import {
  displayPublisherGroupLabel,
  sortPublishersByGroupThenName,
} from '../../utils/group-publishers';
import {
  buildPublisherRecordPrintDocument,
  sanitizeFilenamePart,
} from '../../utils/publisher-record-print';
import { ServiceYearSelectorComponent } from '../service-year-selector/service-year-selector.component';

@Component({
  selector: 'app-search-records',
  standalone: true,
  imports: [CommonModule, FormsModule, ServiceYearSelectorComponent],
  templateUrl: './search-records.component.html',
  styleUrl: './search-records.component.css',
})
export class SearchRecordsComponent implements OnInit, OnDestroy {
  protected loading = false;
  protected yearLoading = false;
  protected readonly pageSize = 20;
  protected page = 1;
  protected query = '';
  protected hasSearched = false;
  protected records: PublisherRecord[] = [];
  protected yearRecords: PublisherRecord[] = [];
  protected expandedPublisher: string | null = null;

  private querySub?: Subscription;

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Always load the full list for the currently selected service year.
    void this.loadYearRecords();

    this.querySub = this.route.queryParams.subscribe((params) => {
      const q = params['q'];
      if (q == null || String(q).trim() === '') return;
      const text = String(q).trim();
      this.query = text;
      this.hasSearched = true;
      this.resetPagination();
      void this.loadRecords();
    });
  }

  ngOnDestroy(): void {
    this.querySub?.unsubscribe();
  }

  protected async onSearch(): Promise<void> {
    const text = this.query.trim();
    if (!text) return;

    this.hasSearched = true;
    this.resetPagination();
    await this.loadRecords();
  }

  protected onClear(): void {
    this.query = '';
    this.hasSearched = false;
    this.records = [];
    this.expandedPublisher = null;
    this.resetPagination();
  }

  /** Selected year changed — view filters client-side (search data already loaded). */
  protected onYearChanged(): void {
    this.resetPagination();
    void this.loadYearRecords();
    this.cdr.detectChanges();
  }

  /** All rows returned by cross-year search, narrowed by current query text. */
  protected get filteredRecords(): PublisherRecord[] {
    const text = this.query.trim().toLowerCase();
    if (!text) return [];
    return this.records.filter((r) => r.publisher_name.toLowerCase().includes(text));
  }

  /** Rows shown in the list: selected service year only (search still used all years). */
  protected get recordsForSelectedYear(): PublisherRecord[] {
    const y = this.supabase.serviceYear();
    return this.filteredRecords.filter((r) => r.service_year_start === y);
  }

  protected get recordsForSelectedYearSorted(): PublisherRecord[] {
    return sortPublishersByGroupThenName(this.recordsForSelectedYear);
  }

  protected get yearRecordsSorted(): PublisherRecord[] {
    return sortPublishersByGroupThenName(this.yearRecords);
  }

  /** Records matching the search but in other years than the selected one. */
  protected get otherYearsMatchCount(): number {
    const y = this.supabase.serviceYear();
    return this.filteredRecords.filter((r) => r.service_year_start !== y).length;
  }

  /** e.g. "2023–2024, 2022–2023" for empty-state hints (newest first). */
  protected get otherYearsLabels(): string {
    const y = this.supabase.serviceYear();
    const starts = new Set<number>();
    for (const r of this.filteredRecords) {
      if (r.service_year_start !== y) starts.add(r.service_year_start);
    }
    return [...starts]
      .sort((a, b) => b - a)
      .map((s) => `${s}\u2013${s + 1}`)
      .join(', ');
  }

  /** Stable id for expand/collapse (same name can exist in multiple years). */
  protected recordRowKey(record: PublisherRecord): string {
    return record.id ?? `${record.service_year_start}\u0000${record.publisher_name}`;
  }

  protected get totalPublisherRows(): number {
    return (this.hasSearched ? this.recordsForSelectedYear : this.yearRecords).length;
  }

  protected get pageCount(): number {
    const total = this.totalPublisherRows;
    return total > 0 ? Math.ceil(total / this.pageSize) : 1;
  }

  protected get effectivePage(): number {
    return Math.min(Math.max(this.page, 1), this.pageCount);
  }

  protected get pagedPublisherRecords(): PublisherRecord[] {
    const source = this.hasSearched ? this.recordsForSelectedYearSorted : this.yearRecordsSorted;
    const safePage = this.effectivePage;
    const start = (safePage - 1) * this.pageSize;
    return source.slice(start, start + this.pageSize);
  }

  /** Paged rows with a group heading when the group changes (including first row). */
  protected get pagedPublisherListItems(): { record: PublisherRecord; groupHeading: string | null }[] {
    const page = this.pagedPublisherRecords;
    return page.map((record, i) => ({
      record,
      groupHeading:
        i === 0 ||
        displayPublisherGroupLabel(page[i - 1]!) !== displayPublisherGroupLabel(record)
          ? displayPublisherGroupLabel(record)
          : null,
    }));
  }

  protected get shownStartIndex(): number {
    const total = this.totalPublisherRows;
    if (total === 0) return 0;
    return (this.effectivePage - 1) * this.pageSize + 1;
  }

  protected get shownEndIndex(): number {
    const total = this.totalPublisherRows;
    if (total === 0) return 0;
    return Math.min(this.effectivePage * this.pageSize, total);
  }

  protected previousPage(): void {
    if (this.effectivePage <= 1) return;
    this.page = this.effectivePage - 1;
    this.expandedPublisher = null;
  }

  protected nextPage(): void {
    if (this.effectivePage >= this.pageCount) return;
    this.page = this.effectivePage + 1;
    this.expandedPublisher = null;
  }

  protected resetPagination(): void {
    this.page = 1;
    this.expandedPublisher = null;
  }

  protected toggleExpand(record: PublisherRecord): void {
    const key = this.recordRowKey(record);
    this.expandedPublisher = this.expandedPublisher === key ? null : key;
  }

  /**
   * Formats an ISO date string like "2005-01-07" into "January 07, 2005".
   * Returns "—" when missing or unparseable.
   */
  protected formatHumanDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';

    const raw = String(dateStr).trim();
    const datePart = raw.length >= 10 ? raw.slice(0, 10) : raw;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
    if (!match) return raw;

    const year = match[1];
    const month = Number(match[2]); // 1-12
    const dayPadded = match[3]; // keep leading zero

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];

    if (month < 1 || month > 12) return raw;
    return `${monthNames[month - 1]} ${dayPadded}, ${year}`;
  }

  protected getTotalHours(record: PublisherRecord): number {
    return record.months?.reduce((sum, m) => sum + (m.hours ?? 0), 0) ?? 0;
  }

  /** Opens the official-form layout in a new window and triggers print. */
  protected printRecord(record: PublisherRecord, event?: Event): void {
    event?.stopPropagation();
    const html = buildPublisherRecordPrintDocument(record);
    const w = window.open('', '_blank', 'noopener,noreferrer,width=960,height=1200');
    if (!w) {
      this.toast.showError('Pop-up blocked. Allow pop-ups to print this record.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    const runPrint = (): void => {
      try {
        w.print();
      } catch {
        /* ignore */
      }
    };
    setTimeout(runPrint, 300);
  }

  /** Downloads the same layout as a standalone HTML file (open in browser or print). */
  protected exportRecordHtml(record: PublisherRecord, event?: Event): void {
    event?.stopPropagation();
    const html = buildPublisherRecordPrintDocument(record);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `publisher-record-${sanitizeFilenamePart(record.publisher_name)}-${record.service_year_start}.html`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    this.toast.showSuccess('Record exported as HTML.');
  }

  protected confirmingDelete: string | null = null;
  protected deleting = false;

  /** Modal: edit monthly service report only (profile fields stay read-only in the modal). */
  protected reportModalRecord: PublisherRecord | null = null;
  protected reportModalMonths: PublisherMonthlyRecord[] = [];
  protected reportModalSaving = false;

  protected openReportModal(record: PublisherRecord, event?: Event): void {
    event?.stopPropagation();
    this.reportModalRecord = record;
    this.reportModalMonths = this.cloneMonthsForModal(record);
    this.cdr.detectChanges();
  }

  protected closeReportModal(): void {
    this.reportModalRecord = null;
    this.reportModalMonths = [];
    this.cdr.detectChanges();
  }

  protected async saveReportModal(): Promise<void> {
    const base = this.reportModalRecord;
    if (!base || this.reportModalSaving) return;

    this.reportModalSaving = true;
    this.toast.dismiss();
    this.cdr.detectChanges();

    try {
      const payload: PublisherRecord = {
        ...base,
        months: this.reportModalMonths.map((item) => ({
          month: item.month,
          sharedInMinistry: item.sharedInMinistry,
          bibleStudies: this.coerceNullableNumber(item.bibleStudies),
          auxiliaryPioneer: item.auxiliaryPioneer,
          hours: this.coerceNullableNumber(item.hours),
          remarks: item.remarks?.trim() ?? '',
        })),
      };

      await this.supabase.upsertPublisherRecord(payload);
      this.toast.showSuccess(`Monthly report saved for ${base.publisher_name}.`);
      this.closeReportModal();
      await this.loadYearRecords();
      if (this.hasSearched) await this.loadRecords();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to save monthly report.');
    } finally {
      this.reportModalSaving = false;
      this.cdr.detectChanges();
    }
  }

  private cloneMonthsForModal(record: PublisherRecord): PublisherMonthlyRecord[] {
    const order = [
      'September', 'October', 'November', 'December',
      'January', 'February', 'March', 'April',
      'May', 'June', 'July', 'August',
    ];
    const byMonth = new Map((record.months ?? []).map((m) => [m.month, m]));
    return order.map((month) => {
      const existing = byMonth.get(month);
      if (existing) {
        return {
          month: existing.month,
          sharedInMinistry: !!existing.sharedInMinistry,
          bibleStudies: existing.bibleStudies ?? null,
          auxiliaryPioneer: !!existing.auxiliaryPioneer,
          hours: existing.hours ?? null,
          remarks: existing.remarks ?? '',
        };
      }
      return {
        month,
        sharedInMinistry: false,
        bibleStudies: null,
        auxiliaryPioneer: false,
        hours: null,
        remarks: '',
      };
    });
  }

  private coerceNullableNumber(value: unknown): number | null {
    if (value == null || value === '') {
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  protected onConfirmDelete(record: PublisherRecord): void {
    this.confirmingDelete = record.id ?? null;
  }

  protected onCancelDelete(): void {
    this.confirmingDelete = null;
  }

  protected async onDeleteRecord(record: PublisherRecord): Promise<void> {
    if (!record.id) return;
    this.deleting = true;
    this.toast.dismiss();
    this.confirmingDelete = null;
    this.cdr.detectChanges();

    try {
      await this.supabase.deletePublisherRecord(record.id, record.service_year_start);
      if (this.expandedPublisher === this.recordRowKey(record)) {
        this.expandedPublisher = null;
      }
      this.toast.showSuccess(`Record removed for ${record.publisher_name}.`);
      await this.loadYearRecords();
      // If the user currently has an active search, refresh cross-year results too.
      if (this.hasSearched) await this.loadRecords();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to delete record.');
    } finally {
      this.deleting = false;
      this.cdr.detectChanges();
    }
  }

  private async loadRecords(): Promise<void> {
    this.resetPagination();
    this.loading = true;
    this.cdr.detectChanges();

    try {
      const text = this.query.trim();
      this.records = await this.supabase.searchPublisherRecordsAcrossYears(text);
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to load records.');
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  private async loadYearRecords(): Promise<void> {
    this.resetPagination();
    this.yearLoading = true;
    this.cdr.detectChanges();

    try {
      const y = this.supabase.serviceYear();
      this.yearRecords = await this.supabase.getPublisherRecordsByServiceYear(y);
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to load publishers.');
    } finally {
      this.yearLoading = false;
      this.cdr.detectChanges();
    }
  }
}

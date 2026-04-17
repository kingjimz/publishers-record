import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

import {
  emptyPublisherPioneerProfile,
  PublisherMonthlyRecord,
  PublisherPioneerProfile,
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
  /** Service-year month order (matches publisher record cards). */
  private static readonly SERVICE_YEAR_MONTH_ORDER = [
    'September',
    'October',
    'November',
    'December',
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
  ] as const;
  protected loading = false;
  protected yearLoading = false;
  protected selectedGroup = '';
  protected selectedPrivilege = '';
  protected query = '';
  protected hasSearched = false;
  protected records: PublisherRecord[] = [];
  protected yearRecords: PublisherRecord[] = [];
  /** Pioneer milestone dates keyed by exact `publisher_name` (per-publisher profile table). */
  protected pioneerDisplayByName: Record<string, PublisherPioneerProfile> = {};
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
      const privilege = params['privilege'];
      this.selectedPrivilege = this.parsePrivilege(privilege);

      if (q == null || String(q).trim() === '') {
        this.query = '';
        this.hasSearched = false;
        this.records = [];
        this.expandedPublisher = null;
        this.cdr.detectChanges();
        void this.refreshPioneerProfileMap();
        return;
      }

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
    void this.refreshPioneerProfileMap();
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

  protected get recordsForListBeforeGroupFilter(): PublisherRecord[] {
    const source = this.hasSearched ? this.recordsForSelectedYearSorted : this.yearRecordsSorted;
    if (this.selectedPrivilege === 'all') {
      return source;
    }
    if (this.selectedPrivilege === 'elder') {
      return source.filter((r) => r.elder);
    }
    if (this.selectedPrivilege === 'regular-pioneer') {
      return source.filter((r) => r.regular_pioneer);
    }
    if (this.selectedPrivilege === 'auxiliary-pioneer') {
      return source.filter((r) => r.months?.some((m) => m.auxiliaryPioneer));
    }
    if (this.selectedPrivilege === 'ministerial-servant') {
      return source.filter((r) => r.ministerial_servant);
    }
    if (this.selectedPrivilege === 'unbaptized-publisher') {
      return source.filter((r) => r.unbaptized_publisher);
    }
    if (this.selectedPrivilege === 'inactive') {
      return source.filter((r) => !!r.inactive);
    }
    return source;
  }

  protected get listTitle(): string {
    if (this.selectedPrivilege === 'all') return 'Publishers in the Congregation';
    if (this.selectedPrivilege === 'elder') return 'Elders in the Congregation';
    if (this.selectedPrivilege === 'regular-pioneer') {
      return 'Regular Pioneers in the Congregation';
    }
    if (this.selectedPrivilege === 'auxiliary-pioneer') {
      return 'Auxiliary Pioneers in the Congregation';
    }
    if (this.selectedPrivilege === 'ministerial-servant') {
      return 'Ministerial Servants in the Congregation';
    }
    if (this.selectedPrivilege === 'unbaptized-publisher') {
      return 'Unbaptized Publishers in the Congregation';
    }
    if (this.selectedPrivilege === 'inactive') {
      return 'Inactive Publishers in the Congregation';
    }
    return 'Search Records';
  }

  protected get listSubtitle(): string {
    if (this.selectedPrivilege === 'all') {
      return 'View all publishers for the selected service year.';
    }
    if (this.selectedPrivilege === 'elder') {
      return 'View all publishers serving as elders for the selected service year.';
    }
    if (this.selectedPrivilege === 'regular-pioneer') {
      return 'View all publishers serving as regular pioneers for the selected service year.';
    }
    if (this.selectedPrivilege === 'auxiliary-pioneer') {
      return 'View all publishers serving as auxiliary pioneers for the selected service year.';
    }
    if (this.selectedPrivilege === 'ministerial-servant') {
      return 'View all publishers serving as ministerial servants for the selected service year.';
    }
    if (this.selectedPrivilege === 'unbaptized-publisher') {
      return 'View all unbaptized publishers for the selected service year.';
    }
    if (this.selectedPrivilege === 'inactive') {
      return 'View all inactive publishers for the selected service year.';
    }
    return 'Find a publisher by name to view their service record.';
  }

  private parsePrivilege(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (
      text === 'all' ||
      text === 'elder' ||
      text === 'regular-pioneer' ||
      text === 'auxiliary-pioneer' ||
      text === 'ministerial-servant' ||
      text === 'unbaptized-publisher' ||
      text === 'inactive'
    ) {
      return text;
    }
    return '';
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

  /** Distinct group labels available in the current source list, sorted (No group last). */
  protected get availableGroups(): string[] {
    const source = this.recordsForListBeforeGroupFilter;
    const seen = new Set<string>();
    for (const r of source) seen.add(displayPublisherGroupLabel(r));
    return [...seen].sort((a, b) => {
      if (a === 'No group') return 1;
      if (b === 'No group') return -1;
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
  }

  /** Source records filtered by the selected group (all groups when selectedGroup is ''). */
  protected get filteredByGroupRecords(): PublisherRecord[] {
    const source = this.recordsForListBeforeGroupFilter;
    if (!this.selectedGroup) return source;
    return source.filter((r) => displayPublisherGroupLabel(r) === this.selectedGroup);
  }

  /** Rows with a group heading inserted when the group label changes. */
  protected get publisherListItems(): { record: PublisherRecord; groupHeading: string | null }[] {
    const records = this.filteredByGroupRecords;
    return records.map((record, i) => ({
      record,
      groupHeading:
        i === 0 ||
        displayPublisherGroupLabel(records[i - 1]!) !== displayPublisherGroupLabel(record)
          ? displayPublisherGroupLabel(record)
          : null,
    }));
  }

  protected resetPagination(): void {
    this.selectedGroup = '';
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

  protected openDatePicker(input: HTMLInputElement): void {
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.click();
    }
  }

  protected getTotalHours(record: PublisherRecord): number {
    return record.months?.reduce((sum, m) => sum + (m.hours ?? 0), 0) ?? 0;
  }

  protected openPioneeringHistoryModal(record: PublisherRecord, event?: Event): void {
    event?.stopPropagation();
    this.pioneeringHistoryModalOpen = true;
    this.pioneeringHistoryLoading = true;
    this.pioneeringHistoryPublisherName = record.publisher_name;
    this.pioneeringHistoryRecords = [];
    this.pioneeringHistoryProfile = emptyPublisherPioneerProfile(record.publisher_name);
    this.pioneeringHistoryError = null;
    this.cdr.detectChanges();

    void (async () => {
      try {
        const [rows, prof] = await Promise.all([
          this.supabase.getPublisherRecordsByPublisherNameExact(record.publisher_name),
          this.supabase.getPioneerProfileByPublisherName(record.publisher_name),
        ]);
        this.pioneeringHistoryRecords = rows;
        this.pioneeringHistoryProfile =
          prof ?? emptyPublisherPioneerProfile(record.publisher_name);
      } catch (err) {
        this.pioneeringHistoryError =
          err instanceof Error ? err.message : 'Could not load pioneering history.';
      } finally {
        this.pioneeringHistoryLoading = false;
        this.cdr.markForCheck();
      }
    })();
  }

  protected closePioneeringHistoryModal(): void {
    this.pioneeringHistoryModalOpen = false;
    this.pioneeringHistoryLoading = false;
    this.pioneeringHistoryPublisherName = '';
    this.pioneeringHistoryRecords = [];
    this.pioneeringHistoryProfile = emptyPublisherPioneerProfile('');
    this.pioneeringHistoryError = null;
    this.cdr.detectChanges();
  }

  protected serviceYearRangeLabel(yearStart: number): string {
    return `${yearStart}\u2013${yearStart + 1}`;
  }

  protected countAuxiliaryPioneerMonths(record: PublisherRecord): number {
    return record.months?.filter((m) => m.auxiliaryPioneer).length ?? 0;
  }

  /** Short month labels for months marked auxiliary pioneer (e.g. "Sep, Jan"). */
  protected auxiliaryPioneerMonthsSummary(record: PublisherRecord): string {
    const abbrev: Record<string, string> = {
      September: 'Sep',
      October: 'Oct',
      November: 'Nov',
      December: 'Dec',
      January: 'Jan',
      February: 'Feb',
      March: 'Mar',
      April: 'Apr',
      May: 'May',
      June: 'Jun',
      July: 'Jul',
      August: 'Aug',
    };
    const labels =
      record.months
        ?.filter((m) => m.auxiliaryPioneer)
        .map((m) => abbrev[m.month] ?? m.month.slice(0, 3)) ?? [];
    return labels.length ? labels.join(', ') : '—';
  }

  /**
   * Chart: X = twelve service-year months (Sep–Aug), Y = reported hours; one line per service year.
   */
  protected pioneeringHistoryMonthAxisChart(): {
    viewBoxWidth: number;
    viewBoxHeight: number;
    plotLeft: number;
    plotRight: number;
    plotTop: number;
    plotBottom: number;
    maxHours: number;
    xMonths: { x: number; label: string }[];
    yTicks: { y: number; label: string }[];
    series: {
      yearLabel: string;
      stroke: string;
      polylinePoints: string;
      spots: { cx: number; cy: number; tip: string }[];
    }[];
  } | null {
    const rows = [...this.pioneeringHistoryRecords].sort(
      (a, b) => a.service_year_start - b.service_year_start
    );
    if (rows.length === 0) return null;

    const monthOrder = SearchRecordsComponent.SERVICE_YEAR_MONTH_ORDER;
    const xLabels = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

    let maxH = 1;
    for (const r of rows) {
      for (const month of monthOrder) {
        const m = r.months?.find((x) => x.month === month);
        const raw = m?.hours;
        const hrs = raw == null ? 0 : Number(raw);
        const h = Number.isFinite(hrs) ? hrs : 0;
        if (h > maxH) maxH = h;
      }
    }

    const vbW = 480;
    const vbH = 210;
    const plotL = 52;
    const plotR = vbW - 16;
    const plotT = 20;
    const plotB = vbH - 40;

    const xMonths = xLabels.map((label, i) => ({
      x: plotL + (i / 11) * (plotR - plotL),
      label,
    }));

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
      const v = maxH * frac;
      const y = plotB - frac * (plotB - plotT);
      return { y, label: String(Math.round(v)) };
    });

    const yForHours = (hrs: number): number =>
      plotB - (hrs / maxH) * (plotB - plotT);

    const strokes = [
      '#0d9488',
      '#4f46e5',
      '#d97706',
      '#dc2626',
      '#7c3aed',
      '#15803d',
      '#0369a1',
      '#be185d',
      '#57534e',
      '#ea580c',
    ];

    const series = rows.map((r, si) => {
      const spots = monthOrder.map((month, i) => {
        const m = r.months?.find((x) => x.month === month);
        const raw = m?.hours;
        const hrs = raw == null ? 0 : Number(raw);
        const h = Number.isFinite(hrs) ? hrs : 0;
        const cx = plotL + (i / 11) * (plotR - plotL);
        const cy = yForHours(h);
        const yr = this.serviceYearRangeLabel(r.service_year_start);
        const tip = `${yr} · ${month}: ${h} h`;
        return { cx, cy, tip };
      });
      const polylinePoints = spots.map((p) => `${p.cx},${p.cy}`).join(' ');
      return {
        yearLabel: this.serviceYearRangeLabel(r.service_year_start),
        stroke: strokes[si % strokes.length]!,
        polylinePoints,
        spots,
      };
    });

    return {
      viewBoxWidth: vbW,
      viewBoxHeight: vbH,
      plotLeft: plotL,
      plotRight: plotR,
      plotTop: plotT,
      plotBottom: plotB,
      maxHours: maxH,
      xMonths,
      yTicks,
      series,
    };
  }

  /** Pioneer profile for list / expanded row (defaults to empty dates until loaded). */
  protected pioneerProfileFor(record: PublisherRecord): PublisherPioneerProfile {
    return (
      this.pioneerDisplayByName[record.publisher_name] ??
      emptyPublisherPioneerProfile(record.publisher_name)
    );
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

  /** Modal: pioneering history across all service years (line chart + table). */
  protected pioneeringHistoryModalOpen = false;
  protected pioneeringHistoryLoading = false;
  protected pioneeringHistoryPublisherName = '';
  protected pioneeringHistoryRecords: PublisherRecord[] = [];
  protected pioneeringHistoryProfile: PublisherPioneerProfile = emptyPublisherPioneerProfile('');
  protected pioneeringHistoryError: string | null = null;

  /** Modal: edit monthly service report only (profile fields stay read-only in the modal). */
  protected reportModalRecord: PublisherRecord | null = null;
  protected reportModalPioneerProfile: PublisherPioneerProfile = emptyPublisherPioneerProfile('');
  protected reportModalAuxiliaryPeriods: { approvedOn: string; endedOn: string }[] = [];
  protected reportModalRegularPeriods: { approvedOn: string; stoppedOn: string }[] = [];
  protected reportModalPendingPioneerRemoval: { type: 'auxiliary' | 'regular'; index: number } | null =
    null;
  protected reportModalMonths: PublisherMonthlyRecord[] = [];
  protected reportModalInactive = false;
  protected reportModalSaving = false;

  protected openReportModal(record: PublisherRecord, event?: Event): void {
    event?.stopPropagation();
    this.reportModalRecord = record;
    this.reportModalInactive = !!record.inactive;
    this.reportModalPioneerProfile = this.pioneerProfileFor(record);
    this.syncReportModalPioneerEditors();
    this.reportModalMonths = this.cloneMonthsForModal(record);
    this.cdr.detectChanges();
    void this.supabase.getPioneerProfileByPublisherName(record.publisher_name).then((fresh) => {
      if (!this.reportModalRecord || this.reportModalRecord.publisher_name !== record.publisher_name) {
        return;
      }
      this.reportModalPioneerProfile = fresh ?? emptyPublisherPioneerProfile(record.publisher_name);
      this.syncReportModalPioneerEditors();
      this.cdr.markForCheck();
    });
  }

  protected closeReportModal(): void {
    this.reportModalRecord = null;
    this.reportModalPioneerProfile = emptyPublisherPioneerProfile('');
    this.reportModalAuxiliaryPeriods = [];
    this.reportModalRegularPeriods = [];
    this.reportModalPendingPioneerRemoval = null;
    this.reportModalMonths = [];
    this.reportModalInactive = false;
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
        inactive: this.reportModalInactive,
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
      await this.supabase.upsertPublisherPioneerProfile(this.buildReportModalPioneerProfilePayload());
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

  protected addReportModalAuxiliaryPeriodRow(): void {
    this.reportModalAuxiliaryPeriods = [
      ...this.reportModalAuxiliaryPeriods,
      { approvedOn: '', endedOn: '' },
    ];
    this.cdr.markForCheck();
  }

  protected removeReportModalAuxiliaryPeriodRow(index: number): void {
    this.reportModalPendingPioneerRemoval = { type: 'auxiliary', index };
    this.cdr.markForCheck();
  }

  protected addReportModalRegularPeriodRow(): void {
    this.reportModalRegularPeriods = [
      ...this.reportModalRegularPeriods,
      { approvedOn: '', stoppedOn: '' },
    ];
    this.cdr.markForCheck();
  }

  protected removeReportModalRegularPeriodRow(index: number): void {
    this.reportModalPendingPioneerRemoval = { type: 'regular', index };
    this.cdr.markForCheck();
  }

  protected cancelReportModalPioneerPeriodRemoval(): void {
    this.reportModalPendingPioneerRemoval = null;
    this.cdr.markForCheck();
  }

  protected confirmReportModalPioneerPeriodRemoval(): void {
    const pending = this.reportModalPendingPioneerRemoval;
    if (!pending) return;

    if (pending.type === 'auxiliary') {
      this.reportModalAuxiliaryPeriods = this.reportModalAuxiliaryPeriods.filter(
        (_, i) => i !== pending.index
      );
      if (this.reportModalAuxiliaryPeriods.length === 0) {
        this.reportModalAuxiliaryPeriods = [{ approvedOn: '', endedOn: '' }];
      }
    } else {
      this.reportModalRegularPeriods = this.reportModalRegularPeriods.filter(
        (_, i) => i !== pending.index
      );
      if (this.reportModalRegularPeriods.length === 0) {
        this.reportModalRegularPeriods = [{ approvedOn: '', stoppedOn: '' }];
      }
    }

    this.reportModalPendingPioneerRemoval = null;
    this.cdr.markForCheck();
  }

  private syncReportModalPioneerEditors(): void {
    const toInputDate = (v: string | null | undefined): string => {
      if (v == null || v === '') return '';
      const t = String(v).trim();
      return t.length >= 10 ? t.slice(0, 10) : t;
    };
    const aux = this.reportModalPioneerProfile.auxiliary_pioneer_periods ?? [];
    this.reportModalAuxiliaryPeriods =
      aux.length > 0
        ? aux.map((p) => ({
            approvedOn: toInputDate(p.approved_on),
            endedOn: toInputDate(p.ended_on),
          }))
        : [{ approvedOn: '', endedOn: '' }];
    const reg = this.reportModalPioneerProfile.regular_pioneer_periods ?? [];
    this.reportModalRegularPeriods =
      reg.length > 0
        ? reg.map((p) => ({
            approvedOn: toInputDate(p.approved_on),
            stoppedOn: toInputDate(p.stopped_on),
          }))
        : [{ approvedOn: '', stoppedOn: '' }];
  }

  private buildReportModalPioneerProfilePayload(): PublisherPioneerProfile {
    const name = this.reportModalRecord?.publisher_name?.trim() ?? '';
    return {
      publisher_name: name,
      auxiliary_pioneer_periods: this.reportModalAuxiliaryPeriods
        .map((p) => ({
          approved_on: p.approvedOn.trim() || null,
          ended_on: p.endedOn.trim() || null,
        }))
        .filter((p) => p.approved_on != null || p.ended_on != null),
      regular_pioneer_periods: this.reportModalRegularPeriods
        .map((p) => ({
          approved_on: p.approvedOn.trim() || null,
          stopped_on: p.stoppedOn.trim() || null,
        }))
        .filter((p) => p.approved_on != null || p.stopped_on != null),
    };
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
      await this.refreshPioneerProfileMap();
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
      await this.refreshPioneerProfileMap();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to load publishers.');
    } finally {
      this.yearLoading = false;
      this.cdr.detectChanges();
    }
  }

  /** Names on the current list (full year when not searching; in-year matches when searching). */
  private listRecordsForPioneerHydration(): PublisherRecord[] {
    return this.hasSearched ? this.recordsForSelectedYearSorted : this.yearRecordsSorted;
  }

  private async refreshPioneerProfileMap(): Promise<void> {
    try {
      const list = this.listRecordsForPioneerHydration();
      const names = [...new Set(list.map((r) => r.publisher_name))];
      if (names.length === 0) {
        this.pioneerDisplayByName = {};
        this.cdr.markForCheck();
        return;
      }
      const map = await this.supabase.getPioneerProfilesForPublisherNames(names);
      const next: Record<string, PublisherPioneerProfile> = {};
      for (const n of names) {
        next[n] = map.get(n) ?? emptyPublisherPioneerProfile(n);
      }
      this.pioneerDisplayByName = next;
      this.cdr.markForCheck();
    } catch {
      /* Pioneer map is optional; list still works if this fails. */
    }
  }
}

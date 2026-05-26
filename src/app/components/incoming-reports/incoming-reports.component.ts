import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  GroupedReports,
  IncomingReportsService,
  SubmittedReport,
} from '../../services/incoming-reports.service';
import { ReportPrefillService } from '../../services/report-prefill.service';
import { PublisherRecord, SupabaseService } from '../../services/supabase.service';
import { ThemeService } from '../../services/theme.service';

export type ReportStatus = 'applied' | 'pending' | 'not-found';

@Component({
  selector: 'app-incoming-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './incoming-reports.component.html',
  styleUrl: './incoming-reports.component.css',
})
export class IncomingReportsComponent implements OnInit {
  protected readonly groupedReports = signal<GroupedReports[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected selectedMonth: string;
  protected readonly availableMonths: { value: string; label: string }[];

  protected yearRecords: PublisherRecord[] = [];

  // Conflict modal state
  protected pendingApply: {
    report: SubmittedReport;
    matchedRecord: PublisherRecord | null;
    resolvedName: string;
    existingMonth: { hours: number | null; bibleStudies: number | null; sharedInMinistry: boolean } | null;
  } | null = null;

  // Disambiguation modal state
  protected disambiguationReport: SubmittedReport | null = null;
  protected disambiguationSearch = '';

  private statusMap = new Map<string, ReportStatus>();

  private static readonly MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  constructor(
    private readonly service: IncomingReportsService,
    private readonly supabase: SupabaseService,
    private readonly prefill: ReportPrefillService,
    private readonly router: Router,
    protected readonly theme: ThemeService
  ) {
    const now = new Date();
    this.selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.availableMonths = this.buildMonthOptions();
  }

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadReports(), this.loadYearRecords()]);
    this.computeStatusMap();
  }

  async onMonthChange(): Promise<void> {
    await this.loadReports();
    this.computeStatusMap();
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  protected statusOf(reportId: string): ReportStatus {
    return this.statusMap.get(reportId) ?? 'pending';
  }

  private computeStatusMap(): void {
    this.statusMap.clear();
    for (const group of this.groupedReports()) {
      for (const report of group.reports) {
        this.statusMap.set(report.id, this.resolveStatus(report));
      }
    }
    const pending = [...this.statusMap.values()].filter((s) => s !== 'applied').length;
    this.service.setPendingCount(pending);
  }

  private resolveStatus(report: SubmittedReport): ReportStatus {
    const name = this.publisherName(report);
    const match = this.findPublisher(name);
    if (!match) return 'not-found';

    const monthRow = match.months.find((m) => m.month === this.monthNameFromDate(report.report_date));
    if (!monthRow) return 'pending';

    const hasData =
      monthRow.sharedInMinistry || monthRow.hours !== null || monthRow.bibleStudies !== null;
    return hasData ? 'applied' : 'pending';
  }

  // ── Apply flow ───────────────────────────────────────────────────────────────

  protected onApplyReport(report: SubmittedReport, overrideName?: string): void {
    const name = overrideName ?? this.publisherName(report);
    const match = this.findPublisher(name);

    if (!match && !overrideName) {
      this.disambiguationReport = report;
      this.disambiguationSearch = '';
      return;
    }

    const month = this.monthNameFromDate(report.report_date);
    const monthRow = match?.months.find((m) => m.month === month);
    const hasExisting =
      monthRow &&
      (monthRow.sharedInMinistry || monthRow.hours !== null || monthRow.bibleStudies !== null);

    if (hasExisting && monthRow) {
      this.pendingApply = {
        report,
        matchedRecord: match ?? null,
        resolvedName: match?.publisher_name ?? name,
        existingMonth: {
          hours: monthRow.hours ?? null,
          bibleStudies: monthRow.bibleStudies ?? null,
          sharedInMinistry: monthRow.sharedInMinistry,
        },
      };
      return;
    }

    this.doApply(report, match?.publisher_name ?? name);
  }

  protected onConfirmOverwrite(): void {
    if (!this.pendingApply) return;
    const { report, resolvedName } = this.pendingApply;
    this.pendingApply = null;
    this.doApply(report, resolvedName);
  }

  protected onCancelApply(): void {
    this.pendingApply = null;
  }

  // ── Disambiguation ───────────────────────────────────────────────────────────

  protected get filteredDisambiguationRecords(): PublisherRecord[] {
    const q = this.disambiguationSearch.trim().toLowerCase();
    if (!q) return this.yearRecords;
    return this.yearRecords.filter((r) =>
      r.publisher_name.toLowerCase().includes(q)
    );
  }

  protected onSelectPublisher(record: PublisherRecord): void {
    const report = this.disambiguationReport!;
    this.disambiguationReport = null;
    this.disambiguationSearch = '';
    this.onApplyReport(report, record.publisher_name);
  }

  protected onCreateAsNew(): void {
    const report = this.disambiguationReport!;
    this.disambiguationReport = null;
    this.disambiguationSearch = '';
    this.doApply(report, this.publisherName(report));
  }

  protected onCancelDisambiguation(): void {
    this.disambiguationReport = null;
    this.disambiguationSearch = '';
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  protected get selectedMonthLabel(): string {
    return this.availableMonths.find((m) => m.value === this.selectedMonth)?.label ?? this.selectedMonth;
  }

  protected publisherName(report: SubmittedReport): string {
    const a = report.author;
    if (!a) return 'Unknown';
    return [a.last_name, a.first_name].filter(Boolean).join(', ') || 'Unknown';
  }

  protected formatDate(dateStr: string | null): string {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected monthNameFromDate(dateStr: string | null): string {
    if (!dateStr) return '';
    const idx = parseInt(dateStr.split('-')[1], 10) - 1;
    return IncomingReportsComponent.MONTH_NAMES[idx] ?? '';
  }

  private findPublisher(name: string): PublisherRecord | undefined {
    return this.yearRecords.find(
      (r) => r.publisher_name.toLowerCase() === name.toLowerCase()
    );
  }

  private doApply(report: SubmittedReport, publisherName: string): void {
    this.prefill.set({
      publisherName,
      month: this.monthNameFromDate(report.report_date),
      hours: report.hours,
      bibleStudies: report.number_of_bs,
      sharedInMinistry: report.is_shared_ministry,
    });
    void this.router.navigate(['/publishers-record/add-records']);
  }

  // ── Data loading ─────────────────────────────────────────────────────────────

  private async loadReports(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.service.fetchGroupedReports(this.selectedMonth);
      this.groupedReports.set(result);
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load reports.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadYearRecords(): Promise<void> {
    try {
      this.yearRecords = await this.supabase.getPublisherRecordsByServiceYear(
        this.supabase.serviceYear()
      );
    } catch {
      this.yearRecords = [];
    }
  }

  private buildMonthOptions(): { value: string; label: string }[] {
    const options: { value: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      options.push({ value, label });
    }
    return options;
  }
}

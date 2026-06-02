import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export interface SubmittedReport {
  id: string;
  report_date: string | null;
  hours: number | null;
  number_of_bs: number | null;
  is_shared_ministry: boolean;
  created_at: string;
  group_id: string | null;
  group_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface GroupedReports {
  groupId: string;
  groupName: string;
  reports: SubmittedReport[];
  totalHours: number;
  totalBs: number;
}

@Injectable({ providedIn: 'root' })
export class IncomingReportsService {
  private readonly client: SupabaseClient;
  private channel: RealtimeChannel | null = null;

  private static readonly PENDING_COUNT_KEY = 'ir_pending_count';

  private static readStoredCount(): number | null {
    try {
      const v = localStorage.getItem(IncomingReportsService.PENDING_COUNT_KEY);
      return v !== null ? parseInt(v, 10) : null;
    } catch {
      return null;
    }
  }

  private readonly _pendingCount = signal<number | null>(
    IncomingReportsService.readStoredCount()
  );
  readonly pendingCount = this._pendingCount.asReadonly();

  private readonly _changes$ = new Subject<{ eventType: string; reportDate: string | null }>();
  readonly changes$ = this._changes$.asObservable();

  setPendingCount(count: number): void {
    this._pendingCount.set(count);
    try {
      localStorage.setItem(IncomingReportsService.PENDING_COUNT_KEY, String(count));
    } catch {}
  }

  constructor() {
    this.client = createClient(
      environment.serviceReportsSupabaseUrl,
      environment.serviceReportsSupabaseAnonKey
    );
    this.initRealtime();
  }

  async initializeCount(): Promise<void> {
    if (this._pendingCount() !== null) return;
    try {
      const latestMonth = await this.fetchLatestReportMonth();
      if (!latestMonth) return;
      const groups = await this.fetchGroupedReports(latestMonth);
      const total = groups.reduce((sum, g) => sum + g.reports.length, 0);
      if (this._pendingCount() === null) {
        this.setPendingCount(total);
      }
    } catch {
      // silent — badge stays hidden if fetch fails
    }
  }

  private initRealtime(): void {
    this.channel = this.client
      .channel('submitted_reports_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'submitted_reports' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { report_date?: string } | undefined;
          if (payload.eventType === 'INSERT') {
            this.setPendingCount((this._pendingCount() ?? 0) + 1);
          }
          this._changes$.next({
            eventType: payload.eventType,
            reportDate: row?.report_date ?? null,
          });
        }
      )
      .subscribe();
  }

  async fetchLatestReportMonth(): Promise<string | null> {
    const { data, error } = await this.client
      .from('submitted_reports')
      .select('report_date')
      .not('report_date', 'is', null)
      .order('report_date', { ascending: false })
      .limit(1)
      .single();
    if (error || !data) return null;
    return (data.report_date as string).slice(0, 7);
  }

  async fetchGroupedReports(month: string): Promise<GroupedReports[]> {
    const [y, m] = month.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const end = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const { data, error } = await this.client.rpc(
      'get_submitted_reports_for_secretary',
      { p_start: start, p_end: end }
    );

    if (error) throw error;

    const groupMap = new Map<string, GroupedReports>();

    for (const raw of (data ?? [])) {
      const report = raw as unknown as SubmittedReport;
      const groupId = report.group_id ?? 'ungrouped';
      const groupName = report.group_name ?? 'No Group';

      if (!groupMap.has(groupId)) {
        groupMap.set(groupId, { groupId, groupName, reports: [], totalHours: 0, totalBs: 0 });
      }

      const group = groupMap.get(groupId)!;
      group.reports.push(report);
      group.totalHours += report.hours ?? 0;
      group.totalBs += report.number_of_bs ?? 0;
    }

    return Array.from(groupMap.values()).sort((a, b) =>
      a.groupName.localeCompare(b.groupName)
    );
  }
}

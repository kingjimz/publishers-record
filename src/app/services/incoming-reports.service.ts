import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export interface SubmittedReport {
  id: string;
  title: string;
  report_date: string | null;
  hours: number | null;
  number_of_bs: number | null;
  is_shared_ministry: boolean;
  created_at: string;
  group: { id: string; name: string } | null;
  author: { first_name: string | null; last_name: string | null } | null;
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

  private readonly _pendingCount = signal<number | null>(null);
  readonly pendingCount = this._pendingCount.asReadonly();

  setPendingCount(count: number): void {
    this._pendingCount.set(count);
  }

  constructor() {
    this.client = createClient(
      environment.serviceReportsSupabaseUrl,
      environment.serviceReportsSupabaseAnonKey
    );
  }

  async fetchGroupedReports(month: string): Promise<GroupedReports[]> {
    const [y, m] = month.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const end = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const { data, error } = await this.client
      .from('submitted_reports')
      .select('id,title,report_date,hours,number_of_bs,is_shared_ministry,created_at,group:groups(id,name),author:profiles!user_id(first_name,last_name)')
      .gte('report_date', start)
      .lt('report_date', end)
      .order('report_date', { ascending: false });

    if (error) throw error;

    const groupMap = new Map<string, GroupedReports>();

    for (const raw of (data ?? [])) {
      const report = raw as unknown as SubmittedReport;
      const groupId = report.group?.id ?? 'ungrouped';
      const groupName = report.group?.name ?? 'No Group';

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

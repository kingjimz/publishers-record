import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AttendanceMeetingRecord,
  SupabaseService,
} from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';

type AttendanceMonthSummary = {
  month: string;
  midweekEntries: number[];
  weekendEntries: number[];
};
type MeetingType = 'midweek' | 'weekend';

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './attendance.component.html',
  styleUrl: './attendance.component.css',
})
export class AttendanceComponent implements OnInit {
  protected meetings: AttendanceMeetingRecord[] = [];
  protected monthSummaries: AttendanceMonthSummary[] = this.createDefaultSummaries();

  protected meetingDate = '';
  protected meetingType: MeetingType = 'midweek';
  protected attendanceCount: number | null = null;
  protected selectedMonth = this.currentMonthName();
  protected selectedYear = this.currentYear();
  protected readonly monthOptions = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  protected loading = false;
  protected submitting = false;
  protected editingId: string | null = null;
  protected pendingDelete: AttendanceMeetingRecord | null = null;
  protected deletingId: string | null = null;

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadAttendanceForYear(this.supabase.serviceYear());
  }

  protected async onSaveMeetings(): Promise<void> {
    if (this.submitting || this.loading) return;
    if (!this.meetingDate) {
      this.toast.showError('Please select a meeting date.');
      return;
    }
    if (this.attendanceCount == null || this.attendanceCount < 0) {
      this.toast.showError('Please enter a valid attendance.');
      return;
    }

    const serviceYearStart = this.supabase.serviceYear();
    const meetingYear = this.serviceYearForDate(this.meetingDate);
    if (meetingYear !== serviceYearStart) {
      this.toast.showError(`Meeting date must be within service year ${serviceYearStart}-${serviceYearStart + 1}.`);
      return;
    }

    this.submitting = true;
    this.toast.dismiss();
    this.cdr.detectChanges();

    try {
      const targetMonthName = this.monthNameFromDate(this.meetingDate);
      const targetYear = new Date(`${this.meetingDate}T00:00:00`).getFullYear();
      const wasEditing = this.editingId !== null;
      if (this.editingId) {
        const updated = await this.supabase.updateAttendanceMeeting(this.editingId, serviceYearStart, {
          meeting_date: this.meetingDate,
          meeting_type: this.meetingType,
          attendance: Math.round(this.attendanceCount),
        });
        this.meetings = this.meetings.map((m) => (m.id === updated.id ? updated : m));
      } else {
        const created = await this.supabase.insertAttendanceMeeting({
          service_year_start: serviceYearStart,
          meeting_date: this.meetingDate,
          meeting_type: this.meetingType,
          attendance: Math.round(this.attendanceCount),
        });
        this.meetings = [...this.meetings, created];
      }

      this.resetForm();
      this.meetings = this.sortMeetingsByDate(this.meetings);
      this.monthSummaries = this.buildMonthSummaries(this.meetings);
      this.selectedMonth = targetMonthName;
      this.selectedYear = targetYear;
      this.toast.showSuccess(wasEditing ? 'Meeting attendance updated.' : 'Meeting attendance saved.');
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to save meeting attendance.');
    } finally {
      this.submitting = false;
      this.cdr.detectChanges();
    }
  }

  protected onEditMeeting(row: AttendanceMeetingRecord): void {
    this.editingId = row.id;
    this.pendingDelete = null;
    this.meetingDate = row.meeting_date;
    this.meetingType = row.meeting_type;
    this.attendanceCount = row.attendance;
    this.cdr.detectChanges();
  }

  protected onCancelEdit(): void {
    this.resetForm();
    this.cdr.detectChanges();
  }

  protected onMeetingDateChanged(dateValue: string): void {
    if (!dateValue) return;
    const date = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(date.getTime())) return;
    const day = date.getDay();
    this.meetingType = day === 0 || day === 6 ? 'weekend' : 'midweek';
    this.cdr.detectChanges();
  }

  protected onRequestDelete(row: AttendanceMeetingRecord): void {
    if (this.deletingId || this.submitting) return;
    this.pendingDelete = row;
    this.cdr.detectChanges();
  }

  protected onCancelDelete(): void {
    this.pendingDelete = null;
    this.cdr.detectChanges();
  }

  protected async onDeleteMeeting(): Promise<void> {
    if (!this.pendingDelete) return;
    const row = this.pendingDelete;
    if (this.deletingId || this.loading) return;
    this.deletingId = row.id;
    this.pendingDelete = null;
    this.toast.dismiss();
    this.cdr.detectChanges();

    try {
      await this.supabase.deleteAttendanceMeeting(row.id, this.supabase.serviceYear());
      if (this.editingId === row.id) {
        this.resetForm();
      }
      this.meetings = this.meetings.filter((m) => m.id !== row.id);
      this.monthSummaries = this.buildMonthSummaries(this.meetings);
      this.toast.showSuccess('Meeting attendance removed.');
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to remove attendance.');
    } finally {
      this.deletingId = null;
      this.cdr.detectChanges();
    }
  }

  protected monthlyMidweekAverage(summary: AttendanceMonthSummary): number {
    return this.calculateAverage(summary.midweekEntries);
  }

  protected monthlyWeekendAverage(summary: AttendanceMonthSummary): number {
    return this.calculateAverage(summary.weekendEntries);
  }

  protected hasMidweekData(summary: AttendanceMonthSummary): boolean {
    return summary.midweekEntries.length > 0;
  }

  protected hasWeekendData(summary: AttendanceMonthSummary): boolean {
    return summary.weekendEntries.length > 0;
  }

  protected get totalMeetings(): number {
    return this.filteredMeetings.length;
  }

  protected get totalMidweekMeetings(): number {
    return this.filteredMeetings.filter((m) => m.meeting_type === 'midweek').length;
  }

  protected get totalWeekendMeetings(): number {
    return this.filteredMeetings.filter((m) => m.meeting_type === 'weekend').length;
  }

  protected get averageMidweekAttendance(): number {
    const values = this.filteredMeetings
      .filter((m) => m.meeting_type === 'midweek')
      .map((m) => m.attendance);
    return this.calculateAverage(values);
  }

  protected get averageWeekendAttendance(): number {
    const values = this.filteredMeetings
      .filter((m) => m.meeting_type === 'weekend')
      .map((m) => m.attendance);
    return this.calculateAverage(values);
  }

  protected get filteredMeetings(): AttendanceMeetingRecord[] {
    return this.meetings.filter((m) => {
      const d = new Date(`${m.meeting_date}T00:00:00`);
      if (Number.isNaN(d.getTime())) return false;
      const month = d.toLocaleString('en-US', { month: 'long' });
      const year = d.getFullYear();
      return month === this.selectedMonth && year === this.selectedYear;
    });
  }

  protected get yearOptions(): number[] {
    const serviceYearStart = this.supabase.serviceYear();
    return [serviceYearStart, serviceYearStart + 1];
  }

  protected formatMeetingDate(isoDate: string): string {
    const d = new Date(`${isoDate}T00:00:00`);
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  }

  private calculateAverage(values: number[]): number {
    if (!values.length) return 0;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
  }

  private createDefaultSummaries(): AttendanceMonthSummary[] {
    return [
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
    ].map((month) => ({
      month,
      midweekEntries: [],
      weekendEntries: [],
    }));
  }

  private async loadAttendanceForYear(serviceYearStart: number): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();
    try {
      this.meetings = await this.supabase.getAttendanceMeetingsByServiceYear(serviceYearStart);
      this.monthSummaries = this.buildMonthSummaries(this.meetings);
    } catch (err) {
      this.meetings = [];
      this.monthSummaries = this.createDefaultSummaries();
      this.toast.showError(err instanceof Error ? err.message : 'Failed to load attendance.');
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  private buildMonthSummaries(rows: AttendanceMeetingRecord[]): AttendanceMonthSummary[] {
    const byMonth = new Map<string, AttendanceMonthSummary>();
    for (const month of this.createDefaultSummaries()) {
      byMonth.set(month.month, {
        month: month.month,
        midweekEntries: [],
        weekendEntries: [],
      });
    }

    for (const row of rows) {
      const month = this.monthNameFromDate(row.meeting_date);
      const target = byMonth.get(month);
      if (!target) continue;
      if (row.meeting_type === 'midweek') {
        target.midweekEntries.push(row.attendance);
      } else {
        target.weekendEntries.push(row.attendance);
      }
    }

    return this.createDefaultSummaries().map((month) => {
      const existing = byMonth.get(month.month)!;
      return {
        month: month.month,
        midweekEntries: existing.midweekEntries,
        weekendEntries: existing.weekendEntries,
      };
    });
  }

  private monthNameFromDate(isoDate: string): string {
    const d = new Date(`${isoDate}T00:00:00`);
    return d.toLocaleString('en-US', { month: 'long' });
  }

  private currentMonthName(): string {
    return new Date().toLocaleString('en-US', { month: 'long' });
  }

  private currentYear(): number {
    return new Date().getFullYear();
  }

  private serviceYearForDate(isoDate: string): number {
    const d = new Date(`${isoDate}T00:00:00`);
    const year = d.getFullYear();
    const monthIndex = d.getMonth();
    return monthIndex >= 8 ? year : year - 1;
  }

  private resetForm(): void {
    this.editingId = null;
    this.meetingDate = '';
    this.meetingType = 'midweek';
    this.attendanceCount = null;
  }

  private sortMeetingsByDate(rows: AttendanceMeetingRecord[]): AttendanceMeetingRecord[] {
    return [...rows].sort((a, b) => a.meeting_date.localeCompare(b.meeting_date));
  }
}

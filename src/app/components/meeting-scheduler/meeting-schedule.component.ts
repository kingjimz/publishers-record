import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';

import {
  IMPORT_LANGUAGES,
  ImportedProgram,
  ImportLanguage,
  ImportUsage,
  MeetingPart,
  MeetingScheduleService,
  MeetingWeek,
  PublisherTypeHistory,
  WeekendSchedule,
} from '../../services/meeting-schedule.service';
import { PublisherRecord, SupabaseService } from '../../services/supabase.service';
import { TalkOutline, TalkOutlineService } from '../../services/talk-outline.service';
import { ToastService } from '../../services/toast.service';
import { downloadHtmlAsPdf } from '../../utils/html-to-pdf';
import { downloadHtmlAsPngPages, renderHtmlToPngDataUrls } from '../../utils/html-to-png';
import {
  buildAssignmentSlipsDocument,
  buildImagePrintDocument,
  buildMonthScheduleDocument,
  collectAssignmentSlips,
} from '../../utils/meeting-schedule-print';
import { buildWeekendRangeDocument, weekendRangeLabel } from '../../utils/weekend-range-print';
import {
  activeWeekendSchedule,
  computeScheduleEnd,
  mondayOf,
  nextSundayOnOrAfter,
  speakingPoolCount,
  sundayOf,
} from '../../utils/weekend-range-model';
import { displayPublisherName } from '../../utils/publisher-name';
import { addDaysIso, buildDefaultWeekParts, createEmptyWeek } from './meeting-defaults';

export type SchedulerMode = 'midweek' | 'weekend';
import { MeetingWeekEditorComponent } from './meeting-week-editor.component';
import { MeetingWeekWorkbookComponent } from './meeting-week-workbook.component';
import { WeekendRangeSheetComponent } from './weekend-range-sheet.component';

const CONGREGATION_NAME = 'Bolaoen Congregation';
const IMPORT_LANGUAGE_STORAGE_KEY = 'meeting-import-language';
const SUMMARY_VIEW_STORAGE_KEY = 'meeting-summary-view';
const WEEKEND_VIEW_STORAGE_KEY = 'weekend-schedule-view';

/** Output kinds routed through the generation confirmation modal. */
type GenerateKind = 'print' | 'png' | 'pdf' | 'slips';

/** One row in the import progress modal. */
interface ImportProgressStep {
  label: string;
  detail: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

/**
 * What the import actually does behind the scenes, shown to the user while it
 * runs. The first steps advance on a timer; the network step completes when
 * the Edge Function call settles.
 */
const IMPORT_STEP_TEMPLATE: ReadonlyArray<Pick<ImportProgressStep, 'label' | 'detail'>> = [
  {
    label: 'Check saved copies',
    detail: 'Looking for a copy of this week already stored on this device.',
  },
  {
    label: 'Call the import function',
    detail: 'Invoking the fetch-meeting-program Edge Function on Supabase.',
  },
  {
    label: 'Read wol.jw.org',
    detail: 'Fetching the workbook week and parsing songs, Bible reading, and part titles.',
  },
  {
    label: 'Apply to this week',
    detail: 'Filling the editor while keeping publishers you already assigned.',
  },
];

@Component({
  selector: 'app-meeting-schedule',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MeetingWeekEditorComponent,
    MeetingWeekWorkbookComponent,
    WeekendRangeSheetComponent,
  ],
  templateUrl: './meeting-schedule.component.html',
  styleUrl: './meeting-schedule.component.css',
})
export class MeetingScheduleComponent implements OnInit, OnDestroy {
  /** Which meeting this page edits; set from route data (midweek | weekend). */
  protected mode: SchedulerMode = 'midweek';

  /** Selected month as `yyyy-mm`. */
  protected selectedMonth = MeetingScheduleComponent.currentMonth();

  protected weeks: MeetingWeek[] = [];
  protected publishers: PublisherRecord[] = [];
  protected history = new Map<string, string>();
  protected historyDetail = new Map<string, PublisherTypeHistory>();

  /** S-99 outline library + last-given dates (weekend mode only). */
  protected outlines: TalkOutline[] = [];
  protected outlineUsage = new Map<number, string>();

  /** Last month of the weekend export range (`yyyy-mm`); the start is the selected month.
   * Only used as a fallback when no rotation schedule exists yet. */
  protected rangeEndMonth = MeetingScheduleComponent.currentMonth();
  /** Weeks fetched for the pending weekend export, so the modal can show real counts. */
  private rangeWeeks: MeetingWeek[] = [];

  /** Weekend rotation cycles (newest first) and the one the page works on. */
  protected schedules: WeekendSchedule[] = [];
  protected activeSchedule: WeekendSchedule | null = null;

  /** Editable sheet state: draft rows (one per Sunday of the cycle) and their
   * saved baselines (JSON, parts excluded) for dirty tracking. */
  protected sheetWeeks: MeetingWeek[] = [];
  private sheetBaseline = new Map<string, string>();
  protected sheetRangeLabel = '';
  protected sheetLoading = false;
  protected sheetSaving = false;
  /** End-date change the rotation math applied (event weeks extend, restored
   * talk weeks shrink); saved with the sheet, null when in sync with the cycle. */
  protected pendingEndSunday: string | null = null;

  /** New Schedule dialog state. */
  protected newScheduleDraft: {
    start_sunday: string;
    end_sunday: string;
    range_label: string;
    poolCount: number;
    elders: number;
    ministerialServants: number;
  } | null = null;
  protected newScheduleSaving = false;
  protected newScheduleLoading = false;

  protected readonly congregationName = CONGREGATION_NAME;

  /** Lookback for rotation hints and the per-publisher history modal. */
  private static readonly HISTORY_WINDOW_MONTHS = 12;

  protected loading = false;
  protected saving = false;
  protected importing: string | null = null;
  protected deletingId: string | null = null;
  protected pendingDelete: MeetingWeek | null = null;

  /** Import progress modal state. */
  protected importModalOpen = false;
  protected importWeekLabel = '';
  protected importSteps: ImportProgressStep[] = [];
  protected importError: string | null = null;
  protected importFromCache = false;
  private importTimers: ReturnType<typeof setTimeout>[] = [];

  /** Which output is awaiting confirmation in the generate modal. */
  protected generateRequest: GenerateKind | null = null;

  /** Draft copy being edited; keyed by its `week_of`. */
  protected draft: MeetingWeek | null = null;

  /** Import usage (midweek tab only). */
  protected importUsage: ImportUsage | null = null;
  protected usageModalOpen = false;

  /** Workbook language for imports; persisted per device. */
  protected readonly importLanguages = IMPORT_LANGUAGES;
  protected importLanguage: ImportLanguage = MeetingScheduleComponent.storedImportLanguage();

  private static storedImportLanguage(): ImportLanguage {
    try {
      const stored = localStorage.getItem(IMPORT_LANGUAGE_STORAGE_KEY);
      if (IMPORT_LANGUAGES.some((l) => l.code === stored)) return stored as ImportLanguage;
    } catch {
      /* storage unavailable */
    }
    return IMPORT_LANGUAGES[0].code;
  }

  protected get importLanguageLabel(): string {
    return (
      this.importLanguages.find((l) => l.code === this.importLanguage)?.label ??
      this.importLanguage
    );
  }

  protected onImportLanguageChange(code: ImportLanguage): void {
    this.importLanguage = code;
    try {
      localStorage.setItem(IMPORT_LANGUAGE_STORAGE_KEY, code);
    } catch {
      /* storage unavailable */
    }
  }

  /** Saved-week card style: workbook sheet or the compact field summary; persisted per device. */
  protected summaryView: 'workbook' | 'form' = MeetingScheduleComponent.storedSummaryView();

  private static storedSummaryView(): 'workbook' | 'form' {
    try {
      const stored = localStorage.getItem(SUMMARY_VIEW_STORAGE_KEY);
      if (stored === 'form' || stored === 'workbook') return stored;
    } catch {
      /* storage unavailable */
    }
    return 'workbook';
  }

  protected setSummaryView(view: 'workbook' | 'form'): void {
    this.summaryView = view;
    try {
      localStorage.setItem(SUMMARY_VIEW_STORAGE_KEY, view);
    } catch {
      /* storage unavailable */
    }
  }

  /** Weekend page style: the editable rotation sheet or the month cards; persisted per device. */
  protected weekendView: 'sheet' | 'cards' = MeetingScheduleComponent.storedWeekendView();

  private static storedWeekendView(): 'sheet' | 'cards' {
    try {
      const stored = localStorage.getItem(WEEKEND_VIEW_STORAGE_KEY);
      if (stored === 'sheet' || stored === 'cards') return stored;
    } catch {
      /* storage unavailable */
    }
    return 'sheet';
  }

  /** Switching views never discards sheet drafts; they stay in memory until saved or reloaded. */
  protected setWeekendView(view: 'sheet' | 'cards'): void {
    if (view === this.weekendView) return;
    this.weekendView = view;
    try {
      localStorage.setItem(WEEKEND_VIEW_STORAGE_KEY, view);
    } catch {
      /* storage unavailable */
    }
    if (view === 'sheet' && this.activeSchedule && this.sheetWeeks.length === 0) {
      void this.loadSheet();
    }
    this.cdr.detectChanges();
  }

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly meetingSchedule: MeetingScheduleService,
    private readonly talkOutlines: TalkOutlineService,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef,
    route: ActivatedRoute
  ) {
    this.rangeEndMonth = this.shiftMonth(this.selectedMonth, 4);
    route.data.pipe(takeUntilDestroyed()).subscribe((data) => {
      const mode: SchedulerMode = data['mode'] === 'weekend' ? 'weekend' : 'midweek';
      if (mode === this.mode) return;
      this.mode = mode;
      this.draft = null;
      // route.data emits synchronously while the router is still creating this
      // component (possibly inside a change-detection pass), so only schedule a
      // pass here — a synchronous detectChanges() would nest CD and assert.
      this.cdr.markForCheck();
    });
  }

  async ngOnInit(): Promise<void> {
    await this.loadMonth();
    if (this.mode === 'midweek') void this.loadImportUsage();
  }

  ngOnDestroy(): void {
    this.clearImportTimers();
  }

  private async loadImportUsage(): Promise<void> {
    try {
      this.importUsage = await this.meetingSchedule.getImportUsage();
    } catch {
      this.importUsage = null; // usage display is best-effort, never blocks the page
    }
    this.cdr.detectChanges();
  }

  protected openUsageModal(): void {
    this.usageModalOpen = true;
    void this.loadImportUsage();
    this.cdr.detectChanges();
  }

  protected closeUsageModal(): void {
    this.usageModalOpen = false;
    this.cdr.detectChanges();
  }

  /** Escape closes the topmost open modal, unless its action is in flight. */
  @HostListener('document:keydown.escape')
  protected closeTopModal(): void {
    if (this.newScheduleDraft) {
      if (!this.newScheduleSaving) this.onCancelNewSchedule();
      return;
    }
    if (this.pendingDelete) {
      if (!this.deletingId) this.onCancelDelete();
      return;
    }
    if (this.generateRequest) {
      if (!this.generating) this.onCancelGenerate();
      return;
    }
    if (this.usageModalOpen) {
      this.closeUsageModal();
      return;
    }
    if (this.importModalOpen) {
      this.closeImportModal();
    }
  }

  protected formatLogTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  private static currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  protected get pageTitle(): string {
    return this.mode === 'midweek' ? 'Midweek Meeting Scheduler' : 'Weekend Meeting Scheduler';
  }

  protected get pageSubtitle(): string {
    return this.mode === 'midweek'
      ? 'Plan the Christian Life and Ministry program and assign each part.'
      : 'Assign the public talk, Watchtower study, and weekend meeting roles.';
  }

  protected get monthLabel(): string {
    const [year, month] = this.selectedMonth.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }

  /** Mondays whose date falls inside the selected month. */
  protected get mondays(): string[] {
    const [year, month] = this.selectedMonth.split('-').map(Number);
    const result: string[] = [];
    const date = new Date(year, month - 1, 1);
    while (date.getMonth() === month - 1) {
      if (date.getDay() === 1) {
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        result.push(`${date.getFullYear()}-${m}-${d}`);
      }
      date.setDate(date.getDate() + 1);
    }
    return result;
  }

  protected weekFor(mondayIso: string): MeetingWeek | undefined {
    return this.weeks.find((w) => w.week_of === mondayIso);
  }

  protected async onPreviousMonth(): Promise<void> {
    this.selectedMonth = this.shiftMonth(this.selectedMonth, -1);
    this.rangeEndMonth = this.shiftMonth(this.selectedMonth, 4);
    this.draft = null;
    await this.loadMonth();
  }

  protected async onNextMonth(): Promise<void> {
    this.selectedMonth = this.shiftMonth(this.selectedMonth, 1);
    this.rangeEndMonth = this.shiftMonth(this.selectedMonth, 4);
    this.draft = null;
    await this.loadMonth();
  }

  /** Choices for the export range end: the selected month through +11 months. */
  protected get rangeEndOptions(): { value: string; label: string }[] {
    return Array.from({ length: 12 }, (_, i) => {
      const value = this.shiftMonth(this.selectedMonth, i);
      const [year, month] = value.split('-').map(Number);
      return {
        value,
        label: new Date(year, month - 1, 1).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        }),
      };
    });
  }

  protected onRangeEndChange(value: string): void {
    this.rangeEndMonth = value < this.selectedMonth ? this.selectedMonth : value;
  }

  /** Range label shown in the app UI: the cycle's stored free text, else computed. */
  protected get rangeLabel(): string {
    const schedule = this.activeSchedule;
    if (schedule) return schedule.range_label?.trim() || this.scheduleLabel(schedule, 'en');
    return weekendRangeLabel(this.selectedMonth, this.rangeEndMonth, 'en');
  }

  /** Label printed on the exported sheet, in the schedule language. */
  private get exportRangeLabel(): string {
    const schedule = this.activeSchedule;
    if (schedule) {
      return schedule.range_label?.trim() || this.scheduleLabel(schedule, this.importLanguage);
    }
    return weekendRangeLabel(this.selectedMonth, this.rangeEndMonth, this.importLanguage);
  }

  private shiftMonth(month: string, delta: number): string {
    const [year, m] = month.split('-').map(Number);
    const date = new Date(year, m - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private async loadMonth(): Promise<void> {
    this.loading = true;
    this.cdr.detectChanges();

    try {
      const [year, month] = this.selectedMonth.split('-').map(Number);
      const start = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // Publisher pool follows the service year the selected month belongs to.
      const serviceYear = month - 1 >= 8 ? year : year - 1;
      const historySince = this.isoMonthsAgo(MeetingScheduleComponent.HISTORY_WINDOW_MONTHS);

      const [weeks, publishers, history] = await Promise.all([
        this.meetingSchedule.getWeeksInRange(start, end),
        this.loadPublisherPool(serviceYear),
        this.meetingSchedule.getAssignmentHistory(historySince),
      ]);

      this.weeks = weeks;
      this.publishers = publishers;
      this.history = history.lastAssigned;
      this.historyDetail = history.byPublisher;

      if (this.mode === 'weekend') {
        await this.loadOutlines();
        await this.loadWeekendSchedules();
        // Keep unsaved sheet edits when navigating months; the sheet does not
        // depend on the selected month anyway.
        if (this.weekendView === 'sheet' && this.sheetDirtyCount === 0) await this.loadSheet();
      }
    } catch (err) {
      this.weeks = [];
      this.toast.showError(err instanceof Error ? err.message : 'Failed to load the schedule.');
    } finally {
      this.loading = false;
      this.cdr.detectChanges();
    }
  }

  /** Outline library + last-given dates for the Tema picker; best-effort. */
  private async loadOutlines(): Promise<void> {
    try {
      const [outlines, usage] = await Promise.all([
        this.talkOutlines.getOutlines(),
        this.talkOutlines.getOutlineUsage(),
      ]);
      this.outlines = outlines;
      this.outlineUsage = usage;
    } catch {
      // The picker degrades to free text when the library cannot load.
      this.outlines = [];
      this.outlineUsage = new Map();
    }
  }

  // ---------- Weekend rotation schedule + editable sheet ----------

  private static todayIso(): string {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
  }

  /** Cycles are best-effort: without the table (or offline) the page degrades
   * to the legacy month-range export. */
  private async loadWeekendSchedules(): Promise<void> {
    try {
      this.schedules = await this.meetingSchedule.getWeekendSchedules();
      this.activeSchedule = activeWeekendSchedule(
        this.schedules,
        MeetingScheduleComponent.todayIso()
      );
    } catch {
      this.schedules = [];
      this.activeSchedule = null;
    }
  }

  /** Computed month-range label for a cycle, used when no free text is stored. */
  private scheduleLabel(schedule: WeekendSchedule, language: ImportLanguage = 'ilo'): string {
    return weekendRangeLabel(
      schedule.start_sunday.slice(0, 7),
      schedule.end_sunday.slice(0, 7),
      language
    );
  }

  /** Draft row per Sunday of the active cycle: saved weeks cloned, gaps backfilled. */
  private async loadSheet(): Promise<void> {
    const schedule = this.activeSchedule;
    if (!schedule) {
      this.sheetWeeks = [];
      this.sheetBaseline = new Map();
      this.sheetRangeLabel = '';
      this.pendingEndSunday = null;
      return;
    }

    this.sheetLoading = true;
    this.cdr.detectChanges();
    try {
      const saved = await this.meetingSchedule.getWeeksInRange(
        mondayOf(schedule.start_sunday),
        mondayOf(schedule.end_sunday)
      );
      const bySunday = new Map(saved.map((w) => [sundayOf(w), w]));

      const rows: MeetingWeek[] = [];
      for (
        let sunday = schedule.start_sunday;
        sunday <= schedule.end_sunday;
        sunday = addDaysIso(sunday, 7)
      ) {
        const existing = bySunday.get(sunday);
        rows.push(existing ? structuredClone(existing) : this.emptySheetRow(sunday));
      }

      this.sheetWeeks = rows;
      this.sheetBaseline = new Map(rows.map((w) => [w.week_of, this.serializeSheetRow(w)]));
      this.sheetRangeLabel = schedule.range_label?.trim() || this.scheduleLabel(schedule);
      this.pendingEndSunday = null;
      // Event weeks saved from the cards view (or midweek) count immediately:
      // the sheet opens already extended so every speaker keeps a Sunday.
      this.applyRotationEnd();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to load the schedule.');
    } finally {
      this.sheetLoading = false;
      this.cdr.detectChanges();
    }
  }

  /** Weekend rows never fabricate a midweek program (same rule as onAddWeek). */
  private emptySheetRow(sunday: string): MeetingWeek {
    const week = createEmptyWeek(mondayOf(sunday));
    week.parts = [];
    return week;
  }

  /** Dirty tracking compares week-level columns only; parts are never saved from here. */
  private serializeSheetRow(week: MeetingWeek): string {
    const { parts: _parts, ...row } = week;
    return JSON.stringify(row);
  }

  protected get sheetDirtyWeeks(): MeetingWeek[] {
    return this.sheetWeeks.filter(
      (w) => this.sheetBaseline.get(w.week_of) !== this.serializeSheetRow(w)
    );
  }

  protected get sheetDirtyCount(): number {
    return this.sheetDirtyWeeks.length;
  }

  /** True when the header label or an accepted end-date change awaits saving. */
  protected get sheetScheduleDirty(): boolean {
    const schedule = this.activeSchedule;
    if (!schedule) return false;
    if (this.pendingEndSunday !== null) return true;
    const current = schedule.range_label?.trim() || this.scheduleLabel(schedule);
    return this.sheetRangeLabel.trim() !== current;
  }

  protected get sheetHasChanges(): boolean {
    return this.sheetDirtyCount > 0 || this.sheetScheduleDirty;
  }

  /** The active cycle's last Sunday has passed; time to start the next one. */
  protected get scheduleEnded(): boolean {
    return !!this.activeSchedule &&
      this.activeSchedule.end_sunday < MeetingScheduleComponent.todayIso();
  }

  protected formatSunday(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  /**
   * A row's kind changed (e.g. a Sunday became an assembly week). The sheet
   * resizes right away: event weeks push the end out, restoring a public talk
   * pulls it back. Everything stays editable, so no confirmation is needed;
   * the new end date is persisted with Save.
   */
  protected onSheetRowKindChange(): void {
    this.applyRotationEnd();
    this.cdr.detectChanges();
  }

  /** Re-derives the cycle end from the drafts; never drops a row with unsaved edits. */
  private applyRotationEnd(): void {
    const schedule = this.activeSchedule;
    if (!schedule) return;
    const bySunday = new Map(this.sheetWeeks.map((w) => [sundayOf(w), w]));
    let end = computeScheduleEnd(schedule.start_sunday, schedule.speaker_count, bySunday);
    for (const week of this.sheetDirtyWeeks) {
      const sunday = sundayOf(week);
      if (sunday > end) end = sunday;
    }
    this.pendingEndSunday = end === schedule.end_sunday ? null : end;
    this.rebuildSheetRows(end);
  }

  /** Re-spans the sheet rows to a new end Sunday, keeping every existing draft. */
  private rebuildSheetRows(endSunday: string): void {
    const schedule = this.activeSchedule;
    if (!schedule) return;
    const byWeekOf = new Map(this.sheetWeeks.map((w) => [w.week_of, w]));
    const rows: MeetingWeek[] = [];
    for (
      let sunday = schedule.start_sunday;
      sunday <= endSunday;
      sunday = addDaysIso(sunday, 7)
    ) {
      const monday = mondayOf(sunday);
      const existing = byWeekOf.get(monday);
      if (existing) {
        rows.push(existing);
      } else {
        const row = this.emptySheetRow(sunday);
        this.sheetBaseline.set(monday, this.serializeSheetRow(row));
        rows.push(row);
      }
    }
    this.sheetWeeks = rows;
  }

  /** Saves every dirty row (week columns only), then the label/end changes, in one go. */
  protected async onSaveSheet(): Promise<void> {
    if (this.sheetSaving || !this.sheetHasChanges) return;

    this.sheetSaving = true;
    this.toast.dismiss();
    this.cdr.detectChanges();

    let savedCount = 0;
    try {
      for (const week of this.sheetDirtyWeeks) {
        const saved = await this.meetingSchedule.saveWeek(week, { skipParts: true });
        const index = this.sheetWeeks.findIndex((w) => w.week_of === saved.week_of);
        if (index >= 0) this.sheetWeeks[index] = saved;
        this.sheetBaseline.set(saved.week_of, this.serializeSheetRow(saved));
        const others = this.weeks.filter((w) => w.week_of !== saved.week_of);
        this.weeks = [...others, saved].sort((a, b) => a.week_of.localeCompare(b.week_of));
        savedCount++;
      }

      const schedule = this.activeSchedule;
      if (schedule && this.sheetScheduleDirty) {
        const updated = await this.meetingSchedule.saveWeekendSchedule({
          ...schedule,
          end_sunday: this.pendingEndSunday ?? schedule.end_sunday,
          range_label: this.sheetRangeLabel.trim() || null,
        });
        this.activeSchedule = updated;
        this.schedules = [
          updated,
          ...this.schedules.filter((s) => s.start_sunday !== updated.start_sunday),
        ].sort((a, b) => b.start_sunday.localeCompare(a.start_sunday));
        this.pendingEndSunday = null;
      }

      this.toast.showSuccess(
        savedCount > 0
          ? `Saved ${savedCount} week${savedCount === 1 ? '' : 's'}.`
          : 'Schedule updated.'
      );
      await this.refreshHistory();
      await this.loadOutlines();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save the schedule.';
      this.toast.showError(
        savedCount > 0 ? `${message} ${savedCount} week(s) were saved before the error.` : message
      );
    } finally {
      this.sheetSaving = false;
      this.cdr.detectChanges();
    }
  }

  /** Throws away unsaved sheet edits and reloads from the saved rows. */
  protected async onDiscardSheet(): Promise<void> {
    if (this.sheetSaving) return;
    await this.loadSheet();
  }

  // ---------- New Schedule dialog ----------

  protected get activeElderCount(): number {
    return this.publishers.filter((p) => !p.inactive && p.elder).length;
  }

  protected get activeMsCount(): number {
    return this.publishers.filter((p) => !p.inactive && p.ministerial_servant && !p.elder).length;
  }

  protected async openNewSchedule(): Promise<void> {
    if (this.newScheduleLoading) return;
    const poolCount = speakingPoolCount(this.publishers);
    if (poolCount === 0) {
      this.toast.showError(
        'No active elders or ministerial servants in the publisher list; the rotation length cannot be computed.'
      );
      return;
    }
    const latest = this.schedules[0] ?? null;
    const start = latest
      ? addDaysIso(latest.end_sunday, 7)
      : nextSundayOnOrAfter(MeetingScheduleComponent.todayIso());
    await this.prepareNewScheduleDraft(start);
  }

  /**
   * Proposes the cycle window for a start Sunday: one speaking Sunday per
   * active elder/MS, with already-saved event weeks (assemblies, conventions,
   * memorials) extending the end. The label is prefilled but free text.
   */
  private async prepareNewScheduleDraft(startSunday: string): Promise<void> {
    this.newScheduleLoading = true;
    this.cdr.detectChanges();
    try {
      const poolCount = speakingPoolCount(this.publishers);
      let weekBySunday = new Map<string, MeetingWeek>();
      try {
        const lookaheadEnd = addDaysIso(startSunday, (poolCount + 30) * 7);
        const weeks = await this.meetingSchedule.getWeeksInRange(
          mondayOf(startSunday),
          mondayOf(lookaheadEnd)
        );
        weekBySunday = new Map(weeks.map((w) => [sundayOf(w), w]));
      } catch {
        // Best-effort: the proposal simply ignores pre-marked event weeks.
      }
      const end = computeScheduleEnd(startSunday, poolCount, weekBySunday);
      this.newScheduleDraft = {
        start_sunday: startSunday,
        end_sunday: end,
        range_label: weekendRangeLabel(startSunday.slice(0, 7), end.slice(0, 7), 'ilo'),
        poolCount,
        elders: this.activeElderCount,
        ministerialServants: this.activeMsCount,
      };
    } finally {
      this.newScheduleLoading = false;
      this.cdr.detectChanges();
    }
  }

  protected async onNewScheduleStartChange(value: string): Promise<void> {
    if (!value || !this.newScheduleDraft) return;
    await this.prepareNewScheduleDraft(nextSundayOnOrAfter(value));
  }

  protected onCancelNewSchedule(): void {
    if (this.newScheduleSaving) return;
    this.newScheduleDraft = null;
    this.cdr.detectChanges();
  }

  protected async onConfirmNewSchedule(): Promise<void> {
    const draft = this.newScheduleDraft;
    if (!draft || this.newScheduleSaving) return;

    this.newScheduleSaving = true;
    this.cdr.detectChanges();
    try {
      const saved = await this.meetingSchedule.saveWeekendSchedule({
        start_sunday: draft.start_sunday,
        end_sunday: draft.end_sunday,
        range_label: draft.range_label.trim() || null,
        speaker_count: draft.poolCount,
      });
      this.schedules = [
        saved,
        ...this.schedules.filter((s) => s.start_sunday !== saved.start_sunday),
      ].sort((a, b) => b.start_sunday.localeCompare(a.start_sunday));
      this.activeSchedule = saved;
      this.newScheduleDraft = null;
      this.toast.showSuccess(`Schedule created: ${saved.range_label || this.scheduleLabel(saved)}.`);
      this.setWeekendView('sheet');
      await this.loadSheet();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to create the schedule.');
    } finally {
      this.newScheduleSaving = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Re-fetches assignment history after a save or delete. The service already
   * invalidated its cache, so this pulls fresh rows; recency and pairing
   * warnings then reflect the change while editing other weeks.
   */
  private async refreshHistory(): Promise<void> {
    try {
      const historySince = this.isoMonthsAgo(MeetingScheduleComponent.HISTORY_WINDOW_MONTHS);
      const history = await this.meetingSchedule.getAssignmentHistory(historySince);
      this.history = history.lastAssigned;
      this.historyDetail = history.byPublisher;
    } catch {
      // Non-fatal: warnings keep using the previous snapshot until the next load.
    }
  }

  /**
   * Publisher pool for the assignee dropdowns. Prefers the service year the
   * selected month belongs to, but months scheduled ahead of time (e.g. the
   * first months of a service year with no records yet) fall back to the most
   * recent earlier service year that has publishers, so the list is never empty.
   */
  private async loadPublisherPool(serviceYear: number): Promise<PublisherRecord[]> {
    const maxFallbackYears = 3;
    for (let offset = 0; offset <= maxFallbackYears; offset++) {
      const publishers = await this.supabase.getPublisherRecordsByServiceYear(serviceYear - offset);
      if (publishers.length > 0) return publishers;
    }
    return [];
  }

  private isoMonthsAgo(months: number): string {
    const date = new Date();
    date.setMonth(date.getMonth() - months);
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${m}-${d}`;
  }

  // ---------- Month dashboard ----------

  /** Headline numbers for the stats row above the week list. */
  protected get monthStats(): {
    planned: number;
    mondays: number;
    fullyAssigned: number;
    openSlots: number;
  } {
    const weeks = this.monthWeeks;
    const meetingWeeks = weeks.filter((w) => w.week_type !== 'no_meeting');
    return {
      planned: weeks.length,
      mondays: this.mondays.length,
      fullyAssigned: meetingWeeks.filter((w) => this.unassignedCount(w) === 0).length,
      openSlots: weeks.reduce((n, w) => n + this.unassignedCount(w), 0),
    };
  }

  /** Left accent color of a week card, keyed to its assignment status. */
  protected weekAccent(week: MeetingWeek | undefined): string {
    if (!week) return 'bg-slate-200 dark:bg-slate-600';
    if (week.week_type === 'no_meeting')
      return 'bg-gradient-to-b from-slate-300 to-slate-400 dark:from-slate-500 dark:to-slate-600';
    return this.unassignedCount(week) > 0
      ? 'bg-gradient-to-b from-amber-300 to-amber-500'
      : 'bg-gradient-to-b from-emerald-300 to-emerald-500';
  }

  // ---------- Week cards ----------

  protected unassignedCount(week: MeetingWeek): number {
    if (week.week_type === 'no_meeting') return 0;

    if (this.mode === 'midweek') {
      let count = week.parts.filter((p) => !p.assignee_name).length;
      if (!week.chairman_name) count++;
      if (!week.opening_prayer_name) count++;
      if (!week.closing_prayer_name) count++;
      return count;
    }

    // Assembly/convention weekends have no local meeting to assign.
    if (week.weekend_event === 'assembly' || week.weekend_event === 'convention') return 0;

    let count = 0;
    if (!week.weekend_chairman_name) count++;
    if (!week.public_talk_speaker_name) count++;
    if (week.weekend_event === 'symposium' && !week.public_talk_speaker2_name) count++;
    if (!week.wt_conductor_name) count++;
    if (!week.wt_reader_name) count++;
    if (!week.weekend_opening_prayer_name) count++;
    if (!week.weekend_closing_prayer_name) count++;
    return count;
  }

  protected weekTypeLabel(week: MeetingWeek): string | null {
    if (this.mode === 'weekend') {
      switch (week.weekend_event) {
        case 'assembly':
          return 'Circuit Assembly';
        case 'convention':
          return 'Regional Convention';
        case 'special_talk':
          return 'Special Talk';
        case 'symposium':
          return 'Symposium';
      }
    }
    switch (week.week_type) {
      case 'co_visit':
        return 'CO Visit';
      case 'memorial':
        return 'Memorial';
      case 'no_meeting':
        return 'No Meeting';
      default:
        return null;
    }
  }

  /** Publisher name in reading order for the card summaries; '—' when unassigned. */
  protected personName(name: string | null | undefined): string {
    return displayPublisherName(name) || '—';
  }

  protected formatWeekLabel(mondayIso: string): string {
    const start = new Date(`${mondayIso}T00:00:00`);
    const end = new Date(`${addDaysIso(mondayIso, 6)}T00:00:00`);
    const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endLabel = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `Week of ${startLabel} – ${endLabel}`;
  }

  protected isEditing(mondayIso: string): boolean {
    return this.draft?.week_of === mondayIso;
  }

  protected onAddWeek(mondayIso: string): void {
    const draft = createEmptyWeek(mondayIso);
    // From the weekend tab, do not fabricate an unassigned midweek program.
    if (this.mode === 'weekend') draft.parts = [];
    this.draft = draft;
    this.cdr.detectChanges();
  }

  protected onEditWeek(week: MeetingWeek): void {
    const draft = structuredClone(week);
    // A week first created from the weekend tab has no midweek parts yet.
    if (
      this.mode === 'midweek' &&
      draft.parts.length === 0 &&
      draft.week_type !== 'no_meeting' &&
      draft.week_type !== 'memorial'
    ) {
      draft.parts = buildDefaultWeekParts(draft.week_type);
    }
    this.draft = draft;
    this.cdr.detectChanges();
  }

  protected onCancelEdit(): void {
    this.draft = null;
    this.cdr.detectChanges();
  }

  protected async onSaveDraft(): Promise<void> {
    if (!this.draft || this.saving) return;

    this.saving = true;
    this.toast.dismiss();
    this.cdr.detectChanges();

    try {
      // Weekend saves must never touch meeting_parts: the draft's copy of the
      // midweek program may be stale and would overwrite newer assignments.
      const saved = await this.meetingSchedule.saveWeek(this.draft, {
        skipParts: this.mode === 'weekend',
      });
      const others = this.weeks.filter((w) => w.week_of !== saved.week_of);
      this.weeks = [...others, saved].sort((a, b) => a.week_of.localeCompare(b.week_of));
      this.draft = null;
      this.toast.showSuccess('Meeting week saved.');
      // Rebuild rotation history so the just-saved assignments warn in other weeks.
      await this.refreshHistory();
      if (this.mode === 'weekend') await this.loadOutlines();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to save the week.');
    } finally {
      this.saving = false;
      this.cdr.detectChanges();
    }
  }

  protected onRequestDelete(week: MeetingWeek): void {
    if (this.deletingId || this.saving) return;
    this.pendingDelete = week;
    this.cdr.detectChanges();
  }

  protected onCancelDelete(): void {
    this.pendingDelete = null;
    this.cdr.detectChanges();
  }

  protected async onDeleteWeek(): Promise<void> {
    const week = this.pendingDelete;
    if (!week?.id || this.deletingId) return;

    this.deletingId = week.id;
    this.pendingDelete = null;
    this.cdr.detectChanges();

    try {
      await this.meetingSchedule.deleteWeek(week.id);
      this.weeks = this.weeks.filter((w) => w.id !== week.id);
      if (this.draft?.week_of === week.week_of) this.draft = null;
      this.toast.showSuccess('Meeting week removed.');
      await this.refreshHistory();
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Failed to remove the week.');
    } finally {
      this.deletingId = null;
      this.cdr.detectChanges();
    }
  }

  // ---------- wol.jw.org import ----------

  protected async onImportWeek(mondayIso: string): Promise<void> {
    if (this.importing) return;
    this.importing = mondayIso;
    this.openImportProgress(mondayIso);
    this.cdr.detectChanges();

    const existing = this.weekFor(mondayIso);
    const base = this.draft?.week_of === mondayIso
      ? this.draft
      : existing
        ? structuredClone(existing)
        : createEmptyWeek(mondayIso);

    try {
      const { year, week } = this.isoWeekOf(mondayIso);
      const { program, fromCache } = await this.meetingSchedule.importProgram(
        year,
        week,
        this.importLanguage
      );
      this.draft = this.applyProgram(base, program);
      this.completeImportProgress(fromCache);
      this.toast.showSuccess(
        fromCache
          ? 'Program loaded from the saved copy. Assign publishers, then save.'
          : 'Program imported. Assign publishers, then save.'
      );
    } catch (err) {
      this.draft = base;
      const message = err instanceof Error ? err.message : 'Import failed.';
      this.failImportProgress(message);
      this.toast.showError(`${message} You can fill the program manually.`);
    } finally {
      this.importing = null;
      this.cdr.detectChanges();
      void this.loadImportUsage();
    }
  }

  // ---------- Import progress modal ----------

  /**
   * Opens the progress modal and walks the early steps on a timer. The network
   * step (index 2) stays active until the import promise settles; complete/fail
   * below finish the story truthfully.
   */
  private openImportProgress(mondayIso: string): void {
    this.clearImportTimers();
    this.importWeekLabel = this.formatWeekLabel(mondayIso);
    this.importError = null;
    this.importFromCache = false;
    this.importSteps = IMPORT_STEP_TEMPLATE.map((step, i) => ({
      ...step,
      status: i === 0 ? 'active' : 'pending',
    }));
    this.importModalOpen = true;

    const advance = (index: number, delay: number) => {
      this.importTimers.push(
        setTimeout(() => {
          if (this.importSteps[index]?.status !== 'active') return;
          this.importSteps[index].status = 'done';
          const next = this.importSteps[index + 1];
          if (next) next.status = 'active';
          this.cdr.detectChanges();
          if (index + 1 < 2) advance(index + 1, 900);
        }, delay)
      );
    };
    advance(0, 450);
  }

  private completeImportProgress(fromCache: boolean): void {
    this.clearImportTimers();
    this.importFromCache = fromCache;
    for (const [i, step] of this.importSteps.entries()) {
      step.status = 'done';
      if (fromCache && (i === 1 || i === 2)) {
        step.detail = 'Skipped: this week was already saved on this device.';
      }
    }
    this.cdr.detectChanges();
    // Leave the finished checklist on screen briefly, then get out of the way.
    this.importTimers.push(
      setTimeout(() => {
        this.importModalOpen = false;
        this.cdr.detectChanges();
      }, 1600)
    );
  }

  private failImportProgress(message: string): void {
    this.clearImportTimers();
    const active = this.importSteps.find((s) => s.status === 'active');
    if (active) active.status = 'error';
    this.importError = message;
    this.cdr.detectChanges();
  }

  protected closeImportModal(): void {
    this.clearImportTimers();
    this.importModalOpen = false;
    this.cdr.detectChanges();
  }

  private clearImportTimers(): void {
    for (const timer of this.importTimers) clearTimeout(timer);
    this.importTimers = [];
  }

  /** Overwrites program content (titles, songs, reading) while keeping assignments where possible. */
  private applyProgram(week: MeetingWeek, program: ImportedProgram): MeetingWeek {
    week.weekly_bible_reading = program.weeklyBibleReading ?? week.weekly_bible_reading;
    if (program.songs?.length === 3) {
      week.song_opening = program.songs[0] ?? week.song_opening;
      week.song_middle = program.songs[1] ?? week.song_middle;
      week.song_closing = program.songs[2] ?? week.song_closing;
    }
    week.wt_article_title = program.wtArticleTitle ?? week.wt_article_title;

    const sections: { key: MeetingPart['section']; items: ImportedProgram['treasures'] }[] = [
      { key: 'treasures', items: program.treasures ?? [] },
      { key: 'ministry', items: program.ministry ?? [] },
      { key: 'living', items: program.living ?? [] },
    ];

    const parts: MeetingPart[] = [];
    for (const section of sections) {
      const previous = week.parts.filter((p) => p.section === section.key);
      section.items.forEach((item, index) => {
        const match = previous[index];
        const sameType = match && match.part_type === item.partType;
        parts.push({
          section: section.key,
          sort_order: index,
          title: item.title,
          duration_minutes: item.minutes,
          part_type: item.partType,
          setting: item.setting ?? null,
          assignee_name: sameType ? match.assignee_name : null,
          assistant_name: sameType ? match.assistant_name : null,
          room: 'main',
        });
      });
    }

    if (parts.length > 0) {
      // The workbook never lists the CBS reader as a numbered part; keep a slot for it.
      const hasCbs = parts.some((p) => p.part_type === 'cbs');
      const hasReader = parts.some((p) => p.part_type === 'cbs_reader');
      if (hasCbs && !hasReader) {
        const previousReader = week.parts.find((p) => p.part_type === 'cbs_reader');
        parts.push({
          section: 'living',
          sort_order: parts.filter((p) => p.section === 'living').length,
          title: 'CBS Reader',
          duration_minutes: null,
          part_type: 'cbs_reader',
          setting: null,
          assignee_name: previousReader?.assignee_name ?? null,
          assistant_name: null,
          room: 'main',
        });
      }
      week.parts = parts;
    }
    return week;
  }

  /** ISO-8601 week number (the week containing that Monday's Thursday). */
  private isoWeekOf(mondayIso: string): { year: number; week: number } {
    const thursday = new Date(`${addDaysIso(mondayIso, 3)}T00:00:00`);
    const isoYear = thursday.getFullYear();
    const yearStart = new Date(isoYear, 0, 1);
    const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return { year: isoYear, week };
  }

  // ---------- Generation confirmation ----------

  protected get generating(): boolean {
    return this.printingMonth || this.downloadingPng || this.downloadingPdf || this.previewLoading;
  }

  /** Numbers shown in the generate confirmation modal. */
  protected get generateSummary(): {
    weeks: number;
    mondays: number;
    unassigned: number;
    slips: number;
  } {
    if (this.mode === 'weekend') {
      return {
        weeks: this.rangeWeeks.length,
        mondays: this.rangeWeeks.length,
        unassigned: this.rangeWeeks.reduce((n, w) => n + this.unassignedCount(w), 0),
        slips: 0,
      };
    }
    const weeks = this.monthWeeks;
    return {
      weeks: weeks.length,
      mondays: this.mondays.length,
      unassigned: weeks.reduce((n, w) => n + this.unassignedCount(w), 0),
      slips: collectAssignmentSlips(weeks).length,
    };
  }

  /** What the pending export covers, for the confirmation modal. */
  protected get generateScopeLabel(): string {
    return this.mode === 'weekend' ? this.rangeLabel : this.monthLabel;
  }

  protected generateLabel(kind: GenerateKind | null): string {
    switch (kind) {
      case 'print':
        return 'Print Schedule';
      case 'png':
        return 'Save as PNG';
      case 'pdf':
        return 'Save as PDF';
      case 'slips':
        return 'Print Assignment Slips';
      default:
        return '';
    }
  }

  protected async onRequestGenerate(kind: GenerateKind): Promise<void> {
    if (this.generating) return;
    if (kind === 'slips') {
      if (collectAssignmentSlips(this.monthWeeks).length === 0) {
        this.toast.showError('No assigned student parts in this month yet.');
        return;
      }
    } else if (this.mode === 'weekend') {
      // The weekend export covers the whole rotation range, not one month.
      try {
        this.rangeWeeks = await this.fetchRangeWeeks();
      } catch (err) {
        this.toast.showError(err instanceof Error ? err.message : 'Failed to load the range.');
        return;
      }
      if (this.rangeWeeks.length === 0) {
        this.toast.showError(`No saved weeks in ${this.rangeLabel} to export yet.`);
        return;
      }
    } else if (this.monthWeeks.length === 0) {
      this.toast.showError(
        kind === 'print'
          ? 'No saved weeks in this month to print yet.'
          : 'No saved weeks in this month to export yet.'
      );
      return;
    }
    this.generateRequest = kind;
    this.cdr.detectChanges();
  }

  /** Saved weeks of the active rotation cycle, or of [selectedMonth, rangeEndMonth] without one. */
  private async fetchRangeWeeks(): Promise<MeetingWeek[]> {
    const schedule = this.activeSchedule;
    if (schedule) {
      const weeks = await this.meetingSchedule.getWeeksInRange(
        mondayOf(schedule.start_sunday),
        mondayOf(schedule.end_sunday)
      );
      return weeks.filter((w) => {
        const sunday = sundayOf(w);
        return sunday >= schedule.start_sunday && sunday <= schedule.end_sunday;
      });
    }

    const [startYear, startMonth] = this.selectedMonth.split('-').map(Number);
    const [endYear, endMonth] = this.rangeEndMonth.split('-').map(Number);
    // Widen by a week on both sides: a Sunday can belong to a week_of in the
    // neighboring month. Rows are then filtered by their actual Sunday.
    const start = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(endYear, endMonth, 0).getDate();
    const end = `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const weeks = await this.meetingSchedule.getWeeksInRange(addDaysIso(start, -7), end);

    return weeks.filter((w) => {
      const sunday = sundayOf(w);
      return sunday >= start && sunday <= end;
    });
  }

  protected onCancelGenerate(): void {
    if (this.generating) return;
    this.generateRequest = null;
    this.cdr.detectChanges();
  }

  protected async onConfirmGenerate(): Promise<void> {
    const kind = this.generateRequest;
    if (!kind || this.generating) return;
    try {
      if (kind === 'print') await this.onPrintMonth();
      else if (kind === 'png') await this.onDownloadPng();
      else if (kind === 'pdf') await this.onDownloadPdf();
      else this.onPrintSlips();
    } finally {
      this.generateRequest = null;
      this.cdr.detectChanges();
    }
  }

  // ---------- Preview ----------

  protected previewPages: string[] | null = null;
  protected previewLoading = false;

  protected async onOpenPreview(): Promise<void> {
    if (this.generating) return;

    this.previewLoading = true;
    this.cdr.detectChanges();
    try {
      let html: string;
      if (this.mode === 'weekend') {
        // Preview exactly what the export produces: the range table, not the month sheet.
        this.rangeWeeks = await this.fetchRangeWeeks();
        if (this.rangeWeeks.length === 0) {
          this.toast.showError(`No saved weeks in ${this.rangeLabel} to preview yet.`);
          return;
        }
        html = buildWeekendRangeDocument(
          this.rangeWeeks,
          CONGREGATION_NAME,
          this.exportRangeLabel,
          this.importLanguage
        );
      } else {
        const weeks = this.monthWeeks;
        if (weeks.length === 0) {
          this.toast.showError('No saved weeks in this month to preview yet.');
          return;
        }
        html = buildMonthScheduleDocument(
          weeks,
          CONGREGATION_NAME,
          this.monthLabel,
          this.mode,
          this.importLanguage
        );
      }
      this.previewPages = await renderHtmlToPngDataUrls(html);
    } catch (err) {
      this.toast.showError(
        err instanceof Error ? err.message : 'Could not prepare the preview.'
      );
    } finally {
      this.previewLoading = false;
      this.cdr.detectChanges();
    }
  }

  protected onClosePreview(): void {
    if (this.generating) return;
    this.previewPages = null;
    this.cdr.detectChanges();
  }

  protected async onExportFromPreview(kind: 'print' | 'png' | 'pdf'): Promise<void> {
    if (this.generating) return;
    if (kind === 'print') await this.onPrintMonth();
    else if (kind === 'png') await this.onDownloadPng();
    else await this.onDownloadPdf();
    this.previewPages = null;
    this.cdr.detectChanges();
  }

  // ---------- Printing ----------

  protected get monthWeeks(): MeetingWeek[] {
    return this.mondays
      .map((monday) => this.weekFor(monday))
      .filter((w): w is MeetingWeek => !!w);
  }

  protected printingMonth = false;

  /**
   * Document + labels for the pending export. Midweek exports the selected
   * month's sheet; weekend exports the compact range table (rotation cycle).
   */
  private buildExportDocument(): { html: string; scopeLabel: string; fileName: string } | null {
    if (this.mode === 'weekend') {
      if (this.rangeWeeks.length === 0) return null;
      const schedule = this.activeSchedule;
      return {
        html: buildWeekendRangeDocument(
          this.rangeWeeks,
          CONGREGATION_NAME,
          this.exportRangeLabel,
          this.importLanguage
        ),
        scopeLabel: this.rangeLabel,
        fileName: schedule
          ? `weekend-schedule-${schedule.start_sunday}-to-${schedule.end_sunday}`
          : `weekend-schedule-${this.selectedMonth}-to-${this.rangeEndMonth}`,
      };
    }

    const weeks = this.monthWeeks;
    if (weeks.length === 0) return null;
    return {
      html: buildMonthScheduleDocument(weeks, CONGREGATION_NAME, this.monthLabel, 'midweek', this.importLanguage),
      scopeLabel: this.monthLabel,
      fileName: `midweek-schedule-${this.selectedMonth}`,
    };
  }

  /**
   * Prints the same PNG pages the download produces, so the print preview is
   * identical to the exported image.
   */
  protected async onPrintMonth(): Promise<void> {
    if (this.printingMonth) return;
    const doc = this.buildExportDocument();
    if (!doc) {
      this.toast.showError('No saved weeks to print yet.');
      return;
    }

    this.printingMonth = true;
    this.cdr.detectChanges();
    try {
      const pageImages = await renderHtmlToPngDataUrls(doc.html);
      this.openPrintDocument(
        buildImagePrintDocument(pageImages, `${this.mode} schedule ${doc.scopeLabel}`)
      );
    } catch (err) {
      this.toast.showError(
        err instanceof Error ? err.message : 'Could not prepare the print preview.'
      );
    } finally {
      this.printingMonth = false;
      this.cdr.detectChanges();
    }
  }

  protected downloadingPng = false;

  protected async onDownloadPng(): Promise<void> {
    if (this.downloadingPng) return;
    const doc = this.buildExportDocument();
    if (!doc) {
      this.toast.showError('No saved weeks to export yet.');
      return;
    }

    this.downloadingPng = true;
    this.cdr.detectChanges();
    try {
      const pageCount = await downloadHtmlAsPngPages(doc.html, doc.fileName);
      this.toast.showSuccess(
        pageCount > 1 ? `Schedule downloaded as ${pageCount} PNG pages.` : 'Schedule downloaded as PNG.'
      );
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Could not create the PNG.');
    } finally {
      this.downloadingPng = false;
      this.cdr.detectChanges();
    }
  }

  protected downloadingPdf = false;

  protected async onDownloadPdf(): Promise<void> {
    if (this.downloadingPdf) return;
    const doc = this.buildExportDocument();
    if (!doc) {
      this.toast.showError('No saved weeks to export yet.');
      return;
    }

    this.downloadingPdf = true;
    this.cdr.detectChanges();
    try {
      const pageCount = await downloadHtmlAsPdf(doc.html, doc.fileName);
      this.toast.showSuccess(
        pageCount > 1 ? `Schedule downloaded as a ${pageCount}-page PDF.` : 'Schedule downloaded as PDF.'
      );
    } catch (err) {
      this.toast.showError(err instanceof Error ? err.message : 'Could not create the PDF.');
    } finally {
      this.downloadingPdf = false;
      this.cdr.detectChanges();
    }
  }

  protected onPrintSlips(): void {
    const slips = collectAssignmentSlips(this.monthWeeks);
    if (slips.length === 0) {
      this.toast.showError('No assigned student parts in this month yet.');
      return;
    }
    this.openPrintDocument(buildAssignmentSlipsDocument(slips, CONGREGATION_NAME));
  }

  private openPrintDocument(html: string): void {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      this.toast.showError('Pop-up blocked. Allow pop-ups to print the schedule.');
      URL.revokeObjectURL(url);
      return;
    }
    w.addEventListener('load', () => {
      try {
        w.print();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url);
    });
  }
}

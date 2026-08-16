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
} from '../../services/meeting-schedule.service';
import { PublisherRecord, SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { downloadHtmlAsPdf } from '../../utils/html-to-pdf';
import { downloadHtmlAsPngPages, renderHtmlToPngDataUrls } from '../../utils/html-to-png';
import {
  buildAssignmentSlipsDocument,
  buildImagePrintDocument,
  buildMonthScheduleDocument,
  collectAssignmentSlips,
} from '../../utils/meeting-schedule-print';
import { displayPublisherName } from '../../utils/publisher-name';
import { addDaysIso, buildDefaultWeekParts, createEmptyWeek } from './meeting-defaults';

export type SchedulerMode = 'midweek' | 'weekend';
import { MeetingWeekEditorComponent } from './meeting-week-editor.component';

const CONGREGATION_NAME = 'Bolaoen Congregation';
const IMPORT_LANGUAGE_STORAGE_KEY = 'meeting-import-language';

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
  imports: [CommonModule, FormsModule, MeetingWeekEditorComponent],
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

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly meetingSchedule: MeetingScheduleService,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef,
    route: ActivatedRoute
  ) {
    route.data.pipe(takeUntilDestroyed()).subscribe((data) => {
      const mode = data['mode'];
      this.mode = mode === 'weekend' ? 'weekend' : 'midweek';
      this.draft = null;
      this.cdr.detectChanges();
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
    this.draft = null;
    await this.loadMonth();
  }

  protected async onNextMonth(): Promise<void> {
    this.selectedMonth = this.shiftMonth(this.selectedMonth, 1);
    this.draft = null;
    await this.loadMonth();
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
    } catch (err) {
      this.weeks = [];
      this.toast.showError(err instanceof Error ? err.message : 'Failed to load the schedule.');
    } finally {
      this.loading = false;
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

    let count = 0;
    if (!week.weekend_chairman_name) count++;
    if (!week.public_talk_speaker_name) count++;
    if (!week.wt_conductor_name) count++;
    if (!week.wt_reader_name) count++;
    if (!week.weekend_opening_prayer_name) count++;
    if (!week.weekend_closing_prayer_name) count++;
    return count;
  }

  protected weekTypeLabel(week: MeetingWeek): string | null {
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
      const saved = await this.meetingSchedule.saveWeek(this.draft);
      const others = this.weeks.filter((w) => w.week_of !== saved.week_of);
      this.weeks = [...others, saved].sort((a, b) => a.week_of.localeCompare(b.week_of));
      this.draft = null;
      this.toast.showSuccess('Meeting week saved.');
      // Rebuild rotation history so the just-saved assignments warn in other weeks.
      await this.refreshHistory();
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
    return this.printingMonth || this.downloadingPng || this.downloadingPdf;
  }

  /** Numbers shown in the generate confirmation modal. */
  protected get generateSummary(): {
    weeks: number;
    mondays: number;
    unassigned: number;
    slips: number;
  } {
    const weeks = this.monthWeeks;
    return {
      weeks: weeks.length,
      mondays: this.mondays.length,
      unassigned: weeks.reduce((n, w) => n + this.unassignedCount(w), 0),
      slips: collectAssignmentSlips(weeks).length,
    };
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

  protected onRequestGenerate(kind: GenerateKind): void {
    if (this.generating) return;
    if (kind === 'slips') {
      if (collectAssignmentSlips(this.monthWeeks).length === 0) {
        this.toast.showError('No assigned student parts in this month yet.');
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

  // ---------- Printing ----------

  protected get monthWeeks(): MeetingWeek[] {
    return this.mondays
      .map((monday) => this.weekFor(monday))
      .filter((w): w is MeetingWeek => !!w);
  }

  protected printingMonth = false;

  /**
   * Prints the same PNG pages the download produces, so the print preview is
   * identical to the exported image.
   */
  protected async onPrintMonth(): Promise<void> {
    const weeks = this.monthWeeks;
    if (weeks.length === 0) {
      this.toast.showError('No saved weeks in this month to print yet.');
      return;
    }
    if (this.printingMonth) return;

    this.printingMonth = true;
    this.cdr.detectChanges();
    try {
      const html = buildMonthScheduleDocument(
        weeks,
        CONGREGATION_NAME,
        this.monthLabel,
        this.mode,
        this.importLanguage
      );
      const pageImages = await renderHtmlToPngDataUrls(html);
      this.openPrintDocument(
        buildImagePrintDocument(pageImages, `${this.mode} schedule ${this.monthLabel}`)
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
    const weeks = this.monthWeeks;
    if (weeks.length === 0) {
      this.toast.showError('No saved weeks in this month to export yet.');
      return;
    }
    if (this.downloadingPng) return;

    this.downloadingPng = true;
    this.cdr.detectChanges();
    try {
      const html = buildMonthScheduleDocument(
        weeks,
        CONGREGATION_NAME,
        this.monthLabel,
        this.mode,
        this.importLanguage
      );
      const pageCount = await downloadHtmlAsPngPages(html, `${this.mode}-schedule-${this.selectedMonth}`);
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
    const weeks = this.monthWeeks;
    if (weeks.length === 0) {
      this.toast.showError('No saved weeks in this month to export yet.');
      return;
    }
    if (this.downloadingPdf) return;

    this.downloadingPdf = true;
    this.cdr.detectChanges();
    try {
      const html = buildMonthScheduleDocument(
        weeks,
        CONGREGATION_NAME,
        this.monthLabel,
        this.mode,
        this.importLanguage
      );
      const pageCount = await downloadHtmlAsPdf(html, `${this.mode}-schedule-${this.selectedMonth}`);
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

import { Injectable, inject } from '@angular/core';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { CacheService } from './cache.service';
import { SupabaseService } from './supabase.service';

export type MeetingWeekType = 'regular' | 'co_visit' | 'no_meeting' | 'memorial';
export type WeekendEvent = 'assembly' | 'convention' | 'special_talk' | 'symposium';
export type MeetingSection = 'treasures' | 'ministry' | 'living';
export type MeetingPartType =
  | 'talk'
  | 'spiritual_gems'
  | 'bible_reading'
  | 'student_demo'
  | 'student_talk'
  | 'living_talk'
  | 'cbs'
  | 'cbs_reader'
  | 'service_talk'
  | 'other';
export type MeetingRoom = 'main' | 'aux1' | 'aux2';

export interface MeetingPart {
  id?: string;
  meeting_id?: string;
  section: MeetingSection;
  sort_order: number;
  title: string;
  duration_minutes: number | null;
  part_type: MeetingPartType;
  /** Workbook setting for ministry parts, e.g. "HOUSE TO HOUSE" / "PANAGBALAYBALAY". */
  setting: string | null;
  assignee_name: string | null;
  assistant_name: string | null;
  room: MeetingRoom;
}

export interface MeetingWeek {
  id?: string;
  week_of: string;
  week_type: MeetingWeekType;
  notes: string | null;
  /** Cleaning assignment shown on the printed midweek schedule, e.g. "Group 5". */
  cleaning_group: string | null;

  midweek_date: string | null;
  weekly_bible_reading: string | null;
  song_opening: number | null;
  song_middle: number | null;
  song_closing: number | null;
  chairman_name: string | null;
  opening_prayer_name: string | null;
  closing_prayer_name: string | null;

  weekend_date: string | null;
  /** Special weekend event; null for a regular public talk week. */
  weekend_event: WeekendEvent | null;
  weekend_chairman_name: string | null;
  /** Talk title only; the S-99 outline number lives in public_talk_number. */
  public_talk_theme: string | null;
  /** Null for free-text themes (e.g. the drama during a C.O. visit). */
  public_talk_number: number | null;
  public_talk_speaker_name: string | null;
  /** Second speaker when weekend_event is 'symposium'. */
  public_talk_speaker2_name: string | null;
  speaker_congregation: string | null;
  wt_article_title: string | null;
  wt_conductor_name: string | null;
  wt_reader_name: string | null;
  weekend_opening_prayer_name: string | null;
  weekend_closing_prayer_name: string | null;
  weekend_song_opening: number | null;
  weekend_song_middle: number | null;
  weekend_song_closing: number | null;

  parts: MeetingPart[];
}

/** One past assignment: the week it happened and the part title (null for week-level roles). */
export interface AssignmentEvent {
  date: string;
  title: string | null;
  /** The other person on the same part row (demo partner); null for solo parts and roles. */
  partner: string | null;
}

/** Key: MeetingPartType, week-role column name, or 'assistant'. Events newest first. */
export type PublisherTypeHistory = Map<string, AssignmentEvent[]>;

export interface AssignmentHistory {
  /** Most recent assignment date per publisher, folded across every role and part. */
  lastAssigned: Map<string, string>;
  /** Per-publisher breakdown by history key, for rotation counts and the history modal. */
  byPublisher: Map<string, PublisherTypeHistory>;
}

type HistoryWeekRow = Omit<MeetingWeek, 'parts'> & { id: string };
// `title` is nullable in the database even though the editor model requires it.
type HistoryPartRow = Pick<
  MeetingPart,
  'meeting_id' | 'assignee_name' | 'assistant_name' | 'part_type'
> & { title: string | null };

/** Week-level name columns and the history key each one records under. */
const WEEK_ROLE_COLUMNS = [
  'chairman_name',
  'opening_prayer_name',
  'closing_prayer_name',
  'weekend_chairman_name',
  'public_talk_speaker_name',
  'public_talk_speaker2_name',
  'wt_conductor_name',
  'wt_reader_name',
  'weekend_opening_prayer_name',
  'weekend_closing_prayer_name',
] as const;

/** Pure fold of week rows + part rows into the history maps; exported for tests. */
export function buildAssignmentHistory(
  weekRows: HistoryWeekRow[],
  partRows: HistoryPartRow[]
): AssignmentHistory {
  const lastAssigned = new Map<string, string>();
  const byPublisher = new Map<string, PublisherTypeHistory>();
  const weekDateById = new Map<string, string>();

  const note = (
    name: string | null | undefined,
    date: string | null | undefined,
    key: string,
    title: string | null = null,
    partner: string | null | undefined = null
  ) => {
    const trimmed = name?.trim();
    if (!trimmed || !date) return;
    const existing = lastAssigned.get(trimmed);
    if (!existing || date > existing) lastAssigned.set(trimmed, date);

    let detail = byPublisher.get(trimmed);
    if (!detail) {
      detail = new Map<string, AssignmentEvent[]>();
      byPublisher.set(trimmed, detail);
    }
    const events = detail.get(key) ?? [];
    events.push({ date, title, partner: partner?.trim() || null });
    detail.set(key, events);
  };

  for (const w of weekRows) {
    weekDateById.set(w.id, w.week_of);
    for (const column of WEEK_ROLE_COLUMNS) {
      note(w[column], w.week_of, column);
    }
  }

  for (const p of partRows) {
    const date = weekDateById.get(p.meeting_id!);
    note(p.assignee_name, date, p.part_type, p.title, p.assistant_name);
    note(p.assistant_name, date, 'assistant', p.title, p.assignee_name);
  }

  for (const detail of byPublisher.values()) {
    for (const events of detail.values()) {
      events.sort((a, b) => b.date.localeCompare(a.date));
    }
  }

  return { lastAssigned, byPublisher };
}

/** Parsed weekly program returned by the `fetch-meeting-program` Edge Function. */
export interface ImportedProgramPart {
  title: string;
  minutes: number | null;
  partType: MeetingPartType;
  setting: string | null;
}

export interface ImportedProgram {
  weeklyBibleReading: string | null;
  songs: (number | null)[];
  treasures: ImportedProgramPart[];
  ministry: ImportedProgramPart[];
  living: ImportedProgramPart[];
  wtArticleTitle: string | null;
}

export interface ImportLog {
  year: number | null;
  week: number | null;
  status: 'success' | 'error';
  detail: string | null;
  created_at: string;
}

export interface ImportUsageMonth {
  /** e.g. "August 2026" */
  label: string;
  total: number;
  errors: number;
}

export interface ImportUsage {
  thisMonth: number;
  months: ImportUsageMonth[];
  recent: ImportLog[];
}

const MEETINGS_CACHE_PREFIX = 'meeting-weeks:';
const HISTORY_CACHE_KEY = 'meeting-assignment-history';

/** Successful imports are kept in localStorage so revisits skip the network.
 * v2: entries include the ministry-part setting. */
const IMPORT_CACHE_PREFIX = 'meeting-import-cache:v2:';
const IMPORT_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Workbook languages the import supports (must match the Edge Function). */
export const IMPORT_LANGUAGES = [
  { code: 'ilo', label: 'Iloko' },
  { code: 'en', label: 'English' },
] as const;
export type ImportLanguage = (typeof IMPORT_LANGUAGES)[number]['code'];

export interface ImportResult {
  program: ImportedProgram;
  fromCache: boolean;
}

@Injectable({ providedIn: 'root' })
export class MeetingScheduleService {
  private readonly supabase = inject(SupabaseService);
  private readonly cache = inject(CacheService);

  private get client() {
    const client = this.supabase.client;
    if (!client) throw new Error('Supabase client not configured.');
    return client;
  }

  /** Weeks (with parts) whose `week_of` falls inside [startIso, endIso]. Cached briefly. */
  async getWeeksInRange(startIso: string, endIso: string): Promise<MeetingWeek[]> {
    const cacheKey = `${MEETINGS_CACHE_PREFIX}${startIso}:${endIso}`;
    const cached = this.cache.get<MeetingWeek[]>(cacheKey);
    if (cached !== undefined) return cached;

    const { data: weeks, error } = await this.client
      .from('meeting_weeks')
      .select('*')
      .gte('week_of', startIso)
      .lte('week_of', endIso)
      .order('week_of', { ascending: true });

    if (error) throw error;

    const rows = (weeks ?? []) as (Omit<MeetingWeek, 'parts'> & { id: string })[];
    const result: MeetingWeek[] = rows.map((w) => ({ ...w, parts: [] }));

    const ids = rows.map((w) => w.id);
    if (ids.length > 0) {
      const { data: parts, error: partsError } = await this.client
        .from('meeting_parts')
        .select('*')
        .in('meeting_id', ids)
        .order('section', { ascending: true })
        .order('sort_order', { ascending: true });

      if (partsError) throw partsError;

      const sectionRank: Record<MeetingSection, number> = { treasures: 0, ministry: 1, living: 2 };
      const byMeeting = new Map<string, MeetingPart[]>();
      for (const part of (parts ?? []) as MeetingPart[]) {
        const list = byMeeting.get(part.meeting_id!) ?? [];
        list.push(part);
        byMeeting.set(part.meeting_id!, list);
      }
      for (const week of result) {
        week.parts = (byMeeting.get(week.id!) ?? []).sort(
          (a, b) => sectionRank[a.section] - sectionRank[b.section] || a.sort_order - b.sort_order
        );
      }
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Upserts the week row (conflict on `week_of`), then replaces its parts.
   * Delete-and-reinsert keeps ordering simple; the part list is small.
   *
   * `skipParts` leaves `meeting_parts` completely untouched — the weekend page
   * saves week-level columns only and must never replace the midweek program
   * with its own (possibly stale) copy of the parts.
   */
  async saveWeek(week: MeetingWeek, options?: { skipParts?: boolean }): Promise<MeetingWeek> {
    const { parts, ...weekRow } = week;

    const { data, error } = await this.client
      .from('meeting_weeks')
      .upsert(weekRow, { onConflict: 'week_of' })
      .select('*')
      .single();

    if (error) throw error;
    const saved = data as Omit<MeetingWeek, 'parts'> & { id: string };

    if (options?.skipParts) {
      this.cache.invalidatePrefix(MEETINGS_CACHE_PREFIX);
      this.cache.invalidate(HISTORY_CACHE_KEY);
      return { ...saved, parts };
    }

    const { error: deleteError } = await this.client
      .from('meeting_parts')
      .delete()
      .eq('meeting_id', saved.id);

    if (deleteError) throw deleteError;

    let savedParts: MeetingPart[] = [];
    if (parts.length > 0) {
      const rows = parts.map((p, index) => ({
        meeting_id: saved.id,
        section: p.section,
        sort_order: index,
        title: p.title,
        duration_minutes: p.duration_minutes,
        part_type: p.part_type,
        setting: p.setting?.trim() || null,
        assignee_name: p.assignee_name?.trim() || null,
        assistant_name: p.assistant_name?.trim() || null,
        room: p.room ?? 'main',
      }));

      const { data: inserted, error: insertError } = await this.client
        .from('meeting_parts')
        .insert(rows)
        .select('*');

      if (insertError) throw insertError;
      savedParts = (inserted ?? []) as MeetingPart[];
    }

    this.cache.invalidatePrefix(MEETINGS_CACHE_PREFIX);
    this.cache.invalidate(HISTORY_CACHE_KEY);

    return { ...saved, parts: savedParts };
  }

  async deleteWeek(id: string): Promise<void> {
    const { error } = await this.client.from('meeting_weeks').delete().eq('id', id);
    if (error) throw error;

    this.cache.invalidatePrefix(MEETINGS_CACHE_PREFIX);
    this.cache.invalidate(HISTORY_CACHE_KEY);
  }

  /**
   * Assignment history per publisher name since `sinceIso`, folding both midweek
   * part assignments (incl. assistants) and week-level roles. `lastAssigned`
   * drives the "last assigned" rotation hints; `byPublisher` breaks events down
   * by part type / role for the history modal and recency warnings.
   */
  async getAssignmentHistory(sinceIso: string): Promise<AssignmentHistory> {
    const cached = this.cache.get<AssignmentHistory>(HISTORY_CACHE_KEY);
    if (cached !== undefined) return cached;

    const { data: weeks, error } = await this.client
      .from('meeting_weeks')
      .select('*')
      .gte('week_of', sinceIso);

    if (error) throw error;

    const weekRows = (weeks ?? []) as (Omit<MeetingWeek, 'parts'> & { id: string })[];

    let partRows: (Pick<
      MeetingPart,
      'meeting_id' | 'assignee_name' | 'assistant_name' | 'part_type'
    > & { title: string | null })[] = [];
    if (weekRows.length > 0) {
      const { data: parts, error: partsError } = await this.client
        .from('meeting_parts')
        .select('meeting_id, assignee_name, assistant_name, part_type, title')
        .in('meeting_id', weekRows.map((w) => w.id));

      if (partsError) throw partsError;
      partRows = (parts ?? []) as typeof partRows;
    }

    const history = buildAssignmentHistory(weekRows, partRows);
    this.cache.set(HISTORY_CACHE_KEY, history);
    return history;
  }

  /**
   * Import usage for the last `monthCount` calendar months, newest first.
   * Reads `meeting_import_logs`, which the Edge Function fills one row per call.
   */
  async getImportUsage(monthCount = 6): Promise<ImportUsage> {
    const since = new Date();
    since.setDate(1);
    since.setMonth(since.getMonth() - (monthCount - 1));
    const sinceIso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-01`;

    const { data, error } = await this.client
      .from('meeting_import_logs')
      .select('year, week, status, detail, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;
    const logs = (data ?? []) as ImportLog[];

    const byMonth = new Map<string, ImportUsageMonth>();
    for (let i = 0; i < monthCount; i++) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(key, {
        label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        total: 0,
        errors: 0,
      });
    }

    for (const log of logs) {
      const key = log.created_at.slice(0, 7);
      const month = byMonth.get(key);
      if (!month) continue;
      month.total++;
      if (log.status === 'error') month.errors++;
    }

    const months = [...byMonth.values()];
    return {
      thisMonth: months[0]?.total ?? 0,
      months,
      recent: logs.slice(0, 10),
    };
  }

  /**
   * Fetches the parsed weekly program from wol.jw.org via the
   * `fetch-meeting-program` Edge Function. Successful results are cached in
   * localStorage per week, so repeat imports (including after leaving the page)
   * do not hit the network again. Throws with a readable message on failure;
   * callers fall back to the manual default-week template.
   */
  async importProgram(year: number, week: number, locale: ImportLanguage): Promise<ImportResult> {
    const cached = this.readImportCache(year, week, locale);
    if (cached) return { program: cached, fromCache: true };

    const { data, error } = await this.client.functions.invoke<ImportedProgram | { error?: string }>(
      'fetch-meeting-program',
      { body: { year, week, locale } }
    );

    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: string };
        if (body?.error) throw new Error(body.error);
      } catch (parsed) {
        if (parsed instanceof Error && parsed.message !== error.message) throw parsed;
      }
      throw new Error('Could not fetch the meeting program.');
    }
    if (error) throw new Error(error.message || 'Could not fetch the meeting program.');

    const program = data as ImportedProgram | null;
    if (!program || (program as { error?: string }).error) {
      throw new Error((program as { error?: string })?.error || 'Could not fetch the meeting program.');
    }

    this.writeImportCache(year, week, locale, program);
    return { program, fromCache: false };
  }

  private importCacheKey(year: number, week: number, locale: ImportLanguage): string {
    return `${IMPORT_CACHE_PREFIX}${locale}:${year}:${week}`;
  }

  private readImportCache(
    year: number,
    week: number,
    locale: ImportLanguage
  ): ImportedProgram | null {
    try {
      const raw = localStorage.getItem(this.importCacheKey(year, week, locale));
      if (!raw) return null;
      const entry = JSON.parse(raw) as { savedAt: number; program: ImportedProgram };
      if (!entry?.program || Date.now() - entry.savedAt > IMPORT_CACHE_TTL_MS) {
        localStorage.removeItem(this.importCacheKey(year, week, locale));
        return null;
      }
      return entry.program;
    } catch {
      return null; // corrupt entry or storage unavailable; fall back to the network
    }
  }

  private writeImportCache(
    year: number,
    week: number,
    locale: ImportLanguage,
    program: ImportedProgram
  ): void {
    try {
      localStorage.setItem(
        this.importCacheKey(year, week, locale),
        JSON.stringify({ savedAt: Date.now(), program })
      );
    } catch {
      /* storage full or unavailable; caching is best-effort */
    }
  }
}

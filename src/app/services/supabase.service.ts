import { Injectable, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { createClient, FunctionsHttpError, SupabaseClient, Session, User } from '@supabase/supabase-js';

import { environment } from '../../environments/environment';
import { CacheService } from './cache.service';

export interface PublisherMonthlyRecord {
  month: string;
  sharedInMinistry: boolean;
  bibleStudies: number | null;
  auxiliaryPioneer: boolean;
  hours: number | null;
  remarks: string;
}

export interface PublisherRecord {
  id?: string;
  service_year_start: number;
  publisher_name: string;
  date_of_birth: string | null;
  date_of_baptism: string | null;
  unbaptized_publisher: boolean;
  unbaptized_approved_on: string | null;
  gender: 'male' | 'female' | 'other' | null;
  other_sheep: boolean;
  anointed: boolean;
  elder: boolean;
  ministerial_servant: boolean;
  regular_pioneer: boolean;
  special_pioneer: boolean;
  field_missionary: boolean;
  /** Optional congregation / territory group label for organizing lists. */
  publisher_group?: string | null;
  months: PublisherMonthlyRecord[];
}

/** One auxiliary pioneer stint (approved / ended); a publisher may have several per service year or over time. */
export interface AuxiliaryPioneerPeriod {
  approved_on: string | null;
  ended_on: string | null;
}

/** One regular pioneer stint (approved / stopped); an open stint has stopped_on = null. */
export interface RegularPioneerPeriod {
  approved_on: string | null;
  stopped_on: string | null;
}

/** Pioneer milestone dates stored once per publisher (table `publisher_pioneer_profiles`). */
export interface PublisherPioneerProfile {
  publisher_name: string;
  auxiliary_pioneer_periods: AuxiliaryPioneerPeriod[];
  regular_pioneer_periods: RegularPioneerPeriod[];
}

/** Normalizes a row from Supabase (JSON periods, date strings). */
export function normalizePublisherPioneerProfile(
  data: PublisherPioneerProfile | null | undefined
): PublisherPioneerProfile | null {
  if (!data) return null;
  const raw = (data as unknown as { auxiliary_pioneer_periods?: unknown }).auxiliary_pioneer_periods;
  const rawRegular = (data as unknown as { regular_pioneer_periods?: unknown }).regular_pioneer_periods;
  const legacyRegularApproved = (data as unknown as { regular_pioneer_approved_on?: unknown }).regular_pioneer_approved_on;
  const legacyRegularStopped = (data as unknown as { regular_pioneer_stopped_on?: unknown }).regular_pioneer_stopped_on;
  const periods: AuxiliaryPioneerPeriod[] = [];
  const regularPeriods: RegularPioneerPeriod[] = [];
  if (Array.isArray(raw)) {
    for (const p of raw) {
      const o = p as Record<string, unknown>;
      const a = o['approved_on'];
      const e = o['ended_on'];
      periods.push({
        approved_on:
          a != null && String(a).trim() !== ''
            ? String(a).trim().slice(0, 10)
            : null,
        ended_on:
          e != null && String(e).trim() !== ''
            ? String(e).trim().slice(0, 10)
            : null,
      });
    }
  }
  if (Array.isArray(rawRegular)) {
    for (const p of rawRegular) {
      const o = p as Record<string, unknown>;
      const a = o['approved_on'];
      const s = o['stopped_on'];
      regularPeriods.push({
        approved_on:
          a != null && String(a).trim() !== ''
            ? String(a).trim().slice(0, 10)
            : null,
        stopped_on:
          s != null && String(s).trim() !== ''
            ? String(s).trim().slice(0, 10)
            : null,
      });
    }
  } else {
    // Backward compatibility: fold old single regular dates into one period.
    const approved =
      legacyRegularApproved != null && String(legacyRegularApproved).trim() !== ''
        ? String(legacyRegularApproved).trim().slice(0, 10)
        : null;
    const stopped =
      legacyRegularStopped != null && String(legacyRegularStopped).trim() !== ''
        ? String(legacyRegularStopped).trim().slice(0, 10)
        : null;
    if (approved != null || stopped != null) {
      regularPeriods.push({ approved_on: approved, stopped_on: stopped });
    }
  }
  return {
    publisher_name: data.publisher_name,
    auxiliary_pioneer_periods: periods,
    regular_pioneer_periods: regularPeriods,
  };
}

export function emptyPublisherPioneerProfile(publisherName: string): PublisherPioneerProfile {
  return {
    publisher_name: publisherName,
    auxiliary_pioneer_periods: [],
    regular_pioneer_periods: [],
  };
}

const RECORDS_CACHE_PREFIX = 'records:';
const PIONEER_PROFILE_CACHE_PREFIX = 'pioneer-profile:';
const ATTENDANCE_MEETINGS_CACHE_PREFIX = 'attendance-meetings:';

export interface AttendanceMeetingRecord {
  id: string;
  service_year_start: number;
  meeting_date: string;
  meeting_type: 'midweek' | 'weekend';
  attendance: number;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  public readonly client: SupabaseClient | null;

  private readonly _session = signal<Session | null>(null);
  private readonly _user = signal<User | null>(null);
  private sessionInitialized = false;

  private readonly _serviceYear = signal(SupabaseService.defaultServiceYear());

  readonly session = this._session.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => !!this._session());
  readonly userEmail = computed(() => this._user()?.email ?? null);

  /** The currently selected service year start (September). Shared across all pages. */
  readonly serviceYear = this._serviceYear.asReadonly();
  readonly serviceYearLabel = computed(
    () => `${this._serviceYear()}\u2013${this._serviceYear() + 1}`
  );

  setServiceYear(year: number): void {
    this._serviceYear.set(year);
  }

  nextServiceYear(): void {
    const max = SupabaseService.allowedMaxServiceYearStart();
    this._serviceYear.update((y) => (y >= max ? y : y + 1));
  }

  previousServiceYear(): void {
    this._serviceYear.update((y) => y - 1);
  }

  /**
   * Latest service year start (September) that is not in the future.
   * Same rule as the initial default selection.
   */
  static allowedMaxServiceYearStart(): number {
    const now = new Date();
    return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  }

  private static defaultServiceYear(): number {
    return SupabaseService.allowedMaxServiceYearStart();
  }

  constructor(
    private readonly router: Router,
    private readonly cache: CacheService
  ) {
    const url = environment.supabaseUrl;
    const anonKey = environment.supabaseAnonKey;

    this.client = url && anonKey ? createClient(url, anonKey) : null;

    if (!this.client) {
      console.warn(
        'SupabaseService: missing supabaseUrl and/or supabaseAnonKey in environment files.'
      );
      return;
    }

    this.client.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
      this._user.set(session?.user ?? null);
    });
  }

  /**
   * Loads the session from Supabase only once. Subsequent calls return
   * immediately because `onAuthStateChange` keeps signals in sync.
   */
  async ensureSession(): Promise<void> {
    if (this.sessionInitialized || !this.client) return;

    const { data: { session } } = await this.client.auth.getSession();
    this._session.set(session);
    this._user.set(session?.user ?? null);
    this.sessionInitialized = true;
  }

  public signInWithPassword(email: string, password: string) {
    if (!this.client) throw new Error('Supabase client not configured.');
    return this.client.auth.signInWithPassword({ email, password });
  }

  /**
   * Sets a new password for the account with the given email via the
   * `reset-password` Edge Function (service role on the server).
   * Returns an error message string, or null on success.
   */
  public async resetPasswordWithEmail(email: string, newPassword: string): Promise<string | null> {
    if (!this.client) return 'Authentication is not configured yet.';

    const { data, error } = await this.client.functions.invoke<{ ok?: boolean; error?: string }>(
      'reset-password',
      { body: { email: email.trim(), password: newPassword } }
    );

    if (error instanceof FunctionsHttpError) {
      try {
        const body = (await error.context.json()) as { error?: string };
        if (body?.error && typeof body.error === 'string') return body.error;
      } catch {
        /* ignore */
      }
      return 'Could not reset password. Try again.';
    }

    if (error) {
      return error.message || 'Could not reset password.';
    }

    if (data?.error) return data.error;
    if (!data?.ok) return 'Could not reset password.';

    return null;
  }

  public async signOut(): Promise<void> {
    if (!this.client) return;
    await this.client.auth.signOut();
    this._session.set(null);
    this._user.set(null);
    this.sessionInitialized = false;
    this.cache.clear();
    this.router.navigate(['/login']);
  }

  /**
   * Returns cached records if available; otherwise fetches from Supabase
   * and caches the result for 2 minutes.
   */
  public async getPublisherRecordsByServiceYear(serviceYearStart: number): Promise<PublisherRecord[]> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const cacheKey = `${RECORDS_CACHE_PREFIX}${serviceYearStart}`;
    const cached = this.cache.get<PublisherRecord[]>(cacheKey);
    if (cached !== undefined) return cached;

    const records = await this.fetchRecordsFromSupabase(serviceYearStart);
    this.cache.set(cacheKey, records);
    return records;
  }

  /**
   * Finds publisher rows whose name contains `nameContains` (case-insensitive),
   * across **all** service years. Results are ordered by service year (newest first),
   * then publisher name. Does not use the per-year cache.
   */
  public async searchPublisherRecordsAcrossYears(nameContains: string): Promise<PublisherRecord[]> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const trimmed = nameContains.trim();
    if (!trimmed) return [];

    // Avoid ILIKE wildcards in user input
    const sanitized = trimmed.replace(/[%_\\]/g, '');
    if (!sanitized) return [];

    const pattern = `%${sanitized}%`;

    const { data, error } = await this.client
      .from('publisher_records')
      .select('*')
      .ilike('publisher_name', pattern)
      .order('service_year_start', { ascending: false })
      .order('publisher_name', { ascending: true });

    if (error) throw error;
    return (data ?? []) as PublisherRecord[];
  }

  /**
   * All publisher card rows for an exact name, every service year (oldest first).
   * Used for pioneering history; not cached on the per-year records cache.
   */
  public async getPublisherRecordsByPublisherNameExact(
    publisherName: string
  ): Promise<PublisherRecord[]> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const name = publisherName.trim();
    if (!name) return [];

    const { data, error } = await this.client
      .from('publisher_records')
      .select('*')
      .eq('publisher_name', name)
      .order('service_year_start', { ascending: true });

    if (error) throw error;
    return (data ?? []) as PublisherRecord[];
  }

  /**
   * Loads pioneer milestone dates for one publisher name (cached briefly).
   * Returns `null` when no profile row exists yet.
   */
  public async getPioneerProfileByPublisherName(
    publisherName: string
  ): Promise<PublisherPioneerProfile | null> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const name = publisherName.trim();
    if (!name) return null;

    const cacheKey = `${PIONEER_PROFILE_CACHE_PREFIX}${name}`;
    const cached = this.cache.get<PublisherPioneerProfile | null>(cacheKey);
    if (cached !== undefined) return cached;

    const { data, error } = await this.client
      .from('publisher_pioneer_profiles')
      .select('*')
      .eq('publisher_name', name)
      .maybeSingle();

    if (error) throw error;

    const result = normalizePublisherPioneerProfile((data as PublisherPioneerProfile | null) ?? null);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Loads pioneer profiles for many names in one query. Missing names get
   * {@link emptyPublisherPioneerProfile} in the returned map (and `null` is cached per name).
   */
  public async getPioneerProfilesForPublisherNames(
    names: string[]
  ): Promise<Map<string, PublisherPioneerProfile>> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const unique = [...new Set(names.map((n) => n.trim()).filter((n) => n.length > 0))];
    const out = new Map<string, PublisherPioneerProfile>();
    if (unique.length === 0) return out;

    const { data, error } = await this.client
      .from('publisher_pioneer_profiles')
      .select('*')
      .in('publisher_name', unique);

    if (error) throw error;

    const fromDb = new Map(
      ((data ?? []) as PublisherPioneerProfile[]).map((p) => [p.publisher_name, p])
    );

    for (const n of unique) {
      const raw = fromDb.get(n) ?? null;
      const found = normalizePublisherPioneerProfile(raw);
      this.cache.set(`${PIONEER_PROFILE_CACHE_PREFIX}${n}`, found);
      out.set(n, found ?? emptyPublisherPioneerProfile(n));
    }

    return out;
  }

  /**
   * Saves pioneer milestone dates for a publisher. When there are no auxiliary periods
   * and no regular-pioneer periods, deletes the profile row if it exists.
   */
  public async upsertPublisherPioneerProfile(profile: PublisherPioneerProfile): Promise<void> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const name = profile.publisher_name.trim();
    if (!name) throw new Error('Publisher name is required for pioneer profile.');

    const d = (v: string | null | undefined) => (v == null || String(v).trim() === '' ? null : String(v).trim());

    const periods = (profile.auxiliary_pioneer_periods ?? [])
      .map((p) => ({
        approved_on: d(p.approved_on),
        ended_on: d(p.ended_on),
      }))
      .filter((p) => p.approved_on != null || p.ended_on != null);
    const regularPeriods = (profile.regular_pioneer_periods ?? [])
      .map((p) => ({
        approved_on: d(p.approved_on),
        stopped_on: d(p.stopped_on),
      }))
      .filter((p) => p.approved_on != null || p.stopped_on != null);

    const hasAux = periods.length > 0;
    const hasRegular = regularPeriods.length > 0;
    const empty = !hasAux && !hasRegular;

    if (empty) {
      const { error } = await this.client
        .from('publisher_pioneer_profiles')
        .delete()
        .eq('publisher_name', name);

      if (error) throw error;
    } else {
      const { error } = await this.client
        .from('publisher_pioneer_profiles')
        .upsert(
          {
            publisher_name: name,
            auxiliary_pioneer_periods: periods,
            regular_pioneer_periods: regularPeriods,
          },
          { onConflict: 'publisher_name' }
        );

      if (error) {
        // Backward compatibility: older databases may still use single regular date columns.
        if (!this.isMissingColumnError(error, 'regular_pioneer_periods')) {
          throw error;
        }

        const latestRegular = regularPeriods[regularPeriods.length - 1] ?? null;
        const { error: legacyError } = await this.client
          .from('publisher_pioneer_profiles')
          .upsert(
            {
              publisher_name: name,
              auxiliary_pioneer_periods: periods,
              regular_pioneer_approved_on: latestRegular?.approved_on ?? null,
              regular_pioneer_stopped_on: latestRegular?.stopped_on ?? null,
            },
            { onConflict: 'publisher_name' }
          );
        if (legacyError) throw legacyError;
      }
    }

    this.cache.invalidate(`${PIONEER_PROFILE_CACHE_PREFIX}${name}`);
  }

  private isMissingColumnError(error: unknown, column: string): boolean {
    const e = error as { code?: unknown; message?: unknown; details?: unknown };
    const code = String(e?.code ?? '');
    const text = `${String(e?.message ?? '')} ${String(e?.details ?? '')}`.toLowerCase();
    return (
      code === '42703' ||
      code === 'PGRST204' ||
      (text.includes('column') && text.includes(column.toLowerCase()) && text.includes('does not exist'))
    );
  }

  /**
   * Upserts a publisher record, then invalidates and re-fetches the
   * cache for that service year so all pages see fresh data immediately.
   */
  public async upsertPublisherRecord(record: PublisherRecord): Promise<PublisherRecord> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const { data, error } = await this.client
      .from('publisher_records')
      .upsert(record, { onConflict: 'service_year_start,publisher_name' })
      .select('*')
      .single();

    if (error) throw error;

    const cacheKey = `${RECORDS_CACHE_PREFIX}${record.service_year_start}`;
    this.cache.invalidate(cacheKey);

    const freshRecords = await this.fetchRecordsFromSupabase(record.service_year_start);
    this.cache.set(cacheKey, freshRecords);

    return data as PublisherRecord;
  }

  /**
   * Deletes a publisher record by its id, then refreshes the cache
   * for the corresponding service year.
   */
  public async deletePublisherRecord(id: string, serviceYearStart: number): Promise<void> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const { error } = await this.client
      .from('publisher_records')
      .delete()
      .eq('id', id);

    if (error) throw error;

    const cacheKey = `${RECORDS_CACHE_PREFIX}${serviceYearStart}`;
    this.cache.invalidate(cacheKey);
    const fresh = await this.fetchRecordsFromSupabase(serviceYearStart);
    this.cache.set(cacheKey, fresh);
  }

  /**
   * Copies publisher profiles from `sourceYear` into `targetYear` with
   * blank monthly records. Skips publishers that already exist in the target year.
   * Returns the number of publishers copied.
   */
  public async copyPublishersFromYear(sourceYear: number, targetYear: number): Promise<number> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const sourceRecords = await this.fetchRecordsFromSupabase(sourceYear);
    const existingRecords = await this.fetchRecordsFromSupabase(targetYear);
    const existingNames = new Set(existingRecords.map((r) => r.publisher_name));

    const blankMonths: PublisherMonthlyRecord[] = [
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

    const toCopy = sourceRecords.filter((r) => !existingNames.has(r.publisher_name));
    if (toCopy.length === 0) return 0;

    const rows = toCopy.map((r) => ({
      service_year_start: targetYear,
      publisher_name: r.publisher_name,
      date_of_birth: r.date_of_birth,
      date_of_baptism: r.date_of_baptism,
      unbaptized_publisher: !!r.unbaptized_publisher,
      unbaptized_approved_on: r.unbaptized_approved_on ?? null,
      gender: r.gender,
      other_sheep: r.other_sheep,
      anointed: r.anointed,
      elder: r.elder,
      ministerial_servant: r.ministerial_servant,
      regular_pioneer: r.regular_pioneer,
      special_pioneer: r.special_pioneer,
      field_missionary: r.field_missionary,
      publisher_group: r.publisher_group ?? null,
      months: blankMonths,
    }));

    const { error } = await this.client
      .from('publisher_records')
      .insert(rows);

    if (error) throw error;

    this.cache.invalidate(`${RECORDS_CACHE_PREFIX}${targetYear}`);
    const fresh = await this.fetchRecordsFromSupabase(targetYear);
    this.cache.set(`${RECORDS_CACHE_PREFIX}${targetYear}`, fresh);

    return toCopy.length;
  }

  /**
   * Returns per-meeting attendance rows for a service year.
   */
  public async getAttendanceMeetingsByServiceYear(
    serviceYearStart: number
  ): Promise<AttendanceMeetingRecord[]> {
    if (!this.client) throw new Error('Supabase client not configured.');
    // Attendance is frequently edited in-session; read fresh rows to avoid stale UI.
    return this.fetchAttendanceMeetingsFromSupabase(serviceYearStart);
  }

  /**
   * Inserts one attendance meeting row.
   */
  public async insertAttendanceMeeting(
    row: Omit<AttendanceMeetingRecord, 'id'>
  ): Promise<AttendanceMeetingRecord> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const { data, error } = await this.client
      .from('attendance_meetings')
      .insert(row)
      .select('id, service_year_start, meeting_date, meeting_type, attendance')
      .single();

    if (error) throw error;

    const cacheKey = `${ATTENDANCE_MEETINGS_CACHE_PREFIX}${row.service_year_start}`;
    this.cache.invalidate(cacheKey);
    const fresh = await this.fetchAttendanceMeetingsFromSupabase(row.service_year_start);
    this.cache.set(cacheKey, fresh);

    return data as AttendanceMeetingRecord;
  }

  /**
   * Updates one attendance meeting row by id and refreshes cache.
   */
  public async updateAttendanceMeeting(
    id: string,
    serviceYearStart: number,
    updates: Pick<AttendanceMeetingRecord, 'meeting_date' | 'meeting_type' | 'attendance'>
  ): Promise<AttendanceMeetingRecord> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const { data, error } = await this.client
      .from('attendance_meetings')
      .update({
        meeting_date: updates.meeting_date,
        meeting_type: updates.meeting_type,
        attendance: updates.attendance,
      })
      .eq('id', id)
      .select('id, service_year_start, meeting_date, meeting_type, attendance')
      .single();

    if (error) throw error;

    const cacheKey = `${ATTENDANCE_MEETINGS_CACHE_PREFIX}${serviceYearStart}`;
    this.cache.invalidate(cacheKey);
    const fresh = await this.fetchAttendanceMeetingsFromSupabase(serviceYearStart);
    this.cache.set(cacheKey, fresh);

    return data as AttendanceMeetingRecord;
  }

  /**
   * Deletes one attendance meeting row by id and refreshes cache.
   */
  public async deleteAttendanceMeeting(id: string, serviceYearStart: number): Promise<void> {
    if (!this.client) throw new Error('Supabase client not configured.');

    const { error } = await this.client
      .from('attendance_meetings')
      .delete()
      .eq('id', id);

    if (error) throw error;

    const cacheKey = `${ATTENDANCE_MEETINGS_CACHE_PREFIX}${serviceYearStart}`;
    this.cache.invalidate(cacheKey);
    const fresh = await this.fetchAttendanceMeetingsFromSupabase(serviceYearStart);
    this.cache.set(cacheKey, fresh);
  }

  private async fetchRecordsFromSupabase(serviceYearStart: number): Promise<PublisherRecord[]> {
    const { data, error } = await this.client!
      .from('publisher_records')
      .select('*')
      .eq('service_year_start', serviceYearStart)
      .order('publisher_name', { ascending: true });

    if (error) throw error;
    return (data ?? []) as PublisherRecord[];
  }

  private async fetchAttendanceMeetingsFromSupabase(
    serviceYearStart: number
  ): Promise<AttendanceMeetingRecord[]> {
    const { data, error } = await this.client!
      .from('attendance_meetings')
      .select('id, service_year_start, meeting_date, meeting_type, attendance')
      .eq('service_year_start', serviceYearStart)
      .order('meeting_date', { ascending: true });

    if (error) throw error;
    return (data ?? []) as AttendanceMeetingRecord[];
  }
}

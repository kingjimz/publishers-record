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

const RECORDS_CACHE_PREFIX = 'records:';
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

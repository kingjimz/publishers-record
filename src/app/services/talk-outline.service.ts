import { Injectable, inject } from '@angular/core';

import { CacheService } from './cache.service';
import { SupabaseService } from './supabase.service';

export interface TalkOutline {
  id?: string;
  talk_number: number;
  title: string;
  language: string;
  is_active: boolean;
}

/** Language the congregation's S-99 list is maintained in. */
export const OUTLINE_LANGUAGE = 'ilo';

const OUTLINES_CACHE_PREFIX = 'talk-outlines:';
/** Shares the meeting-weeks prefix so saveWeek/deleteWeek invalidation clears it too. */
const USAGE_CACHE_KEY = 'meeting-weeks:outline-usage';

@Injectable({ providedIn: 'root' })
export class TalkOutlineService {
  private readonly supabase = inject(SupabaseService);
  private readonly cache = inject(CacheService);

  private get client() {
    const client = this.supabase.client;
    if (!client) throw new Error('Supabase client not configured.');
    return client;
  }

  /** All outlines for a language, ordered by talk number. Cached briefly. */
  async getOutlines(language = OUTLINE_LANGUAGE): Promise<TalkOutline[]> {
    const cacheKey = `${OUTLINES_CACHE_PREFIX}${language}`;
    const cached = this.cache.get<TalkOutline[]>(cacheKey);
    if (cached !== undefined) return cached;

    const { data, error } = await this.client
      .from('public_talk_outlines')
      .select('*')
      .eq('language', language)
      .order('talk_number', { ascending: true });

    if (error) throw error;
    const outlines = (data ?? []) as TalkOutline[];
    this.cache.set(cacheKey, outlines);
    return outlines;
  }

  /** Adds or updates a single outline (conflict on talk_number + language). */
  async saveOutline(outline: TalkOutline): Promise<TalkOutline> {
    const row = {
      talk_number: outline.talk_number,
      title: outline.title.trim(),
      language: outline.language,
      is_active: outline.is_active,
    };
    const { data, error } = await this.client
      .from('public_talk_outlines')
      .upsert(row, { onConflict: 'talk_number,language' })
      .select('*')
      .single();

    if (error) throw error;
    this.cache.invalidatePrefix(OUTLINES_CACHE_PREFIX);
    return data as TalkOutline;
  }

  async deleteOutline(id: string): Promise<void> {
    const { error } = await this.client.from('public_talk_outlines').delete().eq('id', id);
    if (error) throw error;
    this.cache.invalidatePrefix(OUTLINES_CACHE_PREFIX);
  }

  /**
   * Replaces the whole list for a language with the parsed S-99 upload.
   * Upsert-then-prune: existing numbers are updated in place first, then rows
   * missing from the new list are removed — a failed insert can never leave
   * the library empty.
   */
  async replaceAll(language: string, outlines: { talk_number: number; title: string }[]): Promise<void> {
    if (outlines.length === 0) throw new Error('Nothing to import.');

    const rows = outlines.map((o) => ({
      talk_number: o.talk_number,
      title: o.title.trim(),
      language,
      is_active: true,
    }));

    const { error } = await this.client
      .from('public_talk_outlines')
      .upsert(rows, { onConflict: 'talk_number,language' });

    if (error) throw error;

    const keep = `(${rows.map((r) => r.talk_number).join(',')})`;
    const { error: pruneError } = await this.client
      .from('public_talk_outlines')
      .delete()
      .eq('language', language)
      .not('talk_number', 'in', keep);

    if (pruneError) throw pruneError;
    this.cache.invalidatePrefix(OUTLINES_CACHE_PREFIX);
  }

  /**
   * Most recent date each outline number was given, from scheduled weeks.
   * Drives the "last given" badge in the Tema picker and the manager table.
   */
  async getOutlineUsage(): Promise<Map<number, string>> {
    const cached = this.cache.get<Map<number, string>>(USAGE_CACHE_KEY);
    if (cached !== undefined) return cached;

    const { data, error } = await this.client
      .from('meeting_weeks')
      .select('public_talk_number, weekend_date, week_of')
      .not('public_talk_number', 'is', null);

    if (error) throw error;

    const usage = new Map<number, string>();
    for (const row of (data ?? []) as {
      public_talk_number: number;
      weekend_date: string | null;
      week_of: string;
    }[]) {
      const date = row.weekend_date ?? row.week_of;
      const existing = usage.get(row.public_talk_number);
      if (!existing || date > existing) usage.set(row.public_talk_number, date);
    }

    this.cache.set(USAGE_CACHE_KEY, usage);
    return usage;
  }
}

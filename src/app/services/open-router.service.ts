import { Injectable } from '@angular/core';

import { environment } from '../../environments/environment';
import type { PublisherPioneerProfile, PublisherRecord } from './supabase.service';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function buildRecordPayload(
  record: PublisherRecord,
  pioneerProfile: PublisherPioneerProfile | null | undefined,
  referenceSummary: string
): string {
  return JSON.stringify(
    {
      serviceYear: `${record.service_year_start}\u2013${record.service_year_start + 1}`,
      publisherName: record.publisher_name,
      inactive: !!record.inactive,
      gender: record.gender,
      unbaptizedPublisher: !!record.unbaptized_publisher,
      privileges: {
        elder: !!record.elder,
        ministerialServant: !!record.ministerial_servant,
        regularPioneer: !!record.regular_pioneer,
        specialPioneer: !!record.special_pioneer,
        fieldMissionary: !!record.field_missionary,
      },
      publisherGroup: record.publisher_group ?? null,
      months: (record.months ?? []).map((m) => ({
        month: m.month,
        sharedInMinistry: !!m.sharedInMinistry,
        bibleStudies: m.bibleStudies ?? null,
        auxiliaryPioneer: !!m.auxiliaryPioneer,
        hours: m.hours ?? null,
        remarks: (m.remarks ?? '').trim() || null,
      })),
      pioneerProfile: pioneerProfile
        ? {
            auxiliaryPioneerPeriods: pioneerProfile.auxiliary_pioneer_periods ?? [],
            regularPioneerPeriods: pioneerProfile.regular_pioneer_periods ?? [],
          }
        : null,
      referenceSummaryFromApp: referenceSummary,
    },
    null,
    0
  );
}

@Injectable({ providedIn: 'root' })
export class OpenRouterService {
  /**
   * Returns a short narrative summary. Uses only facts present in the payload.
   * Requires {@link environment.openRouterApiKey} to be set.
   */
  async summarizePublisherServiceYear(
    record: PublisherRecord,
    pioneerProfile: PublisherPioneerProfile | null | undefined,
    referenceSummary: string
  ): Promise<string> {
    const apiKey = environment.openRouterApiKey?.trim();
    if (!apiKey) {
      throw new Error(
        'OpenRouter is not configured: set OPENROUTER_API_KEY in root .env for yarn start/build, or in your host build environment (e.g. Netlify), then rebuild.'
      );
    }

    const model = (environment.openRouterModel ?? 'openrouter/free').trim() || 'openrouter/free';
    const payload = buildRecordPayload(record, pioneerProfile, referenceSummary);

    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://localhost',
        'X-Title': 'Publishers Record',
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        max_tokens: 600,
        messages: [
          {
            role: 'system',
            content:
              'You help secretaries summarize a single publisher’s field ministry card for one service year. ' +
              'Write 2–5 clear sentences in plain English. ' +
              'Use only information supplied in the JSON (including referenceSummaryFromApp, which is already derived from the same data). ' +
              'Do not invent numbers, dates, or privileges. ' +
              'If the record is sparse, describe it briefly in a matter-of-fact way. ' +
              'Tone and ethics: always write with respect for the publisher as a person. ' +
              'Never insult, shame, blame, judge, mock, or use harsh or negative labels about the individual. ' +
              'Even when the card shows low activity, gaps, inactivity, or other difficult facts, keep the wording neutral, dignified, and gently positive—' +
              'frame facts as what the record shows (e.g. “the card indicates…”, “reported…”) without criticizing character or commitment. ' +
              'Do not include markdown headings or bullet lists; paragraphs only.',
          },
          {
            role: 'user',
            content:
              'Summarize this publisher record for the congregation file. ' +
              'Keep the tone respectful and constructive; do not use wording that could embarrass or demean the publisher.\n\n' +
              payload,
          },
        ],
      }),
    });

    const rawText = await res.text();
    if (!res.ok) {
      let detail = rawText.slice(0, 500);
      try {
        const parsed = JSON.parse(rawText) as { error?: { message?: string } };
        if (parsed?.error?.message) detail = parsed.error.message;
      } catch {
        /* use raw slice */
      }
      throw new Error(`OpenRouter request failed (${res.status}): ${detail}`);
    }

    let data: unknown;
    try {
      data = JSON.parse(rawText) as unknown;
    } catch {
      throw new Error('OpenRouter returned invalid JSON.');
    }

    const content = extractAssistantText(data);
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('OpenRouter returned an empty summary.');
    }
    return trimmed;
  }
}

function extractAssistantText(data: unknown): string {
  const root = data as {
    choices?: { message?: { content?: string | null } }[];
  };
  const first = root.choices?.[0]?.message?.content;
  if (typeof first === 'string') return first;
  return '';
}

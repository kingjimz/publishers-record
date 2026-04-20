import { Injectable } from '@angular/core';

import { environment } from '../../environments/environment';
import type { PublisherPioneerProfile, PublisherRecord } from './supabase.service';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** ISO date part YYYY-MM-DD, or null when missing / unusable. */
function isoDatePart(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  if (!t) return null;
  return t.length >= 10 ? t.slice(0, 10) : t;
}

/** Distinct regular-pioneer `approved_on` dates from the pioneer profile (YYYY-MM-DD), oldest first. */
function regularPioneerApprovedDates(
  pioneerProfile: PublisherPioneerProfile | null | undefined
): string[] {
  const periods = pioneerProfile?.regular_pioneer_periods ?? [];
  const out: string[] = [];
  for (const p of periods) {
    const a = isoDatePart(p.approved_on ?? undefined);
    if (a) out.push(a);
  }
  return [...new Set(out)].sort((x, y) => x.localeCompare(y));
}

function buildRecordPayload(
  record: PublisherRecord,
  pioneerProfile: PublisherPioneerProfile | null | undefined,
  referenceSummary: string
): string {
  const payload: Record<string, unknown> = {
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
  };

  const dob = isoDatePart(record.date_of_birth);
  if (dob) payload['dateOfBirth'] = dob;

  const baptism = isoDatePart(record.date_of_baptism);
  if (baptism) payload['dateOfBaptism'] = baptism;

  const regApproved = regularPioneerApprovedDates(pioneerProfile);
  if (regApproved.length > 0) payload['regularPioneerApprovedDates'] = regApproved;

  return JSON.stringify(payload, null, 0);
}

function parseOpenRouterApiErrorMessage(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string } };
    const m = parsed?.error?.message;
    if (typeof m === 'string' && m.trim()) return m.trim();
  } catch {
    /* use raw slice */
  }
  return rawText.slice(0, 500).trim();
}

/** Maps provider errors to concise copy for congregation-facing UI and toasts. */
function formatOpenRouterRequestError(httpStatus: number, apiMessage: string): string {
  const lower = (apiMessage || '').toLowerCase();

  if (httpStatus === 429) {
    if (lower.includes('free-models-per-day')) {
      return (
        'The daily allowance for free AI models on this OpenRouter account has been used. ' +
        'It normally resets at midnight UTC, or you can add credits or configure a paid model to continue sooner.'
      );
    }
    if (
      lower.includes('rate limit') ||
      lower.includes('too many requests') ||
      lower.includes('requests per minute') ||
      lower.includes('tokens per minute')
    ) {
      return (
        'The AI service is temporarily limiting traffic. Please wait a few minutes and try the summary again.'
      );
    }
    return 'Too many requests reached the AI service in a short period. Please wait briefly and try again.';
  }

  if (httpStatus === 402) {
    return (
      'OpenRouter requires an active balance or payment method for this model. ' +
      'Please review billing in your OpenRouter account, or choose a free model if appropriate.'
    );
  }

  if (httpStatus === 401) {
    return (
      'The OpenRouter API key was not accepted. Confirm OPENROUTER_API_KEY in your environment, then rebuild or redeploy.'
    );
  }

  if (httpStatus === 400) {
    return (
      'The AI service could not process this request. Check that OPENROUTER_MODEL is a valid model identifier.'
    );
  }

  if (httpStatus === 503 || httpStatus === 502) {
    return 'The AI service is temporarily unavailable. Please try again shortly.';
  }

  if (httpStatus >= 500) {
    return 'The AI service encountered a temporary error. Please try again in a few minutes.';
  }

  return 'The AI summary could not be generated. Please try again later, or verify your OpenRouter account and model settings.';
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
              'JSON may include dateOfBirth and dateOfBaptism (ISO YYYY-MM-DD) only when known; if a field is omitted, treat it as unknown and never mention or guess it. ' +
              'When dateOfBirth appears, it must be stated in the first sentence. When dateOfBaptism appears, it must be stated in the first sentence (together with dateOfBirth when both exist). ' +
              'When regularPioneerApprovedDates appears (array of approval dates), you may mention it where it fits; if omitted, say nothing about regular pioneer approval dates. ' +
              'Do not include markdown headings or bullet lists; paragraphs only.',
          },
          {
            role: 'user',
            content:
              'Summarize this publisher record for the congregation file. ' +
              'First sentence: if dateOfBirth and/or dateOfBaptism exist in the JSON, include each present value there in natural wording; if neither key exists, start without birth or baptism. ' +
              'Never invent birth or baptism dates. ' +
              'Keep the tone respectful and constructive; do not use wording that could embarrass or demean the publisher.\n\n' +
              payload,
          },
        ],
      }),
    });

    const rawText = await res.text();
    if (!res.ok) {
      const apiMessage = parseOpenRouterApiErrorMessage(rawText);
      throw new Error(formatOpenRouterRequestError(res.status, apiMessage));
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

import {
  PublisherMonthlyRecord,
  PublisherPioneerProfile,
  PublisherRecord,
} from '../services/supabase.service';

/** e.g. September 1, 2025 (no leading zero on day). */
function formatTemplateDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const raw = String(dateStr).trim();
  const datePart = raw.length >= 10 ? raw.slice(0, 10) : raw;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return raw;
  const year = match[1];
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  if (month < 1 || month > 12 || !Number.isFinite(day)) return raw;
  return `${monthNames[month - 1]} ${day}, ${year}`;
}

function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function capitalizeWord(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** he / she / they — from gender when known, otherwise they. */
function subjectPronoun(record: PublisherRecord): 'he' | 'she' | 'they' {
  if (record.gender === 'male') return 'he';
  if (record.gender === 'female') return 'she';
  return 'they';
}

/** Congregation privileges checked on the publisher card for this service year. */
function privilegeTitles(record: PublisherRecord): string[] {
  const titles: string[] = [];
  if (record.elder) titles.push('an elder');
  if (record.ministerial_servant) titles.push('a ministerial servant');
  if (record.regular_pioneer) titles.push('a regular pioneer');
  if (record.special_pioneer) titles.push('a special pioneer');
  if (record.field_missionary) titles.push('a field missionary');
  return titles;
}

/** Only when at least one privilege is checked; empty string if none (omitted from summary). */
function buildPrivilegeSentence(record: PublisherRecord): string {
  const pro = subjectPronoun(record);
  const Pro = capitalizeWord(pro);
  const titles = privilegeTitles(record);
  if (titles.length === 0) return '';
  const be = pro === 'they' ? 'are' : 'is';
  return `${Pro} ${be} recorded for this service year as ${joinWithAnd(titles)}.`;
}

const SERVICE_YEAR_MONTHS = 12;

function aggregateMonths(months: PublisherMonthlyRecord[] | undefined): {
  ministryMonths: number;
  bibleStudiesSum: number;
  /** Sum of monthly Bible study counts divided by 12 (service year). */
  averageBibleStudiesPerMonth: number;
  auxMonths: number;
  totalHours: number;
  remarkMonths: string[];
} {
  const list = months ?? [];
  let ministryMonths = 0;
  let bibleStudiesSum = 0;
  let auxMonths = 0;
  let totalHours = 0;
  const remarkMonths: string[] = [];
  for (const m of list) {
    // Count as shared in ministry if the ministry column is checked or auxiliary pioneer is
    // (auxiliary pioneer implies sharing in ministry for that month).
    if (m.sharedInMinistry || m.auxiliaryPioneer) ministryMonths += 1;
    const bs = m.bibleStudies;
    if (bs != null && Number.isFinite(Number(bs))) bibleStudiesSum += Number(bs);
    if (m.auxiliaryPioneer) auxMonths += 1;
    const h = m.hours;
    if (h != null && Number.isFinite(Number(h))) totalHours += Number(h);
    if (m.remarks?.trim()) remarkMonths.push(m.month);
  }
  const averageBibleStudiesPerMonth = bibleStudiesSum / SERVICE_YEAR_MONTHS;
  return { ministryMonths, bibleStudiesSum, averageBibleStudiesPerMonth, auxMonths, totalHours, remarkMonths };
}

/** Display average with up to two decimal places, no trailing zeros (e.g. 2, 1.5, 0.08). */
function formatBibleStudiesAverage(avg: number): string {
  if (!Number.isFinite(avg) || avg <= 0) return '0';
  const rounded = Math.round(avg * 100) / 100;
  return String(parseFloat(rounded.toFixed(2)));
}

function sortPeriodsByApprovedOn<T extends { approved_on?: string | null }>(periods: T[]): T[] {
  return [...periods].sort((a, b) => {
    const aa = String(a.approved_on ?? '').trim().slice(0, 10);
    const bb = String(b.approved_on ?? '').trim().slice(0, 10);
    if (!aa && !bb) return 0;
    if (!aa) return 1;
    if (!bb) return -1;
    return aa.localeCompare(bb);
  });
}

/** One auxiliary stint: first / second / further use different wording (He/She/They). */
function sentenceAuxiliaryPioneering(
  Pro: string,
  index: number,
  approved: string | null,
  ended: string | null
): string {
  const a = approved?.trim() ? formatTemplateDate(approved) : '';
  const e = ended?.trim() ? formatTemplateDate(ended) : '';
  if (!a && !e) {
    return `${Pro} has an auxiliary pioneer period with missing dates on file.`;
  }
  if (!a && e) {
    return `${Pro} ended an auxiliary pioneer assignment on ${e} (start date not recorded).`;
  }
  if (index === 0) {
    if (e) {
      return `${Pro} started serving as an auxiliary pioneer on ${a}, and ended on ${e}.`;
    }
    return `${Pro} started serving as an auxiliary pioneer on ${a}, with no end date recorded.`;
  }
  if (index === 1) {
    if (e) {
      return `${Pro} resumed serving on ${a}, and ended on ${e}.`;
    }
    return `${Pro} resumed serving on ${a}, with no end date recorded.`;
  }
  if (e) {
    return `${Pro} served again from ${a}, to ${e}.`;
  }
  return `${Pro} served again starting on ${a}, with no end date recorded.`;
}

function sentenceRegularPioneering(
  Pro: string,
  index: number,
  approved: string | null,
  stopped: string | null
): string {
  const a = approved?.trim() ? formatTemplateDate(approved) : '';
  const s = stopped?.trim() ? formatTemplateDate(stopped) : '';
  if (!a && !s) {
    return `${Pro} has a regular pioneer period with missing dates on file.`;
  }
  if (!a && s) {
    return `${Pro} stopped serving as a regular pioneer on ${s} (approval date not recorded).`;
  }
  if (index === 0) {
    if (s) {
      return `${Pro} started serving as a regular pioneer on ${a}, and stopped on ${s}.`;
    }
    return `${Pro} started serving as a regular pioneer on ${a}, with service still in progress.`;
  }
  if (index === 1) {
    if (s) {
      return `${Pro} resumed serving as a regular pioneer on ${a}, and stopped on ${s}.`;
    }
    return `${Pro} resumed serving as a regular pioneer on ${a}, with service still in progress.`;
  }
  if (s) {
    return `${Pro} served again as a regular pioneer from ${a}, to ${s}.`;
  }
  return `${Pro} served again as a regular pioneer starting on ${a}, with service still in progress.`;
}

function buildPioneeringHistoryParagraph(
  profile: PublisherPioneerProfile | null | undefined,
  record: PublisherRecord
): string {
  if (!profile) {
    return 'Pioneering history: no pioneer profile is stored for this publisher yet.';
  }

  const pro = subjectPronoun(record);
  const Pro = capitalizeWord(pro);

  const aux = sortPeriodsByApprovedOn(profile.auxiliary_pioneer_periods ?? []);
  const reg = sortPeriodsByApprovedOn(profile.regular_pioneer_periods ?? []);

  if (aux.length === 0 && reg.length === 0) {
    return 'Pioneering history: no auxiliary or regular pioneer periods are recorded on the pioneer profile.';
  }

  const segments: string[] = ['Pioneering history:'];

  if (aux.length > 0) {
    for (let i = 0; i < aux.length; i++) {
      const p = aux[i]!;
      segments.push(sentenceAuxiliaryPioneering(Pro, i, p.approved_on, p.ended_on));
    }
  } else {
    segments.push('No auxiliary pioneer periods are on file.');
  }

  if (reg.length > 0) {
    for (let i = 0; i < reg.length; i++) {
      const p = reg[i]!;
      segments.push(sentenceRegularPioneering(Pro, i, p.approved_on, p.stopped_on));
    }
  } else {
    segments.push('No regular pioneer periods are on file.');
  }

  return segments.join(' ');
}

/** Opening line for the service year: only clauses with a value greater than zero. */
function buildActivityStatsSentence(name: string, agg: ReturnType<typeof aggregateMonths>): string {
  const parts: string[] = [];
  if (agg.ministryMonths > 0) {
    parts.push(
      agg.ministryMonths === 1
        ? 'shared in the ministry during 1 month'
        : `shared in the ministry during ${agg.ministryMonths} months`
    );
  }
  if (agg.averageBibleStudiesPerMonth > 0) {
    parts.push(
      `reported an average of ${formatBibleStudiesAverage(agg.averageBibleStudiesPerMonth)} Bible studies per month`
    );
  }
  if (agg.auxMonths > 0) {
    parts.push(
      agg.auxMonths === 1
        ? 'served as an auxiliary pioneer for 1 month'
        : `served as an auxiliary pioneer for ${agg.auxMonths} months`
    );
  }
  if (agg.totalHours > 0) {
    parts.push(
      agg.totalHours === 1
        ? 'logged a total of 1 field service hour'
        : `logged a total of ${agg.totalHours} field service hours`
    );
  }
  if (parts.length === 0) {
    return `Across the 12 service months, ${name} has no ministry participation, Bible studies, auxiliary pioneer months, or field service hours recorded above zero on the card.`;
  }
  return `Across the 12 service months, ${name} ${joinWithAnd(parts)}.`;
}

/** Set to true to append the pioneering history paragraph (after a line break). */
const INCLUDE_PIONEERING_HISTORY_IN_SUMMARY = false;

/**
 * Fixed grammar: named publisher, 12-month activity (Bible studies as monthly average),
 * congregation privileges (he/she/they + elder / MS / pioneer designations), and remarks.
 * Pioneering history is optional (see {@link INCLUDE_PIONEERING_HISTORY_IN_SUMMARY}).
 */
export function buildPublisherServiceYearSummaryParagraph(
  record: PublisherRecord,
  pioneerProfile?: PublisherPioneerProfile | null
): string {
  const name = (record.publisher_name ?? '').trim() || 'This publisher';
  const agg = aggregateMonths(record.months);

  const stats = buildActivityStatsSentence(name, agg);

  const privilege = buildPrivilegeSentence(record);

  const remarks =
    agg.remarkMonths.length > 0
      ? `Remarks were recorded for ${joinWithAnd(agg.remarkMonths)}.`
      : '';

  const firstBlock = [stats, privilege, remarks].filter((s) => s.length > 0).join(' ');

  if (!INCLUDE_PIONEERING_HISTORY_IN_SUMMARY) {
    return firstBlock;
  }

  const pioneer = buildPioneeringHistoryParagraph(pioneerProfile ?? null, record);
  return `${firstBlock}\n\n${pioneer}`;
}

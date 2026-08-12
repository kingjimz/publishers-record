import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Fetches the weekly meeting program from wol.jw.org and returns it as
// structured JSON for the Meeting Scheduler.
//
// The meetings URL (/wol/meetings/{year}/{week}) is a JavaScript shell, but it
// links to the two server-rendered documents for the week: the Meeting Workbook
// week (class "pub-mwb") and the Watchtower study article (class "pub-w").
//
// Parsing is language-aware: the three program sections are located by their
// language-independent icon classes (dc-icon--gem / --wheat / --sheep), part
// titles are numbered headings ("1. Title") with the duration on a nearby line
// ("(10 min.)"), and per-language keywords refine part types. A hard failure
// returns an error and the app falls back to manual entry.

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

interface LanguageConfig {
  /** URL path segment, e.g. wol.jw.org/{path}/wol/... */
  path: string;
  rsconf: string;
  lib: string;
  /** Word before song numbers, e.g. "Song 124" / "Kanta 124". */
  songWord: string;
  /** Ministry part title keywords that mark a student talk (no assistant). */
  studentTalkKeywords: string[];
  /** Keywords that veto the student-talk match (e.g. "conversation"). */
  studentTalkExclude: string[];
  /** Living-section title keywords for the Congregation Bible Study. */
  cbsKeywords: string[];
  /** Living-section title keywords for a circuit overseer service talk. */
  serviceTalkKeywords: string[];
}

const LANGUAGES: Record<string, LanguageConfig> = {
  en: {
    path: "en",
    rsconf: "r1",
    lib: "lp-e",
    songWord: "Song",
    studentTalkKeywords: ["talk"],
    studentTalkExclude: ["conversation"],
    cbsKeywords: ["congregation bible study"],
    serviceTalkKeywords: ["service talk"],
  },
  ilo: {
    path: "ilo",
    rsconf: "r115",
    lib: "lp-il",
    songWord: "Kanta",
    studentTalkKeywords: ["palawag"],
    studentTalkExclude: [],
    cbsKeywords: ["panagadal ti kongregasion iti biblia"],
    serviceTalkKeywords: ["circuit overseer", "para iti serbisio"],
  },
};

type PartType =
  | "talk"
  | "spiritual_gems"
  | "bible_reading"
  | "student_demo"
  | "student_talk"
  | "living_talk"
  | "cbs"
  | "service_talk"
  | "other";

type Section = "treasures" | "ministry" | "living";

interface ProgramPart {
  title: string;
  minutes: number | null;
  partType: PartType;
  /** All-caps workbook setting after the minutes, e.g. "HOUSE TO HOUSE" / "PANAGBALAYBALAY". */
  setting: string | null;
}

/**
 * Extracts the setting phrase that follows the duration, e.g.
 * "(4 min.) PANAGBALAYBALAY. Kalpasan..." -> "PANAGBALAYBALAY".
 * Only all-caps phrases qualify; parts without a setting continue in sentence case.
 */
function extractSetting(afterMinutes: string): string | null {
  const match = afterMinutes.match(/^\s*([A-ZÀ-ÞĀ-Ž][A-ZÀ-ÞĀ-Ž\s\-']{2,60}?)\s*\./u);
  if (!match) return null;
  const phrase = match[1].replace(/\s+/g, " ").trim();
  if (phrase !== phrase.toUpperCase()) return null;
  return phrase;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const year = Number(body.year);
    const week = Number(body.week);
    const locale = typeof body.locale === "string" ? body.locale : "en";
    const lang = LANGUAGES[locale];

    if (!lang) {
      return json({ error: "Unsupported language." }, 400);
    }
    if (!Number.isInteger(year) || year < 2016 || year > 2100) {
      return json({ error: "Invalid year." }, 400);
    }
    if (!Number.isInteger(week) || week < 1 || week > 53) {
      return json({ error: "Invalid week number." }, 400);
    }

    const base = `https://wol.jw.org/${lang.path}/wol`;
    const shell = await fetchText(`${base}/meetings/${lang.rsconf}/${lang.lib}/${year}/${week}`);
    if (!shell.ok) {
      const error = `wol.jw.org responded with ${shell.status}.`;
      await logImport(year, week, "error", `${locale}: ${error}`);
      return json({ error }, 502);
    }

    // Distinct week documents linked from the shell (workbook week + WT article).
    const docPattern = new RegExp(
      `href="/${lang.path}/wol/d/${lang.rsconf}/${lang.lib}/(\\d+)"`,
      "g"
    );
    const docIds = [...new Set([...shell.text.matchAll(docPattern)].map((m) => m[1]))].slice(0, 4);

    if (docIds.length === 0) {
      await logImport(year, week, "error", `${locale}: no meeting documents found.`);
      return json({ error: "No meeting documents found for that week." }, 404);
    }

    let workbookHtml: string | null = null;
    let watchtowerHtml: string | null = null;

    for (const docId of docIds) {
      const doc = await fetchText(`${base}/d/${lang.rsconf}/${lang.lib}/${docId}`);
      if (!doc.ok) continue;
      if (!workbookHtml && /class="[^"]*\bpub-mwb\b/.test(doc.text)) {
        workbookHtml = doc.text;
      } else if (!watchtowerHtml && /class="[^"]*\bpub-w\b/.test(doc.text)) {
        watchtowerHtml = doc.text;
      }
      if (workbookHtml && watchtowerHtml) break;
    }

    if (!workbookHtml) {
      await logImport(year, week, "error", `${locale}: no Meeting Workbook document found.`);
      return json({ error: "No Meeting Workbook document found for that week." }, 404);
    }

    const program = parseWorkbook(workbookHtml, lang);
    program.wtArticleTitle = watchtowerHtml ? extractHeading(watchtowerHtml) : null;

    if (
      program.treasures.length === 0 &&
      program.ministry.length === 0 &&
      program.living.length === 0
    ) {
      await logImport(year, week, "error", `${locale}: no program parts found.`);
      return json({ error: "No program parts found for that week." }, 404);
    }

    await logImport(year, week, "success", locale);
    return json(program as unknown as Record<string, unknown>, 200);
  } catch (e) {
    console.error("fetch-meeting-program:", e);
    return json({ error: "Could not fetch the meeting program." }, 500);
  }
});

/** Records one import call for in-app usage monitoring; never fails the request. */
async function logImport(
  year: number,
  week: number,
  status: "success" | "error",
  detail: string | null
): Promise<void> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return;

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await admin.from("meeting_import_logs").insert({ year, week, status, detail });
  } catch (e) {
    console.error("fetch-meeting-program logImport:", e);
  }
}

async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(url, { headers: FETCH_HEADERS });
  const text = response.ok ? await response.text() : "";
  return { ok: response.ok, status: response.status, text };
}

/** First <h1> text of a document (the Watchtower study article title). */
function extractHeading(html: string): string | null {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) return null;
  const title = decodeEntities(match[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return title || null;
}

/** Strips markup while preserving block boundaries as line breaks. */
function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(\/p|\/h[1-6]|\/li|\/div|br\s*\/?)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "’")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&mdash;|&ndash;/g, "-")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function parseWorkbook(html: string, lang: LanguageConfig) {
  // Weekly Bible reading: the header's <h2> link, e.g. "JEREMIAH 24-25".
  let weeklyBibleReading: string | null = null;
  const headerMatch = html.match(/<header>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i);
  if (headerMatch) {
    const reading = decodeEntities(headerMatch[1].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (reading) weeklyBibleReading = reading;
  }

  // The three sections are anchored by language-independent icon classes.
  const gem = html.indexOf("dc-icon--gem");
  const wheat = html.indexOf("dc-icon--wheat");
  const sheep = html.indexOf("dc-icon--sheep");

  const segments: { section: Section; html: string }[] = [];
  if (gem !== -1 && wheat !== -1 && sheep !== -1 && gem < wheat && wheat < sheep) {
    segments.push({ section: "treasures", html: html.slice(gem, wheat) });
    segments.push({ section: "ministry", html: html.slice(wheat, sheep) });
    segments.push({ section: "living", html: html.slice(sheep) });
  }

  const treasures: ProgramPart[] = [];
  const ministry: ProgramPart[] = [];
  const living: ProgramPart[] = [];

  const partPattern = /^(\d+)\.\s+(.+)$/;
  const inlineMinutes = /\((\d+)\s*min/i;
  const leadingMinutes = /^\((\d+)\s*min/i;

  for (const segment of segments) {
    const lines = htmlToLines(segment.html);
    const target =
      segment.section === "treasures" ? treasures : segment.section === "ministry" ? ministry : living;

    for (let i = 0; i < lines.length; i++) {
      const part = lines[i].match(partPattern);
      if (!part) continue;

      let title = part[2].trim();
      let minutes: number | null = null;
      let setting: string | null = null;

      const inline = title.match(inlineMinutes);
      if (inline) {
        minutes = Number(inline[1]);
        const afterInline = title.slice((inline.index ?? 0) + inline[0].length).replace(/^\)?/, "");
        setting = extractSetting(afterInline.replace(/^\s*\)\s*/, ""));
        title = title.replace(inlineMinutes, "").replace(/\s+/g, " ").trim();
      } else {
        for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
          const ahead = lines[j].match(leadingMinutes);
          if (ahead) {
            minutes = Number(ahead[1]);
            const closeParen = lines[j].indexOf(")");
            if (closeParen !== -1) {
              setting = extractSetting(lines[j].slice(closeParen + 1));
            }
            break;
          }
          if (partPattern.test(lines[j])) break;
        }
      }

      target.push({
        title,
        minutes: Number.isFinite(minutes ?? NaN) ? minutes : null,
        partType: guessPartType(segment.section, title, target.length, lang),
        setting,
      });
    }
  }

  // Songs (opening / middle / closing) from the full document, in order.
  const songs: (number | null)[] = [];
  const songPattern = new RegExp(`\\b${lang.songWord}\\s+(\\d+)\\b`, "gi");
  for (const match of html.replace(/<[^>]+>/g, " ").matchAll(songPattern)) {
    if (songs.length >= 3) break;
    songs.push(Number(match[1]));
  }
  while (songs.length < 3) songs.push(null);

  return {
    weeklyBibleReading,
    songs,
    treasures,
    ministry,
    living,
    wtArticleTitle: null as string | null,
  };
}

function guessPartType(
  section: Section,
  title: string,
  indexInSection: number,
  lang: LanguageConfig
): PartType {
  const t = title.toLowerCase();

  if (section === "treasures") {
    // The Treasures section has a fixed shape in every language:
    // talk, Spiritual Gems, Bible Reading.
    if (indexInSection === 0) return "talk";
    if (indexInSection === 1) return "spiritual_gems";
    if (indexInSection === 2) return "bible_reading";
    return "other";
  }

  if (section === "ministry") {
    const isTalk =
      lang.studentTalkKeywords.some((k) => t.includes(k)) &&
      !lang.studentTalkExclude.some((k) => t.includes(k));
    return isTalk ? "student_talk" : "student_demo";
  }

  if (lang.cbsKeywords.some((k) => t.includes(k))) return "cbs";
  if (lang.serviceTalkKeywords.some((k) => t.includes(k))) return "service_talk";
  return "living_talk";
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

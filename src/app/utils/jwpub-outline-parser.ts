/**
 * Parser for the public talk outline publication distributed as a .jwpub file.
 *
 * A .jwpub is a zip archive holding a `manifest.json` and a `contents` entry,
 * which is itself a zip containing an SQLite database. Each talk outline is a
 * row in the `Document` table whose title columns are stored in PLAINTEXT —
 * only the document body (`Content`) is encrypted, and this parser never
 * touches it. Talk number + theme come from the title columns alone.
 *
 * Splitting mirrors the S-99 PDF parser: `extractOutlinesFromDocuments` is a
 * pure, testable function; `parseJwpubOutlines` does the lazy-loaded zip and
 * SQLite work (fflate + sql.js, with the wasm served from /assets).
 */

import { ParseResult, finalizeOutlines } from './s99-outline-parser';

/** Title columns of one Document row; whichever the schema version provides. */
export interface JwpubDocumentRow {
  title: string | null;
  tocTitle: string | null;
  contextTitle: string | null;
  featureTitle: string | null;
}

/** "1. Theme" / "1) Theme" at the start of a title. */
const LEADING_NUMBER = /^\s*(\d{1,3})[.)]?\s+(.+)$/;
/** "No. 12" / "Blg. 12" / "(No. 12)" anywhere in a title column. */
const LABELED_NUMBER = /\(?\s*(?:no|blg|num)\.?\s*(\d{1,3})\s*\)?/i;

function candidateStrings(row: JwpubDocumentRow): string[] {
  return [row.title, row.tocTitle, row.contextTitle, row.featureTitle]
    .map((s) => s?.trim() ?? '')
    .filter((s) => s.length > 0);
}

/** Best display title for a row, with any leading talk number stripped. */
function cleanTitle(row: JwpubDocumentRow): string {
  const raw = row.title?.trim() || row.tocTitle?.trim() || row.contextTitle?.trim() || '';
  const leading = raw.match(LEADING_NUMBER);
  return (leading ? leading[2] : raw).replace(/\s+/g, ' ').trim();
}

function talkNumberOf(row: JwpubDocumentRow): number | null {
  for (const candidate of candidateStrings(row)) {
    const leading = candidate.match(LEADING_NUMBER);
    if (leading) return Number(leading[1]);
  }
  for (const candidate of candidateStrings(row)) {
    const labeled = candidate.match(LABELED_NUMBER);
    if (labeled) return Number(labeled[1]);
  }
  return null;
}

/**
 * Turns Document rows into outlines. Rows without an extractable talk number
 * (cover, index, letter pages) are skipped with a warning; duplicates keep the
 * first title, matching the PDF parser's behavior.
 */
export function extractOutlinesFromDocuments(rows: JwpubDocumentRow[]): ParseResult {
  const byNumber = new Map<number, string>();
  const warnings: string[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    const talkNumber = talkNumberOf(row);
    const title = cleanTitle(row);
    if (talkNumber === null || talkNumber < 1 || !title) {
      if (title) skipped.push(title);
      continue;
    }
    if (byNumber.has(talkNumber)) {
      warnings.push(`Talk ${talkNumber} appears more than once; kept the first title.`);
      continue;
    }
    byNumber.set(talkNumber, title);
  }

  if (byNumber.size === 0) {
    warnings.push(
      'No talk numbers found in the document titles. Is this the public talk outlines publication?'
    );
  } else if (skipped.length > 0) {
    const shown = skipped.slice(0, 3).map((t) => `"${t}"`).join(', ');
    warnings.push(
      `Skipped ${skipped.length} document(s) without a talk number (front matter or index): ${shown}${skipped.length > 3 ? ', …' : ''}.`
    );
  }

  return finalizeOutlines(byNumber, warnings);
}

/** Loads sql.js with its wasm served from the app's assets (see angular.json). */
async function loadSqlJs() {
  const initSqlJs = (await import('sql.js')).default;
  return initSqlJs({ locateFile: (file) => `assets/${file}` });
}

/**
 * Extracts the Document title rows from a .jwpub file. Reads only plaintext
 * metadata; the encrypted document bodies are never opened.
 */
export async function parseJwpubOutlines(file: File): Promise<ParseResult> {
  const { unzipSync } = await import('fflate');

  let outer: Record<string, Uint8Array>;
  try {
    outer = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('Could not open the file. Is it a valid .jwpub?');
  }

  const contents = outer['contents'];
  if (!contents) throw new Error('Not a jwpub file: no "contents" archive inside.');

  let inner: Record<string, Uint8Array>;
  try {
    inner = unzipSync(contents);
  } catch {
    throw new Error('Could not open the jwpub contents archive.');
  }

  const dbName = Object.keys(inner).find((name) => name.toLowerCase().endsWith('.db'));
  if (!dbName) throw new Error('No publication database found inside the jwpub file.');

  const SQL = await loadSqlJs();
  const db = new SQL.Database(inner[dbName]);
  try {
    const result = db.exec('SELECT * FROM Document');
    if (result.length === 0) return extractOutlinesFromDocuments([]);

    const { columns, values } = result[0];
    const columnIndex = new Map(columns.map((name, i) => [name.toLowerCase(), i]));
    const text = (rowValues: unknown[], column: string): string | null => {
      const index = columnIndex.get(column);
      if (index === undefined) return null;
      const value = rowValues[index];
      return typeof value === 'string' ? value : null;
    };

    const rows: JwpubDocumentRow[] = values.map((rowValues) => ({
      title: text(rowValues, 'title'),
      tocTitle: text(rowValues, 'toctitle'),
      contextTitle: text(rowValues, 'contexttitle'),
      featureTitle: text(rowValues, 'featuretitle'),
    }));

    return extractOutlinesFromDocuments(rows);
  } catch (err) {
    if (err instanceof Error && /no such table/i.test(err.message)) {
      throw new Error('The jwpub database has no Document table.');
    }
    throw err;
  } finally {
    db.close();
  }
}

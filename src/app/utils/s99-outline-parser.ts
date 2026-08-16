/**
 * Parser for the S-99 "List of Public Talk Outlines" PDF.
 *
 * The heavy lifting is split into pure functions (testable without pdf.js):
 * `groupTextItemsIntoLines` rebuilds reading-order lines from positioned text
 * items, handling one- and two-column layouts, and `parseOutlineLines` turns
 * those lines into numbered outlines with wrap handling and warnings.
 * `extractPdfLines` is the only pdf.js-aware piece and is lazy-loaded.
 */

export interface PdfTextItem {
  str: string;
  /** Horizontal position (pt) of the item's left edge. */
  x: number;
  /** Vertical position (pt); PDF space, larger = higher on the page. */
  y: number;
}

export interface ParsedOutline {
  talk_number: number;
  title: string;
}

export interface ParseResult {
  outlines: ParsedOutline[];
  warnings: string[];
}

/** Items on the same visual row when their baselines are within this many points. */
const ROW_TOLERANCE = 2.5;
/** A horizontal jump this large inside a row marks a column boundary. */
const COLUMN_GAP = 40;
/** Segments whose start x is within this range belong to the same column. */
const COLUMN_TOLERANCE = 60;

interface Segment {
  x: number;
  y: number;
  text: string;
}

/**
 * Rebuilds text lines in reading order from positioned page items.
 * Items are grouped into visual rows by y, rows are split into segments at
 * large horizontal gaps (two-column layouts), segments are clustered into
 * columns by their start x, and each column is emitted top-to-bottom —
 * so a wrapped title stays adjacent to its outline even in column layouts.
 */
export function groupTextItemsIntoLines(items: PdfTextItem[]): string[] {
  const nonEmpty = items.filter((item) => item.str.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  // Group into rows: sort by y descending (top of page first), then x.
  const sorted = [...nonEmpty].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - item.y) <= ROW_TOLERANCE) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }

  // Split each row into segments at big horizontal gaps.
  const segments: Segment[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let current: Segment | null = null;
    let lastEndX = 0;
    for (const item of row) {
      const approxWidth = item.str.length * 4.5; // rough glyph width; only gap detection needs it
      if (current && item.x - lastEndX > COLUMN_GAP) {
        segments.push(current);
        current = null;
      }
      if (!current) {
        current = { x: item.x, y: item.y, text: item.str };
      } else {
        const needsSpace = !current.text.endsWith(' ') && !item.str.startsWith(' ');
        current.text += (needsSpace ? ' ' : '') + item.str;
      }
      lastEndX = item.x + approxWidth;
    }
    if (current) segments.push(current);
  }

  // Cluster segment start positions into columns.
  const columnStarts: number[] = [];
  for (const segment of [...segments].sort((a, b) => a.x - b.x)) {
    const last = columnStarts[columnStarts.length - 1];
    if (last === undefined || segment.x - last > COLUMN_TOLERANCE) {
      columnStarts.push(segment.x);
    }
  }
  const columnOf = (x: number): number => {
    for (let i = columnStarts.length - 1; i >= 0; i--) {
      if (x >= columnStarts[i] - COLUMN_TOLERANCE / 2) return i;
    }
    return 0;
  };

  // Emit column by column, top to bottom.
  return segments
    .map((segment) => ({ ...segment, column: columnOf(segment.x) }))
    .sort((a, b) => a.column - b.column || b.y - a.y || a.x - b.x)
    .map((segment) => segment.text.replace(/\s+/g, ' ').trim())
    .filter((text) => text.length > 0);
}

const OUTLINE_START = /^(\d{1,3})[.)]\s+(.+)$/;
/** Header/footer noise the S-99 layout adds around the list. */
const NOISE = [
  /^s-99/i,
  /^page \d+/i,
  /^\d+$/,
  /©/,
  /^\d{1,2}\/\d{2}$/, // form revision stamps like "10/23"
];

/**
 * Turns reading-order lines into outlines. A line starting with "NNN." (or
 * "NNN)") opens an outline; following unnumbered lines are wrapped title text
 * and are appended. Duplicate numbers keep the first title and add a warning.
 */
export function parseOutlineLines(lines: string[]): ParseResult {
  const byNumber = new Map<number, string>();
  const warnings: string[] = [];
  let currentNumber: number | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || NOISE.some((pattern) => pattern.test(line))) continue;

    const start = line.match(OUTLINE_START);
    if (start) {
      const talkNumber = Number(start[1]);
      const title = start[2].trim();
      if (byNumber.has(talkNumber)) {
        warnings.push(`Talk ${talkNumber} appears more than once; kept the first title.`);
        currentNumber = null;
        continue;
      }
      byNumber.set(talkNumber, title);
      currentNumber = talkNumber;
      continue;
    }

    // Unnumbered line: wrapped continuation of the previous title.
    if (currentNumber !== null) {
      byNumber.set(currentNumber, `${byNumber.get(currentNumber)} ${line}`.replace(/\s+/g, ' '));
    }
  }

  return finalizeOutlines(byNumber, warnings);
}

/**
 * Sorts the collected outlines and appends sanity warnings (sequence gaps,
 * suspiciously short titles). Shared by the PDF and jwpub parsers.
 */
export function finalizeOutlines(byNumber: Map<number, string>, warnings: string[]): ParseResult {
  const outlines = [...byNumber.entries()]
    .map(([talk_number, title]) => ({ talk_number, title }))
    .sort((a, b) => a.talk_number - b.talk_number);

  if (outlines.length > 1) {
    const missing: number[] = [];
    for (let n = outlines[0].talk_number; n <= outlines[outlines.length - 1].talk_number; n++) {
      if (!byNumber.has(n)) missing.push(n);
    }
    // A handful of retired outline numbers is normal; a large gap means a parse problem.
    if (missing.length > 0 && missing.length <= 25) {
      warnings.push(`Missing talk numbers (retired or not parsed): ${missing.join(', ')}.`);
    } else if (missing.length > 25) {
      warnings.push(`${missing.length} talk numbers are missing — check the parsed list carefully.`);
    }
  }

  for (const outline of outlines) {
    if (outline.title.length < 8) {
      warnings.push(`Talk ${outline.talk_number} has a very short title ("${outline.title}").`);
    }
  }

  return { outlines, warnings };
}

/**
 * Extracts reading-order text lines from every page of a PDF file.
 * pdf.js is lazy-imported so it only loads on the outline manager page.
 */
export async function extractPdfLines(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

  const data = await file.arrayBuffer();
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  try {
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const item of content.items) {
        if ('str' in item && 'transform' in item) {
          items.push({ str: item.str, x: item.transform[4], y: item.transform[5] });
        }
      }
      lines.push(...groupTextItemsIntoLines(items));
    }
    return lines;
  } finally {
    await task.destroy();
  }
}

/** Convenience: parse an uploaded S-99 PDF into outlines + warnings. */
export async function parseS99Pdf(file: File): Promise<ParseResult> {
  const lines = await extractPdfLines(file);
  return parseOutlineLines(lines);
}

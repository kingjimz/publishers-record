/**
 * Renders a self-contained print document (inline CSS, no external resources)
 * to letter-size PNG pages (8.5 x 11 in at 96 dpi = 816 x 1056 px, drawn at 2x
 * for crisp text) and downloads them. Uses an SVG foreignObject drawn onto a
 * canvas, so no third-party library is needed.
 *
 * The document's `body { ... }` CSS is retargeted to the export wrapper so
 * fonts and colors apply inside the SVG, and each `.sheet-page` block becomes
 * its own PNG page, scaled down if needed so nothing is cut off.
 *
 * The markup must be XML-safe (numeric entities only), which the schedule
 * builders guarantee.
 */

const PAGE_WIDTH = 816; // 8.5in * 96dpi
const PAGE_HEIGHT = 1056; // 11in * 96dpi
const PAGE_MARGIN = 28;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const SCALE = 2; // output resolution multiplier

/** Splits a print document into its CSS (retargeted to the wrapper) and page markup. */
function splitDocumentPages(documentHtml: string): { css: string; pages: string[] } {
  const rawStyle = documentHtml.match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? '';
  const body = documentHtml.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? documentHtml;

  // Print-only rules do not belong in the image; retarget `body` styles to the
  // wrapper div so the font, sizes, and colors actually apply inside the SVG.
  const css = rawStyle
    .replace(/@media print\s*\{\s*body\s*\{[^}]*\}\s*\}/g, '')
    .replace(/@page\s*\{[^}]*\}/g, '')
    .replace(/\bbody\s*\{/g, '.png-root {');

  // Each `.sheet-page` is one PNG page; content before the first one (the
  // document header) joins the first page. Without page markers, export as one page.
  const segments = body.split('<div class="sheet-page">');
  const header = segments[0];
  const pages: string[] =
    segments.length > 1
      ? segments.slice(1).map((segment, i) => `${i === 0 ? header : ''}<div class="sheet-page">${segment}`)
      : [body];

  return { css, pages };
}

/** Returns the number of PNG pages downloaded. */
export async function downloadHtmlAsPngPages(
  documentHtml: string,
  baseFileName: string
): Promise<number> {
  const { css, pages } = splitDocumentPages(documentHtml);

  for (let i = 0; i < pages.length; i++) {
    const canvas = await renderPageToCanvas(css, pages[i]);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not create the PNG file.');
    const suffix = pages.length > 1 ? `-page${i + 1}` : '';
    triggerDownload(blob, `${baseFileName}${suffix}.png`);
    // Give the browser a beat between downloads so none are dropped.
    if (i < pages.length - 1) await new Promise((r) => setTimeout(r, 400));
  }

  return pages.length;
}

/**
 * Renders each page of the print document to a PNG data URL, using the exact
 * pipeline as the PNG download, so printed pages match the exported images.
 */
export async function renderHtmlToPngDataUrls(documentHtml: string): Promise<string[]> {
  const { css, pages } = splitDocumentPages(documentHtml);
  const urls: string[] = [];
  for (const page of pages) {
    const canvas = await renderPageToCanvas(css, page);
    urls.push(canvas.toDataURL('image/png'));
  }
  return urls;
}

async function renderPageToCanvas(css: string, content: string): Promise<HTMLCanvasElement> {
  // Measure at the exact width and styles used for the final render.
  const probe = document.createElement('div');
  probe.className = 'png-root';
  probe.style.cssText = `position:fixed;left:-99999px;top:0;width:${CONTENT_WIDTH}px;background:#fff;`;
  probe.innerHTML = `<style>${css}</style>${content}`;
  document.body.appendChild(probe);
  const contentHeight = Math.ceil(probe.scrollHeight);
  probe.remove();

  const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="png-root" style="width:${CONTENT_WIDTH}px;background:#ffffff;"><style>${css}</style>${content}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CONTENT_WIDTH}" height="${contentHeight}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;

  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not render the schedule image.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = PAGE_WIDTH * SCALE;
  canvas.height = PAGE_HEIGHT * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Shrink to fit the page height if the content runs long, keeping margins.
  const fit = Math.min(1, (PAGE_HEIGHT - PAGE_MARGIN * 2) / contentHeight);
  const drawWidth = CONTENT_WIDTH * fit;
  const offsetX = (PAGE_WIDTH - drawWidth) / 2;

  ctx.scale(SCALE, SCALE);
  ctx.drawImage(image, offsetX, PAGE_MARGIN, drawWidth, contentHeight * fit);

  return canvas;
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Renders a self-contained print document (inline CSS, no external resources)
 * to letter-size PNG pages (8.5 x 11 in at 96 dpi = 816 x 1056 px, rasterized
 * at print resolution) and downloads them. Uses an SVG foreignObject drawn
 * onto a canvas, so no third-party library is needed.
 *
 * The document's `body { ... }` CSS is retargeted to the export wrapper so
 * fonts and colors apply inside the SVG, and each `.sheet-page` block becomes
 * its own PNG page. Every page is drawn into the exact same printable area, so
 * margins are identical on every page of every document; when a document runs
 * long, its content is laid out wider and zoomed out to fit instead of the
 * page image being shrunk and re-centered.
 *
 * The markup must be XML-safe (numeric entities only), which the schedule
 * builders guarantee.
 */

const PAGE_WIDTH = 816; // 8.5in * 96dpi
const PAGE_HEIGHT = 1056; // 11in * 96dpi
const PAGE_MARGIN = 28;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const CONTENT_HEIGHT = PAGE_HEIGHT - PAGE_MARGIN * 2;
const SCALE = 3; // output resolution multiplier (3x of 96dpi ≈ 288dpi, print grade)

// Each page is laid out inside a fixed content-size flex column, so flexible
// blocks (like the no-meeting placeholder) fill the leftover space exactly.
// The zoom factor scales the layout box up when content runs long; the page is
// then drawn back down into the same printable area, keeping margins constant.
function pageRootStyle(zoom: number): string {
  return `width:${CONTENT_WIDTH * zoom}px;height:${CONTENT_HEIGHT * zoom}px;display:flex;flex-direction:column;`;
}

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
  const canvases = await renderPagesToCanvases(documentHtml);

  for (let i = 0; i < canvases.length; i++) {
    const blob = await new Promise<Blob | null>((resolve) => canvases[i].toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not create the PNG file.');
    const suffix = canvases.length > 1 ? `-page${i + 1}` : '';
    triggerDownload(blob, `${baseFileName}${suffix}.png`);
    // Give the browser a beat between downloads so none are dropped.
    if (i < canvases.length - 1) await new Promise((r) => setTimeout(r, 400));
  }

  return canvases.length;
}

/**
 * Renders each page of the print document to a PNG data URL, using the exact
 * pipeline as the PNG download, so printed pages match the exported images.
 */
export async function renderHtmlToPngDataUrls(documentHtml: string): Promise<string[]> {
  const canvases = await renderPagesToCanvases(documentHtml);
  return canvases.map((canvas) => canvas.toDataURL('image/png'));
}

/**
 * Renders every page of the document at one shared zoom, so all pages, and all
 * documents, share the exact same margins. When the tallest page overflows the
 * page box, the layout box is enlarged (content reflows and zooms out) until
 * everything fits, then each page is drawn into the fixed printable area.
 */
async function renderPagesToCanvases(documentHtml: string): Promise<HTMLCanvasElement[]> {
  const { css, pages } = splitDocumentPages(documentHtml);

  let zoom = 1;
  for (let attempt = 0; attempt < 4; attempt++) {
    const tallest = Math.max(...pages.map((page) => measurePageHeight(css, page, zoom)));
    const overflow = tallest / (CONTENT_HEIGHT * zoom);
    if (overflow <= 1) break;
    // Small headroom so re-wrapped text doesn't land exactly on the edge.
    zoom *= overflow * 1.01;
  }

  const canvases: HTMLCanvasElement[] = [];
  for (const page of pages) {
    canvases.push(await renderPageToCanvas(css, page, zoom));
  }
  return canvases;
}

/** Measures a page at the exact layout size and styles used for the final render. */
function measurePageHeight(css: string, content: string, zoom: number): number {
  const probe = document.createElement('div');
  probe.className = 'png-root';
  probe.style.cssText = `position:fixed;left:-99999px;top:0;${pageRootStyle(zoom)}background:#fff;`;
  probe.innerHTML = `<style>${css}</style>${content}`;
  document.body.appendChild(probe);
  const contentHeight = Math.ceil(probe.scrollHeight);
  probe.remove();
  return contentHeight;
}

async function renderPageToCanvas(
  css: string,
  content: string,
  zoom: number
): Promise<HTMLCanvasElement> {
  const layoutWidth = CONTENT_WIDTH * zoom;
  const layoutHeight = CONTENT_HEIGHT * zoom;
  const xhtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="png-root" style="${pageRootStyle(zoom)}background:#ffffff;"><style>${css}</style>${content}</div>`;
  // Declaring the SVG at SCALE size with a viewBox makes the browser rasterize
  // the text itself at output resolution; drawing a natural-size SVG scaled up
  // on the canvas would only stretch an already-rasterized 1x bitmap.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${layoutWidth * SCALE}" height="${layoutHeight * SCALE}" viewBox="0 0 ${layoutWidth} ${layoutHeight}"><foreignObject width="${layoutWidth}" height="${layoutHeight}">${xhtml}</foreignObject></svg>`;

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

  // Always draw into the same printable area, so margins never vary. The image
  // is already high resolution, so this maps (near) 1:1 to device pixels.
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, PAGE_MARGIN * SCALE, PAGE_MARGIN * SCALE, CONTENT_WIDTH * SCALE, CONTENT_HEIGHT * SCALE);

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

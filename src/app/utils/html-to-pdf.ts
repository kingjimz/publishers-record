import { renderHtmlToPngDataUrls } from './html-to-png';

/** US Letter in PDF points. */
const LETTER_WIDTH_PT = 612;
const LETTER_HEIGHT_PT = 792;

/**
 * Renders the document through the shared PNG pipeline (one image per
 * `.sheet-page`) and saves all pages as a single letter-size PDF, so the
 * output is pixel-identical to the PNG and print flows. jsPDF is imported
 * lazily to keep it out of the route chunks until a PDF is actually requested.
 * Returns the page count.
 */
export async function downloadHtmlAsPdf(documentHtml: string, baseFileName: string): Promise<number> {
  const pages = await renderHtmlToPngDataUrls(documentHtml);
  const { jsPDF } = await import('jspdf');

  const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  pages.forEach((dataUrl, index) => {
    if (index > 0) pdf.addPage('letter', 'portrait');
    // The page images already bake in their own margins, so they fill the page.
    pdf.addImage(dataUrl, 'PNG', 0, 0, LETTER_WIDTH_PT, LETTER_HEIGHT_PT);
  });

  pdf.save(`${baseFileName}.pdf`);
  return pages.length;
}

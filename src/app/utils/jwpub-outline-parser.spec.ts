import { JwpubDocumentRow, extractOutlinesFromDocuments } from './jwpub-outline-parser';

function row(partial: Partial<JwpubDocumentRow>): JwpubDocumentRow {
  return { title: null, tocTitle: null, contextTitle: null, featureTitle: null, ...partial };
}

describe('extractOutlinesFromDocuments', () => {
  it('extracts leading talk numbers and strips them from the title', () => {
    const { outlines, warnings } = extractOutlinesFromDocuments([
      row({ title: '2. Ti Ari a Mangituray' }),
      row({ title: '1. Ania ti Kaipapanan ti Biag?' }),
    ]);
    expect(outlines).toEqual([
      { talk_number: 1, title: 'Ania ti Kaipapanan ti Biag?' },
      { talk_number: 2, title: 'Ti Ari a Mangituray' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('reads "No. N" style numbers from any title column', () => {
    const { outlines } = extractOutlinesFromDocuments([
      row({ title: 'Ania ti Kaipapanan ti Biag?', featureTitle: 'No. 1' }),
      row({ title: 'Ti Ari a Mangituray', contextTitle: '(Blg. 2)' }),
    ]);
    expect(outlines).toEqual([
      { talk_number: 1, title: 'Ania ti Kaipapanan ti Biag?' },
      { talk_number: 2, title: 'Ti Ari a Mangituray' },
    ]);
  });

  it('skips front matter without numbers and warns about it', () => {
    const { outlines, warnings } = extractOutlinesFromDocuments([
      row({ title: 'Public Talk Outlines' }),
      row({ title: 'Instructions for Speakers' }),
      row({ title: '5. Pudpudno a Tulong Para Kadagiti Pamilia' }),
    ]);
    expect(outlines).toEqual([{ talk_number: 5, title: 'Pudpudno a Tulong Para Kadagiti Pamilia' }]);
    expect(warnings.some((w) => w.includes('Skipped 2'))).toBe(true);
  });

  it('keeps the first title on duplicate numbers and warns', () => {
    const { outlines, warnings } = extractOutlinesFromDocuments([
      row({ title: '7. First Title Wins' }),
      row({ title: '7. Second Copy' }),
    ]);
    expect(outlines).toEqual([{ talk_number: 7, title: 'First Title Wins' }]);
    expect(warnings.some((w) => w.includes('Talk 7'))).toBe(true);
  });

  it('warns when nothing has a talk number', () => {
    const { outlines, warnings } = extractOutlinesFromDocuments([
      row({ title: 'Song Book' }),
      row({ title: 'Preface' }),
    ]);
    expect(outlines).toEqual([]);
    expect(warnings.some((w) => w.includes('No talk numbers found'))).toBe(true);
  });

  it('warns about gaps in the sequence (retired outlines)', () => {
    const { warnings } = extractOutlinesFromDocuments([
      row({ title: '1. Adda Kaipapanan ti Biag' }),
      row({ title: '3. Ti Dios a Pudno' }),
    ]);
    expect(warnings.some((w) => w.includes('2'))).toBe(true);
  });
});

import { groupTextItemsIntoLines, parseOutlineLines, PdfTextItem } from './s99-outline-parser';

function item(str: string, x: number, y: number): PdfTextItem {
  return { str, x, y };
}

describe('groupTextItemsIntoLines', () => {
  it('joins items on the same row and orders rows top to bottom', () => {
    const lines = groupTextItemsIntoLines([
      item('1.', 50, 700),
      item('Ania ti Kaipapanan ti Biag?', 70, 700.5),
      item('2.', 50, 685),
      item('Ti Ari a Mangituray', 70, 685),
    ]);
    expect(lines).toEqual(['1. Ania ti Kaipapanan ti Biag?', '2. Ti Ari a Mangituray']);
  });

  it('keeps two-column pages in reading order (column-major, not row-major)', () => {
    const lines = groupTextItemsIntoLines([
      // Column 1 (x=50): talks 1-2, talk 1 wraps onto a second line.
      item('1. Kasano a Maammuantayo', 50, 700),
      item('100. Kappia iti Lubong', 320, 700), // column 2, same row as talk 1
      item('ti Kinapudno?', 60, 688), // wrapped remainder of talk 1
      item('101. Agbiag a Sisasagana', 320, 688),
      item('2. Ti Pagarian ti Dios', 50, 676),
    ]);
    expect(lines).toEqual([
      '1. Kasano a Maammuantayo',
      'ti Kinapudno?',
      '2. Ti Pagarian ti Dios',
      '100. Kappia iti Lubong',
      '101. Agbiag a Sisasagana',
    ]);
  });

  it('drops empty items', () => {
    expect(groupTextItemsIntoLines([item('  ', 50, 700), item('', 60, 700)])).toEqual([]);
  });
});

describe('parseOutlineLines', () => {
  it('parses numbered lines into outlines sorted by number', () => {
    const { outlines, warnings } = parseOutlineLines([
      '2. Ti Ari a Mangituray',
      '1. Ania ti Kaipapanan ti Biag?',
    ]);
    expect(outlines).toEqual([
      { talk_number: 1, title: 'Ania ti Kaipapanan ti Biag?' },
      { talk_number: 2, title: 'Ti Ari a Mangituray' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('appends unnumbered continuation lines to the previous title', () => {
    const { outlines } = parseOutlineLines([
      '175. Ania Dagiti Pammaneknek a ti Biblia ket',
      'Naipaltiing a Sao ti Dios?',
      '176. Sumaganaka iti Panungpalan ti Lubong',
    ]);
    expect(outlines[0].title).toBe(
      'Ania Dagiti Pammaneknek a ti Biblia ket Naipaltiing a Sao ti Dios?'
    );
    expect(outlines[1].talk_number).toBe(176);
  });

  it('skips header/footer noise and page numbers', () => {
    const { outlines } = parseOutlineLines([
      'S-99-IL 10/23',
      '3',
      '4. Ebidensia a Adda Dios',
      '© 2023 Watch Tower',
    ]);
    expect(outlines).toEqual([{ talk_number: 4, title: 'Ebidensia a Adda Dios' }]);
  });

  it('warns on duplicate numbers and keeps the first title', () => {
    const { outlines, warnings } = parseOutlineLines(['7. First Title Wins', '7. Second Copy']);
    expect(outlines).toEqual([{ talk_number: 7, title: 'First Title Wins' }]);
    expect(warnings.some((w) => w.includes('Talk 7'))).toBe(true);
  });

  it('warns about small gaps in the number sequence (retired outlines)', () => {
    const { warnings } = parseOutlineLines([
      '1. Adda Kaipapanan ti Biag',
      '3. Ti Dios a Pudno',
    ]);
    expect(warnings.some((w) => w.includes('2'))).toBe(true);
  });

  it('does not treat a continuation line before any outline as content', () => {
    const { outlines } = parseOutlineLines(['List of Talk Outlines', '5. Pudpudno a Tulong']);
    expect(outlines).toEqual([{ talk_number: 5, title: 'Pudpudno a Tulong' }]);
  });
});

import { displayPublisherName } from './publisher-name';

describe('displayPublisherName', () => {
  it('swaps "Lastname, Firstname" into reading order', () => {
    expect(displayPublisherName('Peñera, Eliezer')).toBe('Eliezer Peñera');
    expect(displayPublisherName('Dacanay, King Jims')).toBe('King Jims Dacanay');
  });

  it('tolerates missing and extra spacing around the comma', () => {
    expect(displayPublisherName('Galase,Leniel')).toBe('Leniel Galase');
    expect(displayPublisherName('  Garcia ,  Herminio  ')).toBe('Herminio Garcia');
  });

  it('leaves names without a comma untouched', () => {
    expect(displayPublisherName('Abner Calonge')).toBe('Abner Calonge');
    expect(displayPublisherName('Cresencia')).toBe('Cresencia');
  });

  it('folds a suffix after the second comma into the given names', () => {
    expect(displayPublisherName('Cruz, Juan, Jr.')).toBe('Juan Jr. Cruz');
  });

  it('handles half-filled and empty values', () => {
    expect(displayPublisherName('Lomanog,')).toBe('Lomanog');
    expect(displayPublisherName(', Samson')).toBe('Samson');
    expect(displayPublisherName('')).toBe('');
    expect(displayPublisherName(null)).toBe('');
    expect(displayPublisherName(undefined)).toBe('');
  });
});

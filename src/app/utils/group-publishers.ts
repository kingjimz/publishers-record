import { PublisherRecord } from '../services/supabase.service';

/** Display label for a record’s group; empty / null shows as “No group”. */
export function displayPublisherGroupLabel(record: PublisherRecord): string {
  const t = (record.publisher_group ?? '').trim();
  return t || 'No group';
}

/** Sort by group (alphabetically; empty last), then by publisher name. */
export function sortPublishersByGroupThenName(records: PublisherRecord[]): PublisherRecord[] {
  return [...records].sort((a, b) => {
    const ga = (a.publisher_group ?? '').trim().toLowerCase();
    const gb = (b.publisher_group ?? '').trim().toLowerCase();
    const emptyA = ga === '' ? 1 : 0;
    const emptyB = gb === '' ? 1 : 0;
    if (emptyA !== emptyB) return emptyA - emptyB;
    if (ga !== gb) return ga.localeCompare(gb);
    return a.publisher_name.localeCompare(b.publisher_name, undefined, { sensitivity: 'base' });
  });
}

/** Sidebar sections: each group header with its publishers (names sorted within the group). */
export function groupPublishersForSidebar(records: PublisherRecord[]): { label: string; records: PublisherRecord[] }[] {
  const map = new Map<string, PublisherRecord[]>();
  for (const r of records) {
    const label = displayPublisherGroupLabel(r);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(r);
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      a.publisher_name.localeCompare(b.publisher_name, undefined, { sensitivity: 'base' })
    );
  }
  const labels = [...map.keys()].sort((a, b) => {
    if (a === 'No group') return 1;
    if (b === 'No group') return -1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  return labels.map((label) => ({ label, records: map.get(label)! }));
}

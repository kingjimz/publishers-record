/**
 * Publisher names are stored canonically as "Lastname, Firstname" (the format
 * used by `publisher_records.publisher_name`, which is also the key for
 * assignment history and eligibility lookups). Schedules and pickers read more
 * naturally as "Firstname Lastname", so the swap happens at display time only —
 * stored values are never rewritten, which keeps already-saved assignments and
 * name-based lookups intact.
 */
export function displayPublisherName(name: string | null | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();

  const comma = trimmed.indexOf(',');
  if (comma === -1) return trimmed; // already natural order, or a free-text visitor

  const last = trimmed.slice(0, comma).trim();
  // Suffixes arrive as a second comma ("Cruz, Juan, Jr."); fold them into the
  // given-name half so the result reads "Juan Jr. Cruz".
  const given = trimmed
    .slice(comma + 1)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');

  if (!given) return last;
  if (!last) return given;
  return `${given} ${last}`;
}

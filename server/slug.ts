// Shared slug rules for everything that claims a name under /docs/ —
// local namespaces and external-source slugs live in the same URL space.

/** Names that routes already own at the URL root and under /docs/. */
export const RESERVED_DOC_NAMES = new Set(['api', 'agent', 'docs', 'static', 'assets', 'llms.txt']);

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/** First of `base`, `base-2`, `base-3`, … that is neither taken nor reserved. */
export function uniqueSlug(base: string, isTaken: (slug: string) => boolean): string {
  const start = base || 'doc';
  let candidate = start;
  for (let n = 2; RESERVED_DOC_NAMES.has(candidate) || isTaken(candidate); n++) {
    candidate = `${start}-${n}`;
  }
  return candidate;
}

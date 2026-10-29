import { ORIGINAL_EXTENSIONS } from '@shortlist-ai/shared';

const MAX_LENGTH = 100;

/**
 * Turns a name chosen by the user's computer into one that is safe in a storage key and a download header.
 * Only the last path segment is used, control and non-ASCII characters are removed, and what is left becomes
 * letters, digits, hyphens and underscores. An allowed extension is kept (lower-cased). An empty result is "resume".
 */
export function sanitiseFilename(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? '';
  const ascii = leaf.replace(/[^\x20-\x7e]/g, '').trim();
  const dot = ascii.lastIndexOf('.');
  const ext = dot >= 0 ? ascii.slice(dot + 1).toLowerCase() : '';
  const keepExt = (ORIGINAL_EXTENSIONS as string[]).includes(ext);
  const stem = keepExt ? ascii.slice(0, dot) : ascii;
  const maxStemLength = MAX_LENGTH - (keepExt ? ext.length + 1 : 0);
  const base =
    stem
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxStemLength)
      .replace(/-+$/g, '') || 'resume';
  return keepExt ? `${base}.${ext}` : base;
}

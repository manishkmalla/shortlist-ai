import type { ResumeSummary } from '@shortlist-ai/shared';

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export const formatWords = (count: number) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? 'word' : 'words'}`;

export const sourceLabel = (r: Pick<ResumeSummary, 'source'>) =>
  r.source === 'paste' ? 'Pasted' : 'Uploaded';

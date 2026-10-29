import {
  MAX_RESUME_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  MIN_RESUME_TEXT_CHARS,
  type ResumeFailure,
} from '@shortlist-ai/shared';
import { parseOriginalKey } from '../lib/objectKeys';
import type { ObjectStore } from '../lib/objectStore';
import { readTextFile } from '../lib/textFile';
import type { ResumeRepo } from '../repo/resumeRepo';

export type ExtractionOutcome = 'ready' | 'failed' | 'ignored' | 'orphan_removed';

export interface ExtractionResult {
  outcome: ExtractionOutcome;
  userId?: string;
  resumeId?: string;
  size?: number;
  reason?: ResumeFailure['code'];
}

/** Turns an uploaded file into a Resume's text. Safe to run more than once for the same file. */
export function createExtractionService(deps: {
  repo: ResumeRepo;
  store: ObjectStore;
  now?: () => Date;
}) {
  const now = () => (deps.now ?? (() => new Date()))().toISOString();

  return {
    async extract(key: string): Promise<ExtractionResult> {
      const owner = parseOriginalKey(key);
      if (!owner) return { outcome: 'ignored' };
      const { userId, resumeId } = owner;

      const resume = await deps.repo.get(userId, resumeId);
      if (!resume) {
        // The Resume was deleted (or the key was forged): nothing owns this file.
        await deps.store.delete(key);
        return { outcome: 'orphan_removed', userId, resumeId };
      }
      // Anything but processing means this file was already dealt with.
      if (resume.status !== 'processing') return { outcome: 'ignored', userId, resumeId };

      const info = await deps.store.head(key);
      if (!info) return { outcome: 'ignored', userId, resumeId };

      const fail = async (failure: ResumeFailure, size: number): Promise<ExtractionResult> => {
        const done = await deps.repo.update(
          userId,
          resumeId,
          { status: 'failed', failure, updatedAt: now() },
          { onlyIfStatus: 'processing' },
        );
        return {
          outcome: done ? 'failed' : 'ignored',
          userId,
          resumeId,
          size,
          reason: failure.code,
        };
      };

      if (info.size > MAX_UPLOAD_BYTES) {
        return fail(
          { code: 'file_too_large', message: 'That file is larger than 5 MB.' },
          info.size,
        );
      }
      const bytes = await deps.store.read(key);
      if (!bytes) return { outcome: 'ignored', userId, resumeId };

      const read = readTextFile(bytes);
      if (!read.ok) return fail({ code: read.code, message: read.message }, info.size);

      const length = read.text.length;
      if (read.text.trim().length < MIN_RESUME_TEXT_CHARS) {
        return fail(
          {
            code: 'no_readable_text',
            message: 'No readable text was found in this file. Paste your resume text instead.',
          },
          info.size,
        );
      }
      if (length > MAX_RESUME_TEXT_CHARS) {
        return fail(
          {
            code: 'text_too_long',
            message: `This resume is too long (${length.toLocaleString('en-US')} characters, the limit is ${MAX_RESUME_TEXT_CHARS.toLocaleString('en-US')}). Paste a shorter version.`,
          },
          info.size,
        );
      }

      const done = await deps.repo.update(
        userId,
        resumeId,
        { text: read.text, status: 'ready', updatedAt: now() },
        { onlyIfStatus: 'processing' },
      );
      return { outcome: done ? 'ready' : 'ignored', userId, resumeId, size: info.size };
    },
  };
}

export type ExtractionService = ReturnType<typeof createExtractionService>;

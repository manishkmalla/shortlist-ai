import {
  MAX_RESUMES,
  type CreateResumeRequest,
  type Resume,
  type ResumeSummary,
  type UpdateResumeRequest,
} from '@shortlist-ai/shared';
import type { ResumePatch, ResumeRepo, StoredResume } from '../repo/resumeRepo';

/** Why a resume request was refused. The handler maps these to HTTP statuses. */
export class ResumeError extends Error {
  constructor(
    public readonly code: 'limit_reached' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'ResumeError';
  }
}

const countWords = (text: string) => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length);

const toSummary = (r: StoredResume): ResumeSummary => ({
  id: r.id,
  label: r.label,
  notes: r.notes,
  status: r.status,
  source: r.source,
  isDefault: r.isDefault,
  reviewed: r.reviewedAt !== null,
  textLength: r.text.length,
  wordCount: countWords(r.text),
  ...(r.parentResumeId ? { parentResumeId: r.parentResumeId } : {}),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toResume = (r: StoredResume): Resume => ({ ...toSummary(r), text: r.text });

const newestFirst = (a: StoredResume, b: StoredResume) => b.updatedAt.localeCompare(a.updatedAt);

const limitError = () =>
  new ResumeError(
    'limit_reached',
    `You can keep up to ${MAX_RESUMES} resumes. Delete one to add another.`,
  );

export function createResumeService(deps: {
  repo: ResumeRepo;
  newId: () => string;
  now?: () => Date;
}) {
  const now = () => (deps.now ?? (() => new Date()))().toISOString();

  /** Rejects when the library is full. Returns the current list so callers can reuse it. */
  const ensureRoom = async (userId: string) => {
    const all = await deps.repo.list(userId);
    if (all.length >= MAX_RESUMES) throw limitError();
    return all;
  };

  return {
    async list(userId: string): Promise<ResumeSummary[]> {
      return (await deps.repo.list(userId)).sort(newestFirst).map(toSummary);
    },

    async get(userId: string, id: string): Promise<Resume | null> {
      const found = await deps.repo.get(userId, id);
      return found ? toResume(found) : null;
    },

    /** Pasted text counts as reviewed: the user typed or pasted it themselves. The first resume is the default. */
    async create(userId: string, input: CreateResumeRequest): Promise<Resume> {
      const existing = await ensureRoom(userId);
      const stamp = now();
      const resume: StoredResume = {
        id: deps.newId(),
        label: input.label,
        notes: input.notes ?? '',
        text: input.text,
        status: 'ready',
        source: 'paste',
        isDefault: existing.length === 0,
        reviewedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      };
      await deps.repo.create(userId, resume);
      return toResume(resume);
    },

    async duplicate(userId: string, id: string): Promise<Resume> {
      await ensureRoom(userId);
      const source = await deps.repo.get(userId, id);
      if (!source) throw new ResumeError('not_found', 'Resume not found.');
      const stamp = now();
      const copy: StoredResume = {
        ...source,
        id: deps.newId(),
        label: `${source.label.slice(0, 73)} (copy)`,
        isDefault: false,
        createdAt: stamp,
        updatedAt: stamp,
      };
      delete copy.parentResumeId;
      await deps.repo.create(userId, copy);
      return toResume(copy);
    },

    /** Editing the text, or confirming it, marks the resume as reviewed. */
    async update(userId: string, id: string, input: UpdateResumeRequest): Promise<Resume | null> {
      const stamp = now();
      const patch: ResumePatch = {
        label: input.label,
        notes: input.notes,
        text: input.text,
        updatedAt: stamp,
      };
      if (input.text !== undefined || input.reviewed) patch.reviewedAt = stamp;

      let updated = await deps.repo.update(userId, id, patch);
      if (!updated) return null;

      if (input.isDefault && !updated.isDefault) {
        const others = (await deps.repo.list(userId))
          .filter((r) => r.id !== id && r.isDefault)
          .map((r) => r.id);
        if (!(await deps.repo.setDefault(userId, id, others, stamp))) return null;
        updated = (await deps.repo.get(userId, id)) ?? updated;
      }
      return toResume(updated);
    },

    /** Deleting the default promotes the most recently updated remaining resume. */
    async delete(userId: string, id: string): Promise<boolean> {
      const target = await deps.repo.get(userId, id);
      if (!target) return false;
      await deps.repo.delete(userId, id);
      if (target.isDefault) {
        const [next] = (await deps.repo.list(userId)).sort(newestFirst);
        if (next) await deps.repo.setDefault(userId, next.id, [], now());
      }
      return true;
    },
  };
}

export type ResumeService = ReturnType<typeof createResumeService>;

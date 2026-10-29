import {
  MAX_RESUMES,
  MAX_UPLOAD_BYTES,
  ORIGINAL_CONTENT_TYPES,
  UPLOADABLE_EXTENSIONS,
  type CreateResumeRequest,
  type OriginalExtension,
  type RequestUploadRequest,
  type Resume,
  type ResumeSummary,
  type UpdateResumeRequest,
  type UploadStarted,
} from '@shortlist-ai/shared';
import { sanitiseFilename } from '../lib/filename';
import { originalKey } from '../lib/objectKeys';
import type { ObjectStore } from '../lib/objectStore';
import type { ResumePatch, ResumeRepo, StoredResume } from '../repo/resumeRepo';

/** How long the browser has to start sending the file. */
const UPLOAD_EXPIRY_SECONDS = 300;

/** Why a resume request was refused. The handler maps these to HTTP statuses. */
export class ResumeError extends Error {
  constructor(
    public readonly code:
      | 'limit_reached'
      | 'not_found'
      | 'not_ready'
      | 'unsupported_type'
      | 'type_mismatch'
      | 'file_too_large',
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
  hasOriginal: r.original !== undefined,
  failureReason: r.failure ?? null,
  ...(r.parentResumeId ? { parentResumeId: r.parentResumeId } : {}),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toResume = (r: StoredResume): Resume => ({ ...toSummary(r), text: r.text });

const newestFirst = (a: StoredResume, b: StoredResume) => b.updatedAt.localeCompare(a.updatedAt);

/** Only a Resume whose text the app has actually read can be reviewed, edited as text, or copied. */
const assertReady = (resume: StoredResume, action: string) => {
  if (resume.status !== 'ready') {
    throw new ResumeError('not_ready', `This resume is not ready yet, so it cannot be ${action}.`);
  }
};

/** The lower-case extension after the last dot of the last path segment, or an empty string. */
const extensionOf = (filename: string) => {
  const leaf = filename.split(/[\\/]/).pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  return dot >= 0
    ? leaf
        .slice(dot + 1)
        .trim()
        .toLowerCase()
    : '';
};

/** A readable default label: the file name without its path or extension, at most 80 characters. */
const labelFromFilename = (filename: string) => {
  const leaf = filename.split(/[\\/]/).pop() ?? '';
  const dot = leaf.lastIndexOf('.');
  // eslint-disable-next-line no-control-regex
  const stem = (dot > 0 ? leaf.slice(0, dot) : leaf).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return stem.slice(0, 80).trim() || 'Resume';
};

const limitError = () =>
  new ResumeError(
    'limit_reached',
    `You can keep up to ${MAX_RESUMES} resumes. Delete one to add another.`,
  );

export function createResumeService(deps: {
  repo: ResumeRepo;
  store: ObjectStore;
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

    /**
     * Starts an upload: validates the file's name, size and type, creates the Resume as processing, and returns
     * a short-lived permission to send exactly that file to storage. Reading the file happens later.
     */
    async requestUpload(userId: string, input: RequestUploadRequest): Promise<UploadStarted> {
      const extension = extensionOf(input.filename);
      if (!(UPLOADABLE_EXTENSIONS as readonly string[]).includes(extension)) {
        const supported = UPLOADABLE_EXTENSIONS.map((e) => `.${e}`).join(', ');
        throw new ResumeError(
          'unsupported_type',
          `That file type is not supported. You can upload ${supported} files, or paste your resume text instead.`,
        );
      }
      const contentType = ORIGINAL_CONTENT_TYPES[extension as OriginalExtension];
      const declared = input.contentType?.split(';')[0]?.trim().toLowerCase();
      if (declared && declared !== contentType) {
        throw new ResumeError('type_mismatch', "That file's type does not match its name.");
      }
      if (input.size > MAX_UPLOAD_BYTES) {
        throw new ResumeError('file_too_large', 'That file is larger than 5 MB.');
      }

      const existing = await ensureRoom(userId);
      const id = deps.newId();
      const filename = sanitiseFilename(input.filename);
      const upload = await deps.store.presignUpload(originalKey(userId, id, filename), {
        contentType,
        size: input.size,
        expiresInSeconds: UPLOAD_EXPIRY_SECONDS,
      });

      const stamp = now();
      const resume: StoredResume = {
        id,
        label: input.label ?? labelFromFilename(input.filename),
        notes: '',
        text: '',
        status: 'processing',
        source: 'upload',
        isDefault: existing.length === 0,
        reviewedAt: null,
        original: { filename, size: input.size, contentType },
        createdAt: stamp,
        updatedAt: stamp,
      };
      await deps.repo.create(userId, resume);
      return { resume: toSummary(resume), upload };
    },

    async duplicate(userId: string, id: string): Promise<Resume> {
      await ensureRoom(userId);
      const source = await deps.repo.get(userId, id);
      if (!source) throw new ResumeError('not_found', 'Resume not found.');
      assertReady(source, 'duplicated');
      const stamp = now();
      const copy: StoredResume = {
        ...source,
        id: deps.newId(),
        label: `${source.label.slice(0, 73)} (copy)`,
        isDefault: false,
        createdAt: stamp,
        updatedAt: stamp,
      };
      // The Original belongs to the source: a copy is text only.
      delete copy.parentResumeId;
      delete copy.original;
      delete copy.failure;
      await deps.repo.create(userId, copy);
      return toResume(copy);
    },

    /** Editing the text, or confirming it, marks the resume as reviewed. */
    async update(userId: string, id: string, input: UpdateResumeRequest): Promise<Resume | null> {
      // Editing the text counts as reviewing it, so both need a ready Resume. Checked first, so a refusal changes nothing.
      if (input.reviewed || input.text !== undefined) {
        const current = await deps.repo.get(userId, id);
        if (!current) return null;
        assertReady(current, 'marked as reviewed or have its text edited');
      }
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

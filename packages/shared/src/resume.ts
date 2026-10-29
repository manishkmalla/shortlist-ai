import { z } from 'zod';

export const MAX_RESUMES = 10;
export const MIN_RESUME_TEXT_CHARS = 20;
/** Resumes are rejected above this rather than truncated. Also keeps each DynamoDB item well under 400 KB. */
export const MAX_RESUME_TEXT_CHARS = 60_000;

export const resumeStatusSchema = z.enum(['processing', 'ready', 'failed']);
export type ResumeStatus = z.infer<typeof resumeStatusSchema>;

export const resumeSourceSchema = z.enum(['paste', 'upload']);
export type ResumeSource = z.infer<typeof resumeSourceSchema>;

export const resumeLabelSchema = z
  .string()
  .trim()
  .min(1, 'Give the resume a label')
  .max(80, 'Use 80 characters or fewer');
export const resumeNotesSchema = z.string().trim().max(500, 'Use 500 characters or fewer');

export const resumeTextSchema = z
  .string()
  .refine((t) => t.trim().length >= MIN_RESUME_TEXT_CHARS, 'The resume text is too short')
  .refine(
    (t) => t.length <= MAX_RESUME_TEXT_CHARS,
    `The resume is too long (the limit is ${MAX_RESUME_TEXT_CHARS.toLocaleString('en-US')} characters)`,
  );

/** Why an uploaded file could not be turned into text. The message is safe to show to the user. */
export const resumeFailureCodeSchema = z.enum([
  'no_readable_text',
  'password_protected',
  'corrupt',
  'wrong_type',
  'file_too_large',
  'text_too_long',
  'unsupported_encoding',
  'upload_incomplete',
]);
export type ResumeFailureCode = z.infer<typeof resumeFailureCodeSchema>;

export const resumeFailureSchema = z.object({ code: resumeFailureCodeSchema, message: z.string() });
export type ResumeFailure = z.infer<typeof resumeFailureSchema>;

/** Library listing: metadata only, never the text. */
export const resumeSummarySchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  notes: z.string(),
  status: resumeStatusSchema,
  source: resumeSourceSchema,
  isDefault: z.boolean(),
  /** False until the user has seen and accepted the text (always true for pasted resumes). */
  reviewed: z.boolean(),
  textLength: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
  /** True when the user uploaded a file, which is kept for download (the Original). Never exposes where it is stored. */
  hasOriginal: z.boolean(),
  /** Set when an upload could not be read. */
  failureReason: resumeFailureSchema.nullable(),
  parentResumeId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ResumeSummary = z.infer<typeof resumeSummarySchema>;

export const resumeSchema = resumeSummarySchema.extend({ text: z.string() });
export type Resume = z.infer<typeof resumeSchema>;

export const resumeListSchema = z.object({ resumes: z.array(resumeSummarySchema) });
export type ResumeList = z.infer<typeof resumeListSchema>;

export const createResumeRequestSchema = z
  .object({ label: resumeLabelSchema, text: resumeTextSchema, notes: resumeNotesSchema.optional() })
  .strict();
export type CreateResumeRequest = z.infer<typeof createResumeRequestSchema>;

export const updateResumeRequestSchema = z
  .object({
    label: resumeLabelSchema.optional(),
    notes: resumeNotesSchema.optional(),
    text: resumeTextSchema.optional(),
    /** Only `true` is accepted: the default is changed by choosing a new one. */
    isDefault: z.literal(true).optional(),
    /** The user confirms they have reviewed the extracted text. */
    reviewed: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide a field to update',
  });
export type UpdateResumeRequest = z.infer<typeof updateResumeRequestSchema>;

/** Largest file a user may upload as an Original. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The types an Original can have, and the content type each one is stored and downloaded as. */
export const ORIGINAL_CONTENT_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
} as const;
export type OriginalExtension = keyof typeof ORIGINAL_CONTENT_TYPES;
export const ORIGINAL_EXTENSIONS = Object.keys(ORIGINAL_CONTENT_TYPES) as OriginalExtension[];

/** The types that can be uploaded today. Later tickets add `pdf` and `docx` here once they can be read. */
export const UPLOADABLE_EXTENSIONS: readonly OriginalExtension[] = ['txt'];

export const requestUploadSchema = z
  .object({
    filename: z.string().min(1).max(255),
    size: z.number().int().positive(),
    /** What the browser reports for the file. Optional because browsers often leave it empty. */
    contentType: z.string().max(255).optional(),
    label: resumeLabelSchema.optional(),
  })
  .strict();
export type RequestUploadRequest = z.infer<typeof requestUploadSchema>;

/** A short-lived permission to send one file straight to storage. */
export const presignedUploadSchema = z.object({
  url: z.string().url(),
  method: z.literal('PUT'),
  /** The exact headers the browser must send. The signature covers them. */
  headers: z.record(z.string()),
  expiresInSeconds: z.number().int().positive(),
});
export type PresignedUpload = z.infer<typeof presignedUploadSchema>;

export const uploadStartedSchema = z.object({
  resume: resumeSummarySchema,
  upload: presignedUploadSchema,
});
export type UploadStarted = z.infer<typeof uploadStartedSchema>;

import { zodResolver } from '@hookform/resolvers/zod';
import {
  createResumeRequestSchema,
  MAX_RESUME_TEXT_CHARS,
  type CreateResumeRequest,
} from '@shortlist-ai/shared';
import { useEffect, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Button, Input, Textarea } from '../../components/ui';

export type ResumeFormValues = CreateResumeRequest;
export type ChangedFields = Partial<Record<keyof ResumeFormValues, boolean>>;

export function CharacterCount({ count }: { count: number }) {
  const over = count - MAX_RESUME_TEXT_CHARS;
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {count.toLocaleString('en-US')} / {MAX_RESUME_TEXT_CHARS.toLocaleString('en-US')} characters
      </p>
      {over > 0 && (
        <p role="status" className="text-xs font-medium text-bad dark:text-red-400">
          Too long by {over.toLocaleString('en-US')} characters. Shorten it to save.
        </p>
      )}
    </div>
  );
}

interface Props {
  defaultValues?: Partial<ResumeFormValues>;
  /** Resolve true when the save worked. The form then marks itself clean. */
  onSubmit: (values: ResumeFormValues, changed: ChangedFields) => Promise<boolean>;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  submitLabel: string;
  showNotes?: boolean;
  error?: string | null;
  /** Extra buttons next to Save, for example Cancel. */
  actions?: ReactNode;
}

/** Label, notes and text for a resume. Shared by the editor page and the onboarding step. */
export function ResumeForm({
  defaultValues,
  onSubmit,
  onSaved,
  onDirtyChange,
  submitLabel,
  showNotes = true,
  error,
  actions,
}: Props) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty, isSubmitting, dirtyFields },
  } = useForm<ResumeFormValues>({
    resolver: zodResolver(createResumeRequestSchema),
    defaultValues: { label: '', notes: '', text: '', ...defaultValues },
  });

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  const submit = handleSubmit(async (values) => {
    if (await onSubmit(values, dirtyFields)) {
      reset(values);
      onSaved?.();
    }
  });

  const length = watch('text')?.length ?? 0;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-control bg-red-50 px-3 py-2 text-sm text-bad dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <Input
        label="Label"
        placeholder="AI Engineer"
        maxLength={200}
        error={errors.label?.message}
        {...register('label')}
      />
      {showNotes && (
        <Input
          label="Notes (optional)"
          hint="Only you see these."
          error={errors.notes?.message}
          {...register('notes')}
        />
      )}
      <Textarea
        label="Resume text"
        hint="Paste your resume as plain text. This is exactly what the AI reads, so fix anything that looks wrong."
        rows={18}
        spellCheck={false}
        className="font-mono"
        error={errors.text?.message}
        footer={<CharacterCount count={length} />}
        {...register('text')}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
        {actions}
      </div>
    </form>
  );
}

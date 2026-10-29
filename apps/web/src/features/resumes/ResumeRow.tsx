import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ResumeSummary } from '@shortlist-ai/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  Input,
  useToast,
} from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useDeleteResume, useDuplicateResume, useUpdateResume } from './hooks';
import { formatDate, formatWords, sourceLabel } from './format';

const itemClass =
  'cursor-default rounded-md px-3 py-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-slate-100 dark:data-[highlighted]:bg-slate-800';

function RenameDialog({
  resume,
  open,
  onOpenChange,
}: {
  resume: ResumeSummary;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const update = useUpdateResume();
  const [label, setLabel] = useState(resume.label);
  const blank = label.trim() === '';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setLabel(resume.label);
          update.reset();
        }
        onOpenChange(o);
      }}
    >
      <DialogContent
        title="Rename resume"
        description="Only the label changes. The text stays as it is."
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (blank) return;
            update.mutate(
              { id: resume.id, body: { label: label.trim() } },
              {
                onSuccess: () => {
                  toast({ title: 'Resume renamed', tone: 'good' });
                  onOpenChange(false);
                },
              },
            );
          }}
        >
          <Input
            label="Label"
            value={label}
            maxLength={200}
            onChange={(e) => setLabel(e.target.value)}
            error={update.isError ? errorMessage(update.error) : undefined}
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" loading={update.isPending} disabled={blank}>
              Rename
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  resume,
  nextDefault,
  open,
  onOpenChange,
}: {
  resume: ResumeSummary;
  nextDefault: ResumeSummary | undefined;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const del = useDeleteResume();
  const promotes = resume.isDefault && nextDefault;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) del.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent
        title={`Delete "${resume.label}"?`}
        description={
          promotes
            ? `This resume is your default. "${nextDefault.label}" will become your default resume instead. Deleting cannot be undone.`
            : 'Deleting cannot be undone.'
        }
      >
        {del.isError && (
          <p role="alert" className="mb-3 text-sm text-bad dark:text-red-400">
            {errorMessage(del.error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={del.isPending}
            onClick={() =>
              del.mutate(resume.id, {
                onSuccess: () => {
                  toast({ title: 'Resume deleted' });
                  onOpenChange(false);
                },
              })
            }
          >
            Delete resume
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ResumeRow({
  resume,
  nextDefault,
  atLimit,
}: {
  resume: ResumeSummary;
  /** The resume that becomes the default if this one is deleted (the server picks the most recently updated). */
  nextDefault: ResumeSummary | undefined;
  atLimit: boolean;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const update = useUpdateResume();
  const duplicate = useDuplicateResume();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fail = (title: string) => (e: unknown) =>
    toast({ title, description: errorMessage(e), tone: 'bad' });

  return (
    <li className="flex items-start justify-between gap-3 rounded-card border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/resumes/${resume.id}`} className="truncate font-medium hover:underline">
            {resume.label}
          </Link>
          {resume.isDefault && <Badge tone="accent">Default</Badge>}
          {resume.status === 'processing' && <Badge tone="caution">Processing</Badge>}
          {resume.status === 'failed' && <Badge tone="bad">Failed</Badge>}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {sourceLabel(resume)} · Updated {formatDate(resume.updatedAt)} ·{' '}
          {formatWords(resume.wordCount)}
        </p>
        {resume.notes && (
          <p className="truncate text-sm text-slate-600 dark:text-slate-400">{resume.notes}</p>
        )}
      </div>

      <Menu.Root>
        <Menu.Trigger
          aria-label={`Actions for ${resume.label}`}
          className="rounded-control px-2 py-1 text-lg leading-none hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <span aria-hidden>⋯</span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-48 rounded-card border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-800 dark:bg-slate-900"
          >
            <Menu.Item className={itemClass} onSelect={() => navigate(`/resumes/${resume.id}`)}>
              Edit text
            </Menu.Item>
            <Menu.Item className={itemClass} onSelect={() => setRenameOpen(true)}>
              Rename
            </Menu.Item>
            <Menu.Item
              className={itemClass}
              disabled={atLimit}
              onSelect={() =>
                duplicate.mutate(resume.id, {
                  onSuccess: () => toast({ title: 'Resume duplicated', tone: 'good' }),
                  onError: fail('Could not duplicate the resume'),
                })
              }
            >
              Duplicate{atLimit ? ' (limit reached)' : ''}
            </Menu.Item>
            {!resume.isDefault && (
              <Menu.Item
                className={itemClass}
                onSelect={() =>
                  update.mutate(
                    { id: resume.id, body: { isDefault: true } },
                    {
                      onSuccess: () =>
                        toast({
                          title: 'Default resume updated',
                          description: resume.label,
                          tone: 'good',
                        }),
                      onError: fail('Could not change the default resume'),
                    },
                  )
                }
              >
                Set as default
              </Menu.Item>
            )}
            <Menu.Separator className="my-1 h-px bg-slate-200 dark:bg-slate-800" />
            <Menu.Item className={`${itemClass} text-bad`} onSelect={() => setDeleteOpen(true)}>
              Delete
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <RenameDialog resume={resume} open={renameOpen} onOpenChange={setRenameOpen} />
      <DeleteDialog
        resume={resume}
        nextDefault={nextDefault}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </li>
  );
}

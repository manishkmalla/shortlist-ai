import { zodResolver } from '@hookform/resolvers/zod';
import { putApiKeyRequestSchema, type PutApiKeyRequest } from '@shortlist-ai/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Badge, Button, Dialog, DialogClose, DialogContent, DialogTrigger, Input, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { ApiKeyGuide, ApiKeyPrivacyNote } from './ApiKeyGuide';
import { useApiKeyStatus, useRemoveApiKey, useSaveApiKey, useTestApiKey } from './hooks';

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

function KeyInput({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const { toast } = useToast();
  const save = useSaveApiKey();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PutApiKeyRequest>({ resolver: zodResolver(putApiKeyRequestSchema) });

  const onSubmit = handleSubmit((values) =>
    save.mutate(values.apiKey, {
      onSuccess: () => {
        reset({ apiKey: '' });
        toast({ title: 'Key verified and saved', tone: 'good' });
        onDone();
      },
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {save.isError && (
        <p role="alert" className="rounded-control bg-red-50 px-3 py-2 text-sm text-bad dark:bg-red-950 dark:text-red-300">
          {errorMessage(save.error)}
        </p>
      )}
      <Input
        label="Anthropic API key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder="sk-ant-..."
        error={errors.apiKey?.message}
        {...register('apiKey')}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending}>
          {save.isPending ? 'Verifying...' : 'Save'}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function SavedKey({ lastFour, validatedAt, onReplace }: { lastFour: string; validatedAt: string | null; onReplace: () => void }) {
  const { toast } = useToast();
  const test = useTestApiKey();
  const remove = useRemoveApiKey();
  const [removeOpen, setRemoveOpen] = useState(false);
  const masked = `sk-ant-...${lastFour}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={validatedAt ? 'good' : 'caution'}>{validatedAt ? 'Verified' : 'Needs attention'}</Badge>
        <p className="text-sm">
          {validatedAt ? 'Key verified' : 'Key needs attention'}: <span className="font-mono">{masked}</span>
        </p>
      </div>
      {validatedAt ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">Last verified {formatDate(validatedAt)}.</p>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Anthropic did not accept this key the last time it was checked. Test the connection, or replace the key.
        </p>
      )}
      {test.isError && (
        <p role="alert" className="rounded-control bg-red-50 px-3 py-2 text-sm text-bad dark:bg-red-950 dark:text-red-300">
          {errorMessage(test.error)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          loading={test.isPending}
          onClick={() => test.mutate(undefined, { onSuccess: () => toast({ title: 'Connection works', tone: 'good' }) })}
        >
          Test connection
        </Button>
        <Button variant="secondary" onClick={onReplace}>
          Replace
        </Button>
        <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost">Remove</Button>
          </DialogTrigger>
          <DialogContent
            title="Remove your API key?"
            description="Analyses are switched off until you add a key again. You can also revoke it in the Anthropic console."
          >
            {remove.isError && (
              <p role="alert" className="mb-3 text-sm text-bad dark:text-red-400">
                {errorMessage(remove.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(undefined, {
                    onSuccess: () => {
                      setRemoveOpen(false);
                      toast({ title: 'API key removed' });
                    },
                  })
                }
              >
                Remove key
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

/** Shared by Settings and the onboarding wizard. */
export function ApiKeyForm({ guideOpen = false, onSaved }: { guideOpen?: boolean; onSaved?: () => void }) {
  const status = useApiKeyStatus();
  const [replacing, setReplacing] = useState(false);

  if (status.isPending) return <p role="status" className="text-sm text-slate-500">Loading...</p>;
  if (status.isError) {
    return (
      <p role="alert" className="text-sm text-bad dark:text-red-400">
        Could not load your key status.{' '}
        <button type="button" onClick={() => void status.refetch()} className="font-medium underline">
          Retry
        </button>
      </p>
    );
  }

  const { configured, lastFour, validatedAt } = status.data;
  const showSaved = configured && lastFour && !replacing;

  return (
    <div className="space-y-4">
      {showSaved ? (
        <SavedKey lastFour={lastFour} validatedAt={validatedAt} onReplace={() => setReplacing(true)} />
      ) : (
        <>
          <ApiKeyGuide defaultOpen={guideOpen} />
          <KeyInput
            onDone={() => {
              setReplacing(false);
              onSaved?.();
            }}
            onCancel={replacing ? () => setReplacing(false) : undefined}
          />
        </>
      )}
      <ApiKeyPrivacyNote />
    </div>
  );
}

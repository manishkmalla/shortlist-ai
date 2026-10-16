import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button, Card, Dialog, DialogClose, DialogContent, DialogTrigger, Input, useToast } from '../../components/ui';
import { useDeleteAccount, useProfile, useUpdateProfile } from './hooks';

const CONFIRM_WORD = 'DELETE';

const renameSchema = z.object({ name: z.string().trim().min(1, 'Enter your full name').max(100) });
type RenameValues = z.infer<typeof renameSchema>;

function RenameForm({ name }: { name: string }) {
  const { toast } = useToast();
  const update = useUpdateProfile();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name },
  });
  useEffect(() => reset({ name }), [name, reset]);

  const onSubmit = handleSubmit((values) =>
    update.mutate(values, {
      onSuccess: () => toast({ title: 'Name updated', tone: 'good' }),
      onError: () => toast({ title: 'Could not update your name', description: 'Please try again.', tone: 'bad' }),
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Input
        label="Full name"
        hint="Used to sign your cover letters."
        autoComplete="name"
        error={errors.name?.message}
        {...register('name')}
      />
      <Button type="submit" loading={update.isPending} disabled={!isDirty}>
        Save name
      </Button>
    </form>
  );
}

function DeleteAccount() {
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(false);
  const del = useDeleteAccount();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="danger">Delete account</Button>
      </DialogTrigger>
      <DialogContent
        title="Delete your account?"
        description="This permanently removes your profile and all your data. It cannot be undone."
      >
        <div className="space-y-4">
          <Input
            label={`Type ${CONFIRM_WORD} to confirm`}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {del.isError && (
            <p role="alert" className="text-sm text-bad dark:text-red-400">
              Could not delete your account. Please try again.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={del.isPending}
              disabled={typed !== CONFIRM_WORD}
              onClick={() => del.mutate()}
            >
              Delete everything
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AccountSettings() {
  const profile = useProfile();

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Profile</h2>
        {profile.isPending && <p role="status" className="text-sm text-slate-500">Loading...</p>}
        {profile.isError && (
          <p role="alert" className="text-sm text-bad dark:text-red-400">
            Could not load your profile.{' '}
            <button type="button" onClick={() => void profile.refetch()} className="font-medium underline">
              Retry
            </button>
          </p>
        )}
        {profile.data && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">Signed in as {profile.data.email}</p>
            <RenameForm name={profile.data.name} />
          </>
        )}
      </Card>
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Delete account</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Removes your profile and everything stored for you. You can sign up again later with the same email.
        </p>
        <DeleteAccount />
      </Card>
    </div>
  );
}

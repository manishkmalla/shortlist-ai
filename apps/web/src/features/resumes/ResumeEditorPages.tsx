import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Card, buttonStyles, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { useCreateResume, useResume, useResumes, useUpdateResume } from './hooks';
import { ResumeForm, type ChangedFields, type ResumeFormValues } from './ResumeForm';
import { DiscardChangesDialog, useLeaveGuard } from './useLeaveGuard';

function Back() {
  return (
    <Link to="/resumes" className="text-sm font-medium text-accent dark:text-accent-dark">
      Back to My Resumes
    </Link>
  );
}

export function NewResumePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const create = useCreateResume();
  const existing = useResumes();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { blocker, leave } = useLeaveGuard(dirty);

  const save = async (values: ResumeFormValues) => {
    setError(null);
    try {
      const saved = await create.mutateAsync({ ...values, notes: values.notes || undefined });
      toast({
        title: 'Resume saved',
        description: saved.isDefault ? 'It is your default resume.' : undefined,
        tone: 'good',
      });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <Back />
      <h1 className="text-2xl font-semibold">Add a resume</h1>
      <Card>
        {existing.data && existing.data.length === 0 && (
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
            This will be your default resume. You can change that later.
          </p>
        )}
        <ResumeForm
          submitLabel="Save resume"
          error={error}
          onSubmit={save}
          onDirtyChange={setDirty}
          onSaved={() => leave(() => navigate('/resumes'))}
          actions={
            <Link to="/resumes" className={buttonStyles('secondary')}>
              Cancel
            </Link>
          }
        />
      </Card>
      <DiscardChangesDialog blocker={blocker} />
    </div>
  );
}

export function EditResumePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const resume = useResume(id);
  const update = useUpdateResume();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { blocker, leave } = useLeaveGuard(dirty);

  if (resume.isPending)
    return (
      <p role="status" className="text-sm text-slate-500">
        Loading...
      </p>
    );
  if (resume.isError) {
    return (
      <div className="space-y-4">
        <Back />
        <p role="alert" className="text-sm text-slate-600 dark:text-slate-400">
          We could not find that resume. It may have been deleted.
        </p>
      </div>
    );
  }

  const save = async (values: ResumeFormValues, changed: ChangedFields) => {
    setError(null);
    try {
      // Send only what changed, so editing the label does not re-mark the text as reviewed.
      await update.mutateAsync({
        id: resume.data.id,
        body: {
          ...(changed.label ? { label: values.label } : {}),
          ...(changed.notes ? { notes: values.notes ?? '' } : {}),
          ...(changed.text ? { text: values.text } : {}),
        },
      });
      toast({ title: 'Resume saved', tone: 'good' });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <Back />
      <h1 className="text-2xl font-semibold">Edit resume</h1>
      <Card>
        <ResumeForm
          key={resume.data.id}
          defaultValues={{
            label: resume.data.label,
            notes: resume.data.notes,
            text: resume.data.text,
          }}
          submitLabel="Save changes"
          error={error}
          onSubmit={save}
          onDirtyChange={setDirty}
          onSaved={() => leave(() => navigate('/resumes'))}
          actions={
            <Button variant="secondary" onClick={() => navigate('/resumes')}>
              Cancel
            </Button>
          }
        />
      </Card>
      <DiscardChangesDialog blocker={blocker} />
    </div>
  );
}

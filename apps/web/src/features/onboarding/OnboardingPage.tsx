import { MAX_RESUMES, type OnboardingStep } from '@shortlist-ai/shared';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Card, Stepper, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { ApiKeyForm } from '../apiKey/ApiKeyForm';
import { useApiKeyStatus } from '../apiKey/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../auth/RouteGuards';
import { useProfile, useUpdateProfile } from '../profile/hooks';
import { useCreateResume, useResumes } from '../resumes/hooks';
import { ResumeForm, type ResumeFormValues } from '../resumes/ResumeForm';

const LABELS = ['Welcome', 'API key', 'Resume', 'Done'];
const INDEX: Record<OnboardingStep, number> = { welcome: 0, 'api-key': 1, resume: 2, done: 3 };

function Welcome({ name, onNext, busy }: { name: string; onNext: () => void; busy: boolean }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Welcome to Shortlist AI, {name.split(' ')[0]}</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Paste a job description, pick one of your resumes, and get a match score, a gap analysis, a
        tailored cover letter and an ATS-friendly resume.
      </p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Shortlist AI runs on <strong>your own Anthropic API key</strong>. You pay Anthropic
        directly, pay-as-you-go, for what you use. There is no subscription and we never see a bill.
        Setup takes about two minutes.
      </p>
      <Button onClick={onNext} loading={busy}>
        Get started
      </Button>
    </div>
  );
}

function KeyStep({
  onBack,
  onNext,
  busy,
}: {
  onBack: () => void;
  onNext: () => void;
  busy: boolean;
}) {
  const key = useApiKeyStatus();
  const verified = Boolean(key.data?.configured && key.data.validatedAt);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Add your Anthropic API key</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        This is required. We check it with Anthropic before saving it.
      </p>
      <ApiKeyForm guideOpen />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button onClick={onNext} disabled={!verified} loading={busy}>
          Continue
        </Button>
      </div>
      {!verified && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Save a verified key to continue.
        </p>
      )}
    </div>
  );
}

function ResumeStep({
  onBack,
  onFinish,
  busy,
}: {
  onBack: () => void;
  onFinish: () => void;
  busy: boolean;
}) {
  const { toast } = useToast();
  const resumes = useResumes();
  const create = useCreateResume();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  const count = resumes.data?.length ?? 0;
  const showForm = resumes.data && (count === 0 || adding);

  const save = async (values: ResumeFormValues) => {
    setError(null);
    try {
      const saved = await create.mutateAsync({ label: values.label, text: values.text });
      setSavedLabel(saved.label);
      toast({ title: 'Resume saved', tone: 'good' });
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Add your first resume</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Paste your resume as text. You can add more, and upload files, from My Resumes later. This
        step is optional.
      </p>

      {resumes.isPending && (
        <p role="status" className="text-sm text-slate-500">
          Loading...
        </p>
      )}
      {resumes.isError && (
        <p role="alert" className="text-sm text-bad dark:text-red-400">
          Could not load your resumes. You can skip this step and add one later.
        </p>
      )}

      {showForm && (
        <ResumeForm
          showNotes={false}
          submitLabel="Save resume"
          error={error}
          onSubmit={save}
          onSaved={() => setAdding(false)}
          actions={
            count > 0 ? (
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            ) : undefined
          }
        />
      )}

      {resumes.data && count > 0 && !adding && (
        <div className="space-y-3 rounded-control border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
          {savedLabel && <p className="text-sm font-medium">Saved: {savedLabel}</p>}
          <p className="text-sm text-slate-600 dark:text-slate-400">
            You have {count} {count === 1 ? 'resume' : 'resumes'}.
          </p>
          {count < MAX_RESUMES && (
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              Add another
            </Button>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onBack} disabled={busy}>
          Back
        </Button>
        {count > 0 && !adding ? (
          <Button onClick={onFinish} loading={busy}>
            Finish setup
          </Button>
        ) : (
          <Button variant="secondary" onClick={onFinish} loading={busy}>
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signOut } = useAuth();
  const profile = useProfile();
  const update = useUpdateProfile();

  if (profile.isPending) return <Loading />;
  if (profile.isError) {
    return (
      <div role="alert" className="grid min-h-screen place-items-center px-4 text-center">
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">Could not load your account.</p>
          <Button variant="secondary" onClick={() => void profile.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (profile.data.onboardingCompletedAt) return <Navigate to="/" replace />;

  const step = profile.data.onboardingStep;
  const goTo = (onboardingStep: OnboardingStep) => {
    update.reset();
    update.mutate({ onboardingStep });
  };
  const finish = () => {
    update.reset();
    update.mutate(
      { onboardingStep: 'done' },
      {
        onSuccess: () => {
          toast({
            title: "You're all set",
            description: 'Paste a job description to run your first analysis.',
            tone: 'good',
          });
          navigate('/', { replace: true });
        },
      },
    );
  };

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <span
            aria-hidden
            className="inline-block size-5 rounded-md bg-accent dark:bg-accent-dark"
          />
          Shortlist AI
        </div>
        <Stepper steps={LABELS} current={INDEX[step]} />
        <Card className="space-y-4">
          {update.isError && (
            <p
              role="alert"
              className="rounded-control bg-red-50 px-3 py-2 text-sm text-bad dark:bg-red-950 dark:text-red-300"
            >
              {errorMessage(update.error)}
            </p>
          )}
          {step === 'welcome' && (
            <Welcome
              name={profile.data.name}
              busy={update.isPending}
              onNext={() => goTo('api-key')}
            />
          )}
          {step === 'api-key' && (
            <KeyStep
              busy={update.isPending}
              onBack={() => goTo('welcome')}
              onNext={() => goTo('resume')}
            />
          )}
          {step === 'resume' && (
            <ResumeStep busy={update.isPending} onBack={() => goTo('api-key')} onFinish={finish} />
          )}
        </Card>
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Not now?{' '}
          <button type="button" onClick={() => void signOut()} className="font-medium underline">
            Sign out
          </button>{' '}
          and pick up where you left off later.
        </p>
      </div>
    </main>
  );
}

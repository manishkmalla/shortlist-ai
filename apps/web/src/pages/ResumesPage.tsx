import { MAX_RESUMES } from '@shortlist-ai/shared';
import { Link } from 'react-router-dom';
import { Button, Card, buttonStyles } from '../components/ui';
import { useResumes } from '../features/resumes/hooks';
import { ResumeRow } from '../features/resumes/ResumeRow';

export function ResumesPage() {
  const resumes = useResumes();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">My Resumes</h1>
        {resumes.data &&
          (resumes.data.length >= MAX_RESUMES ? (
            <Button disabled>Add resume</Button>
          ) : (
            <Link to="/resumes/new" className={buttonStyles('primary')}>
              Add resume
            </Link>
          ))}
      </div>

      {resumes.isPending && (
        <p role="status" className="text-sm text-slate-500">
          Loading...
        </p>
      )}

      {resumes.isError && (
        <p role="alert" className="text-sm text-bad dark:text-red-400">
          Could not load your resumes.{' '}
          <button
            type="button"
            onClick={() => void resumes.refetch()}
            className="font-medium underline"
          >
            Retry
          </button>
        </p>
      )}

      {resumes.data && resumes.data.length === 0 && (
        <Card className="space-y-3 text-center">
          <h2 className="text-lg font-semibold">No resumes yet</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Add a resume to use it in an analysis. The first one you add becomes your default
            resume.
          </p>
          <div>
            <Link to="/resumes/new" className={buttonStyles('primary')}>
              Add your first resume
            </Link>
          </div>
        </Card>
      )}

      {resumes.data && resumes.data.length > 0 && (
        <>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {resumes.data.length} of {MAX_RESUMES} used
            {resumes.data.length >= MAX_RESUMES && '. Delete one to add another.'}
          </p>
          <ul className="space-y-3">
            {resumes.data.map((r) => (
              <ResumeRow
                key={r.id}
                resume={r}
                // The list is newest first, and the server promotes the most recently updated remaining resume.
                nextDefault={resumes.data.find((other) => other.id !== r.id)}
                atLimit={resumes.data.length >= MAX_RESUMES}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

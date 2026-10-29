import {
  MAX_UPLOAD_BYTES,
  UPLOADABLE_EXTENSIONS,
  type PresignedUpload,
} from '@shortlist-ai/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { uploadFile } from '../../lib/uploader';
import { resumesKey, useResume } from './hooks';
import { resumesApi } from './resumesApi';

type Phase = 'requesting' | 'uploading' | 'extracting';
interface Working {
  filename: string;
  phase: Phase;
  progress: number;
  resumeId?: string;
}

const supported = UPLOADABLE_EXTENSIONS.map((e) => `.${e}`).join(', ');

/** Checks a chosen file before anything is sent. The server checks again, so this only saves the user a wait. */
function problemWith(file: File): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (
    !file.name.includes('.') ||
    !(UPLOADABLE_EXTENSIONS as readonly string[]).includes(extension)
  ) {
    return `Only ${supported} files can be uploaded for now. You can also paste your resume text.`;
  }
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_UPLOAD_BYTES) return 'That file is larger than 5 MB.';
  return null;
}

export function UploadPanel() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState<Working | null>(null);

  // Once the file is uploaded, watch the Resume until it is read.
  const resume = useResume(working?.phase === 'extracting' ? working.resumeId : undefined, {
    poll: true,
  });
  const outcome = resume.data?.status;

  useEffect(() => {
    if (outcome === 'ready' || outcome === 'failed')
      void queryClient.invalidateQueries({ queryKey: resumesKey });
  }, [outcome, queryClient]);

  const reset = () => {
    setProblem(null);
    setWorking(null);
  };

  const start = async (file: File) => {
    const found = problemWith(file);
    if (found) {
      setWorking(null);
      setProblem(found);
      return;
    }
    setProblem(null);
    setWorking({ filename: file.name, phase: 'requesting', progress: 0 });

    let upload: PresignedUpload;
    let resumeId: string;
    try {
      const started = await resumesApi.requestUpload({
        filename: file.name,
        size: file.size,
        contentType: file.type,
      });
      upload = started.upload;
      resumeId = started.resume.id;
    } catch (e) {
      setWorking(null);
      setProblem(errorMessage(e));
      return;
    }

    void queryClient.invalidateQueries({ queryKey: resumesKey });
    setWorking({ filename: file.name, phase: 'uploading', progress: 0, resumeId });
    try {
      await uploadFile(upload, file, (progress) => setWorking((w) => (w ? { ...w, progress } : w)));
    } catch {
      setWorking(null);
      setProblem('The upload did not finish. Check your connection and try again.');
      void queryClient.invalidateQueries({ queryKey: resumesKey });
      return;
    }
    setWorking({ filename: file.name, phase: 'extracting', progress: 1, resumeId });
  };

  const percent = Math.round((working?.progress ?? 0) * 100);
  const failureMessage =
    resume.data?.failureReason?.message ??
    (resume.isError
      ? 'We could not find this file any more. It may have been deleted.'
      : 'We could not read this file.');
  const failed = working?.phase === 'extracting' && (outcome === 'failed' || resume.isError);
  const done = working?.phase === 'extracting' && outcome === 'ready';

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Upload your resume as a {supported} file, up to 5 MB. We read the text so you can check it
        before it is used.
      </p>

      <input
        ref={inputRef}
        type="file"
        aria-label="Resume file"
        accept=".txt,text/plain"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void start(file);
        }}
      />

      {!working && (
        <Button variant="secondary" onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
      )}

      {problem && (
        <p
          role="alert"
          className="rounded-control bg-red-50 px-3 py-2 text-sm text-bad dark:bg-red-950 dark:text-red-300"
        >
          {problem}
        </p>
      )}

      {problem && !working && (
        <Button variant="ghost" size="sm" onClick={reset}>
          Choose another file
        </Button>
      )}

      {working && !failed && !done && (
        <div
          className="space-y-2 rounded-control border border-slate-200 p-4 dark:border-slate-800"
          aria-live="polite"
        >
          <p className="truncate text-sm font-medium">{working.filename}</p>
          {working.phase === 'requesting' && (
            <p className="text-sm text-slate-500">Preparing upload...</p>
          )}
          {working.phase === 'uploading' && (
            <>
              <p className="text-sm text-slate-500">Uploading... {percent}%</p>
              <div
                role="progressbar"
                aria-label={`Uploading ${working.filename}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
              >
                <div
                  className="h-full bg-accent dark:bg-accent-dark"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </>
          )}
          {working.phase === 'extracting' && (
            <p className="text-sm text-slate-500">Extracting text...</p>
          )}
        </div>
      )}

      {done && (
        <div className="space-y-3 rounded-control border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm font-medium">
            Done. {working.filename} is in your resume library and needs review.
          </p>
          <div className="flex gap-3">
            <Link to="/resumes" className="text-sm font-medium text-accent dark:text-accent-dark">
              Go to My Resumes
            </Link>
            <Button variant="ghost" size="sm" onClick={reset}>
              Choose another file
            </Button>
          </div>
        </div>
      )}

      {failed && (
        <div className="space-y-3">
          <p
            role="alert"
            className="rounded-control bg-red-50 px-3 py-2 text-sm text-bad dark:bg-red-950 dark:text-red-300"
          >
            {failureMessage}
          </p>
          <Button variant="ghost" size="sm" onClick={reset}>
            Choose another file
          </Button>
        </div>
      )}
    </div>
  );
}

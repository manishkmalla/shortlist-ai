// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MAX_UPLOAD_BYTES,
  type Resume,
  type ResumeSummary,
  type UploadStarted,
} from '@shortlist-ai/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiError } from '../../lib/api';
import { uploadFile } from '../../lib/uploader';
import { TestRouter } from '../../test/TestRouter';
import { apiKeyApi } from '../apiKey/apiKeyApi';
import { AuthProvider } from '../auth/AuthProvider';
import { authClient } from '../auth/authClient';
import { profileApi } from '../profile/profileApi';
import { resumesApi } from './resumesApi';

vi.mock('../auth/authClient', () => ({
  authClient: { currentUser: vi.fn(), logout: vi.fn(), idToken: vi.fn() },
}));
vi.mock('../apiKey/apiKeyApi', () => ({
  apiKeyApi: { status: vi.fn(), save: vi.fn(), test: vi.fn(), remove: vi.fn() },
}));
vi.mock('../profile/profileApi', () => ({
  profileApi: { get: vi.fn(), update: vi.fn(), deleteAccount: vi.fn() },
}));
vi.mock('../../lib/uploader', () => ({ uploadFile: vi.fn() }));
vi.mock('./polling', () => ({ POLL_INTERVAL_MS: 20 }));
vi.mock('./resumesApi', () => ({
  resumesApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(),
    requestUpload: vi.fn(),
  },
}));

const api = vi.mocked(resumesApi);
const uploader = vi.mocked(uploadFile);

const ID = '00000000-0000-4000-8000-000000000001';
const TEXT =
  'Alex Example. Software Engineer with several years of experience building web applications.';

const summary = (over: Partial<ResumeSummary> = {}): ResumeSummary => ({
  id: ID,
  label: 'cv',
  notes: '',
  status: 'processing',
  source: 'upload',
  isDefault: true,
  reviewed: false,
  textLength: 0,
  wordCount: 0,
  hasOriginal: true,
  failureReason: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
  ...over,
});
const full = (over: Partial<Resume> = {}): Resume => ({ ...summary(), text: '', ...over });

const started = (over: Partial<ResumeSummary> = {}): UploadStarted => ({
  resume: summary(over),
  upload: {
    url: 'https://storage.test/signed',
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    expiresInSeconds: 300,
  },
});

const txt = (name = 'cv.txt', content = TEXT) => new File([content], name, { type: 'text/plain' });

beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList;
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authClient.currentUser).mockResolvedValue({
    email: 'alex@example.com',
    name: 'Alex Example',
  });
  vi.mocked(profileApi.get).mockResolvedValue({
    name: 'Alex Example',
    email: 'alex@example.com',
    onboardingStep: 'done',
    onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
    modelId: 'claude-sonnet-5-5',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  vi.mocked(apiKeyApi.status).mockResolvedValue({
    configured: true,
    lastFour: 'wxyz',
    validatedAt: '2026-01-01T00:00:00.000Z',
  });
  api.list.mockResolvedValue([]);
});
afterEach(cleanup);

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TestRouter path={path}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </TestRouter>
    </QueryClientProvider>,
  );
}

const chooseFile = async (user: ReturnType<typeof userEvent.setup>, file: File) =>
  user.upload(await screen.findByLabelText('Resume file'), file);

describe('Add resume: Upload files and Paste text', () => {
  it('has two accessible tabs, with Upload files selected first', async () => {
    renderAt('/resumes/new');
    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Upload files' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Paste text' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument();
  });

  it('keeps pasted text when the user looks at the other tab and comes back', async () => {
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await user.click(await screen.findByRole('tab', { name: 'Paste text' }));
    await user.click(screen.getByLabelText('Resume text'));
    await user.paste(TEXT);
    await user.click(screen.getByRole('tab', { name: 'Upload files' }));
    await user.click(screen.getByRole('tab', { name: 'Paste text' }));
    expect(screen.getByLabelText('Resume text')).toHaveValue(TEXT);
  });

  it('tells the user which files are accepted and the size limit', async () => {
    renderAt('/resumes/new');
    expect(await screen.findByText(/\.txt/)).toBeInTheDocument();
    expect(screen.getByText(/5 MB/)).toBeInTheDocument();
  });
});

describe('uploading a text file', () => {
  it('asks for an upload, sends the file, shows progress, then extracting, then done', async () => {
    api.requestUpload.mockResolvedValue(started());
    let report: (fraction: number) => void = () => undefined;
    let finish: () => void = () => undefined;
    uploader.mockImplementation(
      (_upload, _file, onProgress) =>
        new Promise<void>((resolve) => {
          report = onProgress;
          finish = resolve;
        }),
    );
    api.get
      .mockResolvedValueOnce(full())
      .mockResolvedValue(
        full({ status: 'ready', text: TEXT, textLength: TEXT.length, wordCount: 13 }),
      );
    const user = userEvent.setup();
    renderAt('/resumes/new');
    const file = txt('cv.txt');
    await chooseFile(user, file);

    expect(api.requestUpload).toHaveBeenCalledWith({
      filename: 'cv.txt',
      size: file.size,
      contentType: 'text/plain',
    });
    await waitFor(() => expect(uploader).toHaveBeenCalled());
    expect(uploader.mock.calls[0]![0]).toMatchObject({
      url: 'https://storage.test/signed',
      method: 'PUT',
    });
    expect(uploader.mock.calls[0]![1]).toBe(file);

    report(0.5);
    expect(await screen.findByRole('progressbar', { name: /Uploading cv\.txt/ })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );

    finish();
    expect(await screen.findByText(/Extracting/)).toBeInTheDocument();
    expect(await screen.findByText(/Done/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to My Resumes' })).toHaveAttribute(
      'href',
      '/resumes',
    );
  });

  it('shows why a file could not be read', async () => {
    api.requestUpload.mockResolvedValue(started());
    uploader.mockResolvedValue(undefined);
    api.get.mockResolvedValue(
      full({
        status: 'failed',
        failureReason: {
          code: 'unsupported_encoding',
          message:
            'This text file is not saved as UTF-8. Save it as UTF-8, or paste your resume text instead.',
        },
      }),
    );
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await chooseFile(user, txt());
    expect(await screen.findByRole('alert')).toHaveTextContent('not saved as UTF-8');
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeInTheDocument();
  });

  it('shows the server message when it refuses the request, and sends nothing', async () => {
    api.requestUpload.mockRejectedValue(
      new ApiError(
        409,
        'limit_reached',
        'You can keep up to 10 resumes. Delete one to add another.',
      ),
    );
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await chooseFile(user, txt());
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 10 resumes');
    expect(uploader).not.toHaveBeenCalled();
  });

  it('says so when the connection drops during the upload', async () => {
    api.requestUpload.mockResolvedValue(started());
    uploader.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await chooseFile(user, txt());
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not finish/i);
    expect(api.get).not.toHaveBeenCalled();
  });

  it.each([
    ['a PDF', () => new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }), /\.txt/],
    [
      'a Word document',
      () =>
        new File(['x'], 'cv.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      /\.txt/,
    ],
    ['a file with no extension', () => new File(['hello there'], 'cv', { type: '' }), /\.txt/],
    ['an empty file', () => txt('cv.txt', ''), /empty/i],
  ])('rejects %s in the browser with a message and sends nothing', async (_name, make, message) => {
    const user = userEvent.setup({ applyAccept: false });
    renderAt('/resumes/new');
    await chooseFile(user, make());
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(api.requestUpload).not.toHaveBeenCalled();
  });

  it('rejects a file over 5 MB in the browser', async () => {
    const big = txt('big.txt');
    Object.defineProperty(big, 'size', { value: MAX_UPLOAD_BYTES + 1 });
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await chooseFile(user, big);
    expect(await screen.findByRole('alert')).toHaveTextContent(/5 MB/);
    expect(api.requestUpload).not.toHaveBeenCalled();
  });

  it('lets the user choose another file after a failure', async () => {
    api.requestUpload.mockRejectedValueOnce(
      new ApiError(400, 'type_mismatch', "That file's type does not match its name."),
    );
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await chooseFile(user, txt('one.txt'));
    await screen.findByRole('alert');
    api.requestUpload.mockResolvedValue(started());
    uploader.mockResolvedValue(undefined);
    api.get.mockResolvedValue(full({ status: 'ready', text: TEXT }));
    await user.click(screen.getByRole('button', { name: 'Choose another file' }));
    await chooseFile(user, txt('two.txt'));
    expect(await screen.findByText(/Done/)).toBeInTheDocument();
  });
});

describe('My Resumes while a file is being read', () => {
  it('shows Processing, then updates by itself when reading finishes', async () => {
    api.list
      .mockResolvedValueOnce([summary({ label: 'cv' })])
      .mockResolvedValue([
        summary({ label: 'cv', status: 'ready', textLength: 90, wordCount: 13 }),
      ]);
    renderAt('/resumes');
    expect(await screen.findByText('Processing')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Processing')).not.toBeInTheDocument());
    expect(screen.getByText(/13 words/)).toBeInTheDocument();
  });

  it('stops asking once nothing is processing', async () => {
    api.list.mockResolvedValue([summary({ status: 'ready', textLength: 90, wordCount: 13 })]);
    renderAt('/resumes');
    await screen.findByText(/13 words/);
    const calls = api.list.mock.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(api.list.mock.calls.length).toBe(calls);
  });

  it('shows a failed upload as Failed', async () => {
    api.list.mockResolvedValue([
      summary({
        status: 'failed',
        failureReason: { code: 'wrong_type', message: 'This file does not look like a text file.' },
      }),
    ]);
    renderAt('/resumes');
    expect(await screen.findByText('Failed')).toBeInTheDocument();
  });
});

const readyUnreviewed = (over: Partial<Resume> = {}): Resume =>
  full({
    status: 'ready',
    reviewed: false,
    text: TEXT,
    textLength: TEXT.length,
    wordCount: 13,
    ...over,
  });

describe('Needs review in My Resumes', () => {
  const listWith = (...items: Partial<ResumeSummary>[]) =>
    api.list.mockResolvedValue(
      items.map((over, i) =>
        summary({ id: `00000000-0000-4000-8000-00000000010${i}`, label: `R${i}`, ...over }),
      ),
    );

  it('marks a ready upload that has not been reviewed', async () => {
    listWith({ status: 'ready', reviewed: false, textLength: 90, wordCount: 13 });
    renderAt('/resumes');
    expect(await screen.findByText('Needs review')).toBeInTheDocument();
  });

  it.each([
    ['a reviewed upload', { status: 'ready', reviewed: true }],
    ['a pasted resume', { status: 'ready', reviewed: true, source: 'paste', hasOriginal: false }],
    ['a file still being read', { status: 'processing', reviewed: false }],
    ['a file that could not be read', { status: 'failed', reviewed: false }],
  ] as const)('does not mark %s', async (_name, over) => {
    listWith({ ...over, textLength: 90, wordCount: 13 });
    renderAt('/resumes');
    await screen.findByText(/Updated/);
    expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
  });
});

describe('reviewing an uploaded resume', () => {
  const NOTE = 'Check this against your original. This is what the AI reads.';

  it('shows the extracted text with a note and a Confirm button', async () => {
    api.get.mockResolvedValue(readyUnreviewed());
    renderAt(`/resumes/${ID}`);
    expect(await screen.findByLabelText('Resume text')).toHaveValue(TEXT);
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm text is correct' })).toBeEnabled();
  });

  it('confirming marks it reviewed without sending any text, then returns to the list', async () => {
    api.get.mockResolvedValue(readyUnreviewed());
    api.update.mockResolvedValue(readyUnreviewed({ reviewed: true }));
    api.list.mockResolvedValue([summary({ status: 'ready', reviewed: true })]);
    const user = userEvent.setup();
    renderAt(`/resumes/${ID}`);
    await user.click(await screen.findByRole('button', { name: 'Confirm text is correct' }));
    expect(api.update).toHaveBeenCalledExactlyOnceWith(ID, { reviewed: true });
    expect(await screen.findByRole('heading', { name: 'My Resumes' })).toBeInTheDocument();
    expect(await screen.findByText('Resume marked as reviewed')).toBeInTheDocument();
    expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
  });

  it('cannot confirm text that has unsaved edits, and says why', async () => {
    api.get.mockResolvedValue(readyUnreviewed());
    const user = userEvent.setup();
    renderAt(`/resumes/${ID}`);
    await user.type(await screen.findByLabelText('Resume text'), ' more');
    const confirm = screen.getByRole('button', { name: 'Confirm text is correct' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/Save your changes first/)).toBeInTheDocument();
    // The reason is tied to the button, so assistive technology can announce it.
    expect(confirm).toHaveAccessibleDescription('Save your changes first.');
  });

  it('saving edited text is the other way to finish the review', async () => {
    api.get.mockResolvedValue(readyUnreviewed());
    api.update.mockResolvedValue(readyUnreviewed({ reviewed: true, text: `${TEXT} fixed` }));
    api.list.mockResolvedValue([summary({ status: 'ready', reviewed: true })]);
    const user = userEvent.setup();
    renderAt(`/resumes/${ID}`);
    await user.type(await screen.findByLabelText('Resume text'), ' fixed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api.update).toHaveBeenCalledExactlyOnceWith(ID, { text: `${TEXT} fixed` });
    expect(await screen.findByRole('heading', { name: 'My Resumes' })).toBeInTheDocument();
  });

  it('shows the server message if confirming is refused, and stays on the page', async () => {
    api.get.mockResolvedValue(readyUnreviewed());
    api.update.mockRejectedValue(
      new ApiError(
        409,
        'not_ready',
        'This resume is not ready yet, so it cannot be marked as reviewed or have its text edited.',
      ),
    );
    const user = userEvent.setup();
    renderAt(`/resumes/${ID}`);
    await user.click(await screen.findByRole('button', { name: 'Confirm text is correct' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not ready yet');
    expect(screen.getByRole('heading', { name: 'Edit resume' })).toBeInTheDocument();
  });

  it.each([
    ['an upload that was already reviewed', readyUnreviewed({ reviewed: true })],
    ['a pasted resume', readyUnreviewed({ reviewed: true, source: 'paste', hasOriginal: false })],
  ])('offers no review for %s', async (_name, resume) => {
    api.get.mockResolvedValue(resume);
    renderAt(`/resumes/${ID}`);
    await screen.findByLabelText('Resume text');
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm text is correct' }),
    ).not.toBeInTheDocument();
  });

  it('offers no review while the file is still being read, and picks it up when it is ready', async () => {
    api.get.mockResolvedValueOnce(full()).mockResolvedValue(readyUnreviewed());
    renderAt(`/resumes/${ID}`);
    expect(await screen.findByText(/still being read/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm text is correct' }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Confirm text is correct' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Resume text')).toHaveValue(TEXT);
  });

  it('offers no review for a file that could not be read, and shows why', async () => {
    api.get.mockResolvedValue(
      full({
        status: 'failed',
        failureReason: { code: 'wrong_type', message: 'This file does not look like a text file.' },
      }),
    );
    renderAt(`/resumes/${ID}`);
    expect(
      await screen.findByText('This file does not look like a text file.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm text is correct' }),
    ).not.toBeInTheDocument();
  });
});

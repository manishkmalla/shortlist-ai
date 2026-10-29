// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MAX_RESUME_TEXT_CHARS, type Resume, type ResumeSummary } from '@shortlist-ai/shared';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiError } from '../../lib/api';
import { TestRouter } from '../../test/TestRouter';
import { apiKeyApi } from '../apiKey/apiKeyApi';
import { AuthProvider } from '../auth/AuthProvider';
import { authClient } from '../auth/authClient';
import { profileApi } from '../profile/profileApi';
import { formatDate } from './format';
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
vi.mock('./resumesApi', () => ({
  resumesApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    duplicate: vi.fn(),
  },
}));

const api = vi.mocked(resumesApi);

const TEXT =
  'Alex Example. Software Engineer with several years of experience building web applications.';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const summary = (n: number, over: Partial<ResumeSummary> = {}): ResumeSummary => ({
  id: id(n),
  label: `Resume ${n}`,
  notes: '',
  status: 'ready',
  source: 'paste',
  isDefault: false,
  reviewed: true,
  textLength: 600,
  wordCount: 1400,
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
  ...over,
});
const full = (n: number, over: Partial<Resume> = {}): Resume => ({
  ...summary(n),
  text: TEXT,
  ...over,
});

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

const openMenu = async (user: ReturnType<typeof userEvent.setup>, label: string) =>
  user.click(await screen.findByRole('button', { name: `Actions for ${label}` }));

describe('My Resumes list', () => {
  it('shows an empty state that leads to adding the first resume', async () => {
    renderAt('/resumes');
    expect(await screen.findByRole('heading', { name: 'No resumes yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add your first resume' })).toHaveAttribute(
      'href',
      '/resumes/new',
    );
  });

  it('lists each resume with its default badge, source, date, word count and notes', async () => {
    api.list.mockResolvedValue([
      summary(1, { label: 'AI Engineer', isDefault: true, notes: 'For ML roles' }),
      summary(2, { label: 'Full Stack', wordCount: 1 }),
    ]);
    renderAt('/resumes');
    expect(await screen.findByRole('link', { name: 'AI Engineer' })).toHaveAttribute(
      'href',
      `/resumes/${id(1)}`,
    );
    expect(screen.getAllByText('Default')).toHaveLength(1);
    expect(
      screen.getAllByText(
        new RegExp(`Pasted · Updated ${formatDate('2026-10-03T00:00:00.000Z')} · 1,400 words`),
      ),
    ).toHaveLength(1);
    expect(screen.getByText(/· 1 word$/)).toBeInTheDocument();
    expect(screen.getByText('For ML roles')).toBeInTheDocument();
    expect(screen.getByText('2 of 10 used')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add resume' })).toHaveAttribute(
      'href',
      '/resumes/new',
    );
  });

  it('disables adding and duplicating at the limit and explains why', async () => {
    api.list.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => summary(i + 1, { isDefault: i === 0 })),
    );
    const user = userEvent.setup();
    renderAt('/resumes');
    expect(
      await screen.findByText(/10 of 10 used. Delete one to add another./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add resume' })).toBeDisabled();
    await openMenu(user, 'Resume 1');
    expect(await screen.findByRole('menuitem', { name: /Duplicate/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('offers a retry when the list fails to load', async () => {
    api.list.mockRejectedValue(new Error('boom'));
    renderAt('/resumes');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your resumes.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('sets another resume as the default', async () => {
    api.list.mockResolvedValue([summary(1, { isDefault: true }), summary(2)]);
    api.update.mockResolvedValue(full(2, { isDefault: true }));
    const user = userEvent.setup();
    renderAt('/resumes');
    await openMenu(user, 'Resume 2');
    await user.click(await screen.findByRole('menuitem', { name: 'Set as default' }));
    expect(api.update).toHaveBeenCalledWith(id(2), { isDefault: true });
    expect(await screen.findByText('Default resume updated')).toBeInTheDocument();
  });

  it('does not offer "Set as default" on the default resume', async () => {
    api.list.mockResolvedValue([summary(1, { isDefault: true })]);
    const user = userEvent.setup();
    renderAt('/resumes');
    await openMenu(user, 'Resume 1');
    await screen.findByRole('menuitem', { name: 'Rename' });
    expect(screen.queryByRole('menuitem', { name: 'Set as default' })).not.toBeInTheDocument();
  });

  it('renames a resume, sending only the label', async () => {
    api.list.mockResolvedValue([summary(1, { isDefault: true })]);
    api.update.mockResolvedValue(full(1, { label: 'ML Engineer' }));
    const user = userEvent.setup();
    renderAt('/resumes');
    await openMenu(user, 'Resume 1');
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByLabelText('Label');
    expect(input).toHaveValue('Resume 1');
    await user.clear(input);
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
    await user.type(input, '  ML Engineer ');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(api.update).toHaveBeenCalledWith(id(1), { label: 'ML Engineer' });
  });

  it('duplicates a resume', async () => {
    api.list.mockResolvedValue([summary(1, { isDefault: true })]);
    api.duplicate.mockResolvedValue(full(2));
    const user = userEvent.setup();
    renderAt('/resumes');
    await openMenu(user, 'Resume 1');
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(api.duplicate).toHaveBeenCalledWith(id(1));
    expect(await screen.findByText('Resume duplicated')).toBeInTheDocument();
  });

  it('shows the server message when duplicating fails', async () => {
    api.list.mockResolvedValue([summary(1, { isDefault: true })]);
    api.duplicate.mockRejectedValue(
      new ApiError(
        409,
        'limit_reached',
        'You can keep up to 10 resumes. Delete one to add another.',
      ),
    );
    const user = userEvent.setup();
    renderAt('/resumes');
    await openMenu(user, 'Resume 1');
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));
    expect(await screen.findByText('Could not duplicate the resume')).toBeInTheDocument();
    expect(screen.getByText(/up to 10 resumes/)).toBeInTheDocument();
  });

  it('asks before deleting, and only then deletes', async () => {
    api.list.mockResolvedValue([summary(1, { isDefault: true }), summary(2)]);
    api.remove.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderAt('/resumes');
    await openMenu(user, 'Resume 2');
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Deleting cannot be undone.')).toBeInTheDocument();
    expect(api.remove).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete resume' }));
    expect(api.remove).toHaveBeenCalledWith(id(2));
  });

  it('names the resume that becomes the default when the default is deleted', async () => {
    api.list.mockResolvedValue([
      summary(1, { label: 'Newest', isDefault: true }),
      summary(2, { label: 'Older' }),
    ]);
    const user = userEvent.setup();
    renderAt('/resumes');
    await openMenu(user, 'Newest');
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText(/"Older" will become your default resume/)).toBeInTheDocument();
  });
});

describe('Add resume', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, label = 'AI Engineer') => {
    await user.type(await screen.findByLabelText('Label'), label);
    await user.click(screen.getByLabelText('Resume text'));
    await user.paste(TEXT);
  };

  it('tells the first-time user it will be their default, and shows the live character count', async () => {
    const user = userEvent.setup();
    renderAt('/resumes/new');
    expect(await screen.findByText(/This will be your default resume/)).toBeInTheDocument();
    expect(
      screen.getByText(`0 / ${MAX_RESUME_TEXT_CHARS.toLocaleString('en-US')} characters`),
    ).toBeInTheDocument();
    await fill(user);
    expect(screen.getByText(new RegExp(`^${TEXT.length} / 60,000 characters`))).toBeInTheDocument();
  });

  it('validates the label and the text before calling the API', async () => {
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await user.click(await screen.findByRole('button', { name: 'Save resume' }));
    expect(await screen.findByText('Give the resume a label')).toBeInTheDocument();
    expect(screen.getByText('The resume text is too short')).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('refuses text over the limit with a visible message and does not save', async () => {
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await user.type(await screen.findByLabelText('Label'), 'Long');
    fireEvent.change(screen.getByLabelText('Resume text'), {
      target: { value: 'x'.repeat(MAX_RESUME_TEXT_CHARS + 5) },
    });
    expect(await screen.findByText(/Too long by 5 characters/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save resume' }));
    expect(await screen.findByText(/The resume is too long/)).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('saves, confirms, and returns to the list without asking about unsaved changes', async () => {
    api.create.mockResolvedValue(full(1, { isDefault: true }));
    api.list.mockResolvedValue([summary(1, { isDefault: true })]);
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Save resume' }));
    expect(api.create).toHaveBeenCalledWith({ label: 'AI Engineer', text: TEXT, notes: undefined });
    expect(await screen.findByRole('heading', { name: 'My Resumes' })).toBeInTheDocument();
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
    expect(await screen.findByText('Resume saved')).toBeInTheDocument();
  });

  it('shows the server message when saving fails and keeps the text', async () => {
    api.create.mockRejectedValue(
      new ApiError(
        409,
        'limit_reached',
        'You can keep up to 10 resumes. Delete one to add another.',
      ),
    );
    const user = userEvent.setup();
    renderAt('/resumes/new');
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Save resume' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 10 resumes');
    expect(screen.getByLabelText('Resume text')).toHaveValue(TEXT);
  });
});

describe('Edit resume', () => {
  it('loads the resume into the form', async () => {
    api.get.mockResolvedValue(full(1, { label: 'AI Engineer', notes: 'For ML roles' }));
    renderAt(`/resumes/${id(1)}`);
    expect(await screen.findByLabelText('Label')).toHaveValue('AI Engineer');
    expect(screen.getByLabelText(/Notes/)).toHaveValue('For ML roles');
    expect(screen.getByLabelText('Resume text')).toHaveValue(TEXT);
  });

  it('sends only the label when only the label changed', async () => {
    api.get.mockResolvedValue(full(1));
    api.update.mockResolvedValue(full(1, { label: 'Renamed' }));
    api.list.mockResolvedValue([summary(1, { label: 'Renamed', isDefault: true })]);
    const user = userEvent.setup();
    renderAt(`/resumes/${id(1)}`);
    const label = await screen.findByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api.update).toHaveBeenCalledWith(id(1), { label: 'Renamed' });
    expect(await screen.findByRole('heading', { name: 'My Resumes' })).toBeInTheDocument();
  });

  it('sends the text when the text changed', async () => {
    api.get.mockResolvedValue(full(1));
    api.update.mockResolvedValue(full(1));
    api.list.mockResolvedValue([summary(1, { isDefault: true })]);
    const user = userEvent.setup();
    renderAt(`/resumes/${id(1)}`);
    await user.type(await screen.findByLabelText('Resume text'), ' Added a sentence.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(api.update).toHaveBeenCalledWith(id(1), { text: `${TEXT} Added a sentence.` });
  });

  it('says so when the resume does not exist', async () => {
    api.get.mockRejectedValue(new ApiError(404, 'not_found', 'Resume not found.'));
    renderAt(`/resumes/${id(9)}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not find that resume');
    expect(screen.getByRole('link', { name: 'Back to My Resumes' })).toBeInTheDocument();
  });
});

describe('unsaved changes', () => {
  const editAndTypeSomething = async (user: ReturnType<typeof userEvent.setup>) => {
    api.get.mockResolvedValue(full(1));
    renderAt(`/resumes/${id(1)}`);
    await user.type(await screen.findByLabelText('Resume text'), ' more');
  };

  it('asks before leaving through the sidebar, and Keep editing stays put with the text intact', async () => {
    const user = userEvent.setup();
    await editAndTypeSomething(user);
    await user.click(screen.getAllByRole('link', { name: 'Applications' })[0]!);
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Resume text')).toHaveValue(`${TEXT} more`);
    expect(screen.getByRole('heading', { name: 'Edit resume' })).toBeInTheDocument();
  });

  it('Discard changes leaves the page', async () => {
    const user = userEvent.setup();
    await editAndTypeSomething(user);
    await user.click(screen.getAllByRole('link', { name: 'Applications' })[0]!);
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument();
  });

  it('Cancel with unsaved changes asks too', async () => {
    const user = userEvent.setup();
    await editAndTypeSomething(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
  });

  it('does not ask when nothing was changed', async () => {
    api.get.mockResolvedValue(full(1));
    const user = userEvent.setup();
    renderAt(`/resumes/${id(1)}`);
    await screen.findByLabelText('Resume text');
    await user.click(screen.getAllByRole('link', { name: 'Applications' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument();
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
  });
});

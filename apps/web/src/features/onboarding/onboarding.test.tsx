// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Profile } from '@shortlist-ai/shared';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { ApiError } from '../../lib/api';
import { AuthProvider } from '../auth/AuthProvider';
import { authClient } from '../auth/authClient';
import { apiKeyApi } from '../apiKey/apiKeyApi';
import { profileApi } from '../profile/profileApi';

vi.mock('../auth/authClient', () => ({
  authClient: { currentUser: vi.fn(), logout: vi.fn(), idToken: vi.fn() },
}));
vi.mock('../apiKey/apiKeyApi', () => ({
  apiKeyApi: { status: vi.fn(), save: vi.fn(), test: vi.fn(), remove: vi.fn() },
}));
vi.mock('../profile/profileApi', () => ({
  profileApi: { get: vi.fn(), update: vi.fn(), deleteAccount: vi.fn() },
}));

const profiles = vi.mocked(profileApi);
const keys = vi.mocked(apiKeyApi);

const KEY = 'sk-ant-api03-SUPERSECRETVALUE0123456789-wxyz';
const NONE = { configured: false, lastFour: null, validatedAt: null };
const OK = { configured: true, lastFour: 'wxyz', validatedAt: '2026-01-01T00:00:00.000Z' };

const newUser: Profile = {
  name: 'Alex Example',
  email: 'alex@example.com',
  onboardingStep: 'welcome',
  onboardingCompletedAt: null,
  modelId: 'claude-sonnet-5-5',
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** A tiny stand-in for the server: applies updates the way the real service would. */
function serverState(initial: Profile) {
  let current = initial;
  profiles.get.mockImplementation(async () => current);
  profiles.update.mockImplementation(async (patch) => {
    current = {
      ...current,
      ...patch,
      onboardingCompletedAt:
        patch.onboardingStep === 'done'
          ? '2026-02-01T00:00:00.000Z'
          : current.onboardingCompletedAt,
    } as Profile;
    return current;
  });
}

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
  keys.status.mockResolvedValue(NONE);
});
afterEach(cleanup);

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('onboarding guard', () => {
  it('sends a new user from the app to the wizard', async () => {
    serverState(newUser);
    renderAt('/');
    expect(
      await screen.findByRole('heading', { name: /Welcome to Shortlist AI, Alex/ }),
    ).toBeInTheDocument();
  });

  it('keeps an unfinished user in the wizard whichever page they open', async () => {
    serverState(newUser);
    renderAt('/settings');
    expect(
      await screen.findByRole('heading', { name: /Welcome to Shortlist AI/ }),
    ).toBeInTheDocument();
  });

  it('sends a finished user away from the wizard', async () => {
    serverState({
      ...newUser,
      onboardingStep: 'done',
      onboardingCompletedAt: '2026-01-02T00:00:00.000Z',
    });
    renderAt('/onboarding');
    expect(await screen.findByRole('heading', { name: 'New Analysis' })).toBeInTheDocument();
  });

  it('lets a finished user use the app', async () => {
    serverState({
      ...newUser,
      onboardingStep: 'done',
      onboardingCompletedAt: '2026-01-02T00:00:00.000Z',
    });
    renderAt('/resumes');
    expect(await screen.findByRole('heading', { name: 'My Resumes' })).toBeInTheDocument();
  });

  it('offers a retry when the account cannot be loaded, instead of redirecting', async () => {
    profiles.get.mockRejectedValue(new Error('boom'));
    renderAt('/');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your account.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('wizard flow', () => {
  it('walks welcome, API key, resume and lands on New Analysis', async () => {
    serverState(newUser);
    keys.save.mockResolvedValue(OK);
    const user = userEvent.setup();
    renderAt('/');

    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    expect(profiles.update).toHaveBeenCalledWith({ onboardingStep: 'api-key' });

    expect(
      await screen.findByRole('heading', { name: 'Add your Anthropic API key' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('How to get your Anthropic API key').closest('details'),
    ).toHaveAttribute('open');
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();

    await user.type(screen.getByLabelText('Anthropic API key'), KEY);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('sk-ant-...wxyz');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(document.body.innerHTML).not.toContain('SUPERSECRET');

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(profiles.update).toHaveBeenCalledWith({ onboardingStep: 'resume' });

    await user.click(await screen.findByRole('button', { name: 'Finish setup' }));
    expect(profiles.update).toHaveBeenCalledWith({ onboardingStep: 'done' });
    expect(await screen.findByRole('heading', { name: 'New Analysis' })).toBeInTheDocument();
    expect(await screen.findByText("You're all set")).toBeInTheDocument();
  });

  it('cannot continue from the key step without a verified key', async () => {
    serverState({ ...newUser, onboardingStep: 'api-key' });
    renderAt('/');
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByText('Save a verified key to continue.')).toBeInTheDocument();
    expect(profiles.update).not.toHaveBeenCalled();
  });

  it('treats a key that needs attention as not verified', async () => {
    serverState({ ...newUser, onboardingStep: 'api-key' });
    keys.status.mockResolvedValue({ configured: true, lastFour: 'wxyz', validatedAt: null });
    renderAt('/');
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('shows the server message when it refuses to continue, and stays on the step', async () => {
    serverState({ ...newUser, onboardingStep: 'api-key' });
    keys.status.mockResolvedValue(OK);
    profiles.update.mockRejectedValue(
      new ApiError(409, 'api_key_required', 'Add and verify your Anthropic API key first.'),
    );
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Add and verify your Anthropic API key first.',
    );
    expect(screen.getByRole('heading', { name: 'Add your Anthropic API key' })).toBeInTheDocument();
  });

  it('resumes where the user left off', async () => {
    serverState({ ...newUser, onboardingStep: 'resume' });
    keys.status.mockResolvedValue(OK);
    renderAt('/');
    expect(
      await screen.findByRole('heading', { name: 'Add your first resume' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Resume').closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('goes back a step', async () => {
    serverState({ ...newUser, onboardingStep: 'resume' });
    keys.status.mockResolvedValue(OK);
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(profiles.update).toHaveBeenCalledWith({ onboardingStep: 'api-key' });
    expect(
      await screen.findByRole('heading', { name: 'Add your Anthropic API key' }),
    ).toBeInTheDocument();
  });

  it('lets the user sign out and come back later', async () => {
    serverState(newUser);
    vi.mocked(authClient.logout).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderAt('/');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

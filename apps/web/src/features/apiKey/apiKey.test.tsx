// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { AuthProvider } from '../auth/AuthProvider';
import { authClient } from '../auth/authClient';
import { ModelPicker } from '../profile/ModelPicker';
import { profileApi } from '../profile/profileApi';
import { apiKeyApi } from './apiKeyApi';
import { ApiKeyBanner } from './ApiKeyBanner';
import { ApiKeyForm } from './ApiKeyForm';

vi.mock('../auth/authClient', () => ({ authClient: { currentUser: vi.fn() } }));
vi.mock('./apiKeyApi', () => ({ apiKeyApi: { status: vi.fn(), save: vi.fn(), test: vi.fn(), remove: vi.fn() } }));
vi.mock('../profile/profileApi', () => ({ profileApi: { get: vi.fn(), update: vi.fn(), deleteAccount: vi.fn() } }));

const keys = vi.mocked(apiKeyApi);
const profiles = vi.mocked(profileApi);

const KEY = 'sk-ant-api03-SUPERSECRETVALUE0123456789-wxyz';
const NONE = { configured: false, lastFour: null, validatedAt: null };
const OK = { configured: true, lastFour: 'wxyz', validatedAt: '2026-01-01T00:00:00.000Z' };
const STALE = { configured: true, lastFour: 'wxyz', validatedAt: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authClient.currentUser).mockResolvedValue({ email: 'alex@example.com', name: 'Alex Example' });
});
afterEach(cleanup);

function renderAt(ui: React.ReactNode, path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <ToastProvider>{ui}</ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const typeKey = async (user: ReturnType<typeof userEvent.setup>, value = KEY) =>
  user.type(await screen.findByLabelText('Anthropic API key'), value);

describe('ApiKeyForm: no key yet', () => {
  beforeEach(() => keys.status.mockResolvedValue(NONE));

  it('uses a masked, non-autofilled input', async () => {
    renderAt(<ApiKeyForm />);
    const input = await screen.findByLabelText('Anthropic API key');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'off');
  });

  it('shows the how-to guide with all six steps and a safe Get key link', async () => {
    renderAt(<ApiKeyForm guideOpen />);
    const guide = (await screen.findByText('How to get your Anthropic API key')).closest('details')!;
    expect(within(guide).getAllByRole('listitem')).toHaveLength(6);
    const link = screen.getByRole('link', { name: /Get key/ });
    expect(link).toHaveAttribute('href', 'https://console.anthropic.com/settings/keys');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the privacy note', async () => {
    renderAt(<ApiKeyForm />);
    expect(await screen.findByText(/encrypted at rest/)).toBeInTheDocument();
  });

  it('rejects a malformed key without calling the API', async () => {
    const user = userEvent.setup();
    renderAt(<ApiKeyForm />);
    await typeKey(user, 'not-a-real-key-at-all-1234567');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Anthropic API keys start with sk-ant-')).toBeInTheDocument();
    expect(keys.save).not.toHaveBeenCalled();
  });

  it('saves, then shows only the masked key and never the full value', async () => {
    keys.save.mockResolvedValue(OK);
    const user = userEvent.setup();
    renderAt(<ApiKeyForm />);
    await typeKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('sk-ant-...wxyz')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(keys.save).toHaveBeenCalledWith(KEY);
    expect(screen.queryByLabelText('Anthropic API key')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('SUPERSECRET');
    expect(document.body.innerHTML).not.toContain('SUPERSECRET');
  });

  it('shows the friendly server message when Anthropic rejects the key', async () => {
    keys.save.mockRejectedValue(new ApiError(400, 'invalid_api_key', 'Your API key is invalid or revoked. Check it in Settings.'));
    const user = userEvent.setup();
    renderAt(<ApiKeyForm />);
    await typeKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or revoked');
    expect(screen.getByLabelText('Anthropic API key')).toBeInTheDocument();
  });

  it('points to the Anthropic console when there is no credit', async () => {
    keys.save.mockRejectedValue(new ApiError(402, 'no_credit', 'Your Anthropic account has no credit. Add credit in the Anthropic console.'));
    const user = userEvent.setup();
    renderAt(<ApiKeyForm />);
    await typeKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Add credit in the Anthropic console');
  });

  it('calls onSaved after a successful save', async () => {
    keys.save.mockResolvedValue(OK);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderAt(<ApiKeyForm onSaved={onSaved} />);
    await typeKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('sk-ant-...wxyz');
    expect(onSaved).toHaveBeenCalled();
  });
});

describe('ApiKeyForm: key saved', () => {
  it('tests the connection', async () => {
    keys.status.mockResolvedValue(OK);
    keys.test.mockResolvedValue(OK);
    const user = userEvent.setup();
    renderAt(<ApiKeyForm />);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(keys.test).toHaveBeenCalled();
    expect(await screen.findByText('Connection works')).toBeInTheDocument();
  });

  it('flags a key that Anthropic rejects on test and refreshes its state', async () => {
    keys.status.mockResolvedValueOnce(OK).mockResolvedValue(STALE);
    keys.test.mockRejectedValue(new ApiError(400, 'invalid_api_key', 'Your API key is invalid or revoked. Check it in Settings.'));
    const user = userEvent.setup();
    renderAt(<ApiKeyForm />);
    await user.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or revoked');
    expect(await screen.findByText(/Key needs attention/)).toBeInTheDocument();
  });

  it('shows the needs-attention state for an unverified key', async () => {
    keys.status.mockResolvedValue(STALE);
    renderAt(<ApiKeyForm />);
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('sk-ant-...wxyz')).toBeInTheDocument();
  });

  it('replaces a key and can cancel', async () => {
    keys.status.mockResolvedValue(OK);
    const user = userEvent.setup();
    renderAt(<ApiKeyForm />);
    await user.click(await screen.findByRole('button', { name: 'Replace' }));
    expect(screen.getByLabelText('Anthropic API key')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('sk-ant-...wxyz')).toBeInTheDocument();
  });

  it('removes the key only after confirming', async () => {
    keys.status.mockResolvedValue(OK);
    keys.remove.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderAt(<ApiKeyForm />);
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(keys.remove).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Remove key' }));
    expect(keys.remove).toHaveBeenCalled();
    expect(await screen.findByLabelText('Anthropic API key')).toBeInTheDocument();
  });
});

describe('ApiKeyBanner', () => {
  it('asks for a key when none is saved', async () => {
    keys.status.mockResolvedValue(NONE);
    renderAt(<ApiKeyBanner />);
    expect(await screen.findByRole('region', { name: 'API key notice' })).toHaveTextContent('Add your Anthropic API key');
    expect(screen.getByRole('link', { name: 'Go to Settings' })).toHaveAttribute('href', '/settings');
  });

  it('warns when the key needs attention', async () => {
    keys.status.mockResolvedValue(STALE);
    renderAt(<ApiKeyBanner />);
    expect(await screen.findByRole('region', { name: 'API key notice' })).toHaveTextContent('needs attention');
  });

  it('stays hidden when the key is verified', async () => {
    keys.status.mockResolvedValue(OK);
    renderAt(<ApiKeyBanner />);
    await vi.waitFor(() => expect(keys.status).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'API key notice' })).not.toBeInTheDocument();
  });

  it('stays hidden on the Settings page', async () => {
    keys.status.mockResolvedValue(NONE);
    renderAt(<ApiKeyBanner />, '/settings');
    await vi.waitFor(() => expect(keys.status).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'API key notice' })).not.toBeInTheDocument();
  });
});

describe('ModelPicker', () => {
  const profile = {
    name: 'Alex Example',
    email: 'alex@example.com',
    onboardingStep: 'welcome' as const,
    onboardingCompletedAt: null,
    modelId: 'claude-sonnet-5-5' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('lists the three models with the current one selected', async () => {
    profiles.get.mockResolvedValue(profile);
    renderAt(<ModelPicker />);
    expect(await screen.findAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /Claude Sonnet 5.5/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Claude Opus 5.5/ })).not.toBeChecked();
  });

  it('saves a new choice', async () => {
    profiles.get.mockResolvedValue(profile);
    profiles.update.mockResolvedValue({ ...profile, modelId: 'claude-haiku-5-5' });
    const user = userEvent.setup();
    renderAt(<ModelPicker />);
    await user.click(await screen.findByRole('radio', { name: /Claude Haiku 5.5/ }));
    expect(profiles.update).toHaveBeenCalledWith({ modelId: 'claude-haiku-5-5' });
    expect(await screen.findByText('Model updated')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Claude Haiku 5.5/ })).toBeChecked();
  });
});

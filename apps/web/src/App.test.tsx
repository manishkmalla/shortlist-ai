// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { AuthProvider } from './features/auth/AuthProvider';
import { authClient } from './features/auth/authClient';

vi.mock('./features/auth/authClient', () => ({
  authClient: {
    register: vi.fn(),
    confirmRegistration: vi.fn(),
    resendCode: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    requestPasswordReset: vi.fn(),
    completePasswordReset: vi.fn(),
    currentUser: vi.fn(),
  },
}));

const client = vi.mocked(authClient);

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
  client.currentUser.mockResolvedValue(null);
});

afterEach(cleanup);

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const named = (name: string) => Object.assign(new Error(name), { name });

describe('route guards', () => {
  it('sends signed-out visitors to the login page', async () => {
    renderApp('/resumes');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the app shell and page when signed in', async () => {
    client.currentUser.mockResolvedValue({ email: 'alex@example.com', name: 'Alex Example' });
    renderApp('/resumes');
    expect(await screen.findByRole('heading', { name: 'My Resumes' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'My Resumes' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps signed-in users away from the login page', async () => {
    client.currentUser.mockResolvedValue({ email: 'alex@example.com', name: 'Alex Example' });
    renderApp('/login');
    expect(await screen.findByRole('heading', { name: 'New Analysis' })).toBeInTheDocument();
  });
});

describe('login', () => {
  it('validates input before calling Cognito', async () => {
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email')).toBeInTheDocument();
    expect(client.login).not.toHaveBeenCalled();
  });

  it('shows a friendly message for wrong credentials', async () => {
    client.login.mockRejectedValue(named('NotAuthorizedException'));
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('signs in and lands in the app', async () => {
    client.login.mockResolvedValue('signed-in');
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    client.currentUser.mockResolvedValue({ email: 'alex@example.com', name: 'Alex Example' });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'New Analysis' })).toBeInTheDocument();
  });

  it('sends unconfirmed users to email verification', async () => {
    client.login.mockResolvedValue('needs-confirmation');
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    expect(client.resendCode).toHaveBeenCalledWith('alex@example.com');
  });
});

describe('sign up', () => {
  it('rejects a weak password client-side', async () => {
    const user = userEvent.setup();
    renderApp('/signup');
    await user.type(await screen.findByLabelText('Full name'), 'Alex Example');
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 12 characters')).toBeInTheDocument();
    expect(client.register).not.toHaveBeenCalled();
  });

  it('registers and moves to the verification step with the email prefilled', async () => {
    client.register.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderApp('/signup');
    await user.type(await screen.findByLabelText('Full name'), 'Alex Example');
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('alex@example.com');
    expect(client.register).toHaveBeenCalledWith({
      name: 'Alex Example',
      email: 'alex@example.com',
      password: 'Correct-horse-1',
    });
  });

  it('explains when the email is already registered', async () => {
    client.register.mockRejectedValue(named('UsernameExistsException'));
    const user = userEvent.setup();
    renderApp('/signup');
    await user.type(await screen.findByLabelText('Full name'), 'Alex Example');
    await user.type(screen.getByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists');
  });
});

describe('verification and reset', () => {
  it('requires a 6-digit code', async () => {
    const user = userEvent.setup();
    renderApp('/verify');
    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Verification code'), '12ab');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Enter the 6-digit code')).toBeInTheDocument();
    expect(client.confirmRegistration).not.toHaveBeenCalled();
  });

  it('completes a password reset', async () => {
    client.completePasswordReset.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderApp('/reset-password');
    await user.type(await screen.findByLabelText('Email'), 'alex@example.com');
    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'Correct-horse-2');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(client.completePasswordReset).toHaveBeenCalledWith('alex@example.com', '123456', 'Correct-horse-2');
  });
});

describe('sign out', () => {
  it('signs out from the account menu', async () => {
    client.currentUser.mockResolvedValue({ email: 'alex@example.com', name: 'Alex Example' });
    client.logout.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderApp('/');
    const triggers = await screen.findAllByRole('button', { name: 'Account' });
    await user.click(triggers[0]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(client.logout).toHaveBeenCalled();
  });
});

import { Amplify } from 'aws-amplify';
import {
  confirmResetPassword,
  confirmSignUp,
  fetchUserAttributes,
  getCurrentUser,
  resendSignUpCode,
  resetPassword,
  signIn,
  signOut,
  signUp,
} from 'aws-amplify/auth';

export type SignInResult = 'signed-in' | 'needs-confirmation';

export interface SessionUser {
  email: string;
  name: string;
}

/** Call once at startup. Throws if the Cognito env vars are missing. */
export function configureAuth() {
  const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
  if (!userPoolId || !userPoolClientId) {
    throw new Error('Missing VITE_COGNITO_USER_POOL_ID or VITE_COGNITO_CLIENT_ID. See apps/web/.env.example.');
  }
  Amplify.configure({ Auth: { Cognito: { userPoolId, userPoolClientId } } });
}

/** Thin wrapper over Amplify so the rest of the app (and tests) never import it directly. */
export const authClient = {
  async register(input: { name: string; email: string; password: string }) {
    await signUp({
      username: input.email,
      password: input.password,
      options: { userAttributes: { email: input.email, name: input.name } },
    });
  },
  async confirmRegistration(email: string, code: string) {
    await confirmSignUp({ username: email, confirmationCode: code });
  },
  async resendCode(email: string) {
    await resendSignUpCode({ username: email });
  },
  async login(email: string, password: string): Promise<SignInResult> {
    const { isSignedIn, nextStep } = await signIn({ username: email, password });
    if (isSignedIn) return 'signed-in';
    if (nextStep.signInStep === 'CONFIRM_SIGN_UP') return 'needs-confirmation';
    throw new Error(`Unsupported sign-in step: ${nextStep.signInStep}`);
  },
  async logout() {
    await signOut();
  },
  async requestPasswordReset(email: string) {
    await resetPassword({ username: email });
  },
  async completePasswordReset(email: string, code: string, newPassword: string) {
    await confirmResetPassword({ username: email, confirmationCode: code, newPassword });
  },
  /** Returns null when nobody is signed in. */
  async currentUser(): Promise<SessionUser | null> {
    try {
      await getCurrentUser();
    } catch {
      return null;
    }
    const attrs = await fetchUserAttributes();
    return { email: attrs.email ?? '', name: attrs.name ?? '' };
  },
};

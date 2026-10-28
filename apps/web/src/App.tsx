import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ToastProvider } from './components/ui';
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage';
import { LoginPage } from './features/auth/LoginPage';
import { PublicOnly, RequireAuth } from './features/auth/RouteGuards';
import { ResetPasswordPage } from './features/auth/ResetPasswordPage';
import { SignUpPage } from './features/auth/SignUpPage';
import { useAuth } from './features/auth/AuthProvider';
import { VerifyEmailPage } from './features/auth/VerifyEmailPage';
import { OnboardingPage } from './features/onboarding/OnboardingPage';
import { RequireOnboarded } from './features/onboarding/OnboardingGuard';
import { useProfile } from './features/profile/hooks';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { SettingsPage } from './pages/SettingsPage';

function ShellRoute() {
  const { signOut } = useAuth();
  const { data: profile } = useProfile();
  const qc = useQueryClient();
  const handleSignOut = async () => {
    await signOut();
    qc.clear();
  };
  return <AppShell userName={profile?.name} onSignOut={() => void handleSignOut()} />;
}

export function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<PublicOnly />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignUpPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
        </Route>
        {/* Verify and reset are reachable while signed out, and harmless when signed in. */}
        <Route path="verify" element={<VerifyEmailPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />

        <Route element={<RequireAuth />}>
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route element={<RequireOnboarded />}>
            <Route element={<ShellRoute />}>
              <Route
                index
                element={
                  <PlaceholderPage
                    title="New Analysis"
                    description="Paste a job description to get started. Coming in Phase 3."
                  />
                }
              />
              <Route
                path="applications"
                element={
                  <PlaceholderPage
                    title="Applications"
                    description="Your analyses will appear here."
                  />
                }
              />
              <Route
                path="resumes"
                element={
                  <PlaceholderPage
                    title="My Resumes"
                    description="Upload and manage your resumes. Coming in Phase 2."
                  />
                }
              />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </ToastProvider>
  );
}

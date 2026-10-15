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
import { PlaceholderPage } from './pages/PlaceholderPage';

function ShellRoute() {
  const { signOut } = useAuth();
  return <AppShell onSignOut={() => void signOut()} />;
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
          <Route element={<ShellRoute />}>
            <Route index element={<PlaceholderPage title="New Analysis" description="Paste a job description to get started. Coming in Phase 3." />} />
            <Route path="applications" element={<PlaceholderPage title="Applications" description="Your analyses will appear here." />} />
            <Route path="resumes" element={<PlaceholderPage title="My Resumes" description="Upload and manage your resumes. Coming in Phase 2." />} />
            <Route path="settings" element={<PlaceholderPage title="Settings" description="Anthropic API key and model settings. Coming in Phase 1b." />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </ToastProvider>
  );
}

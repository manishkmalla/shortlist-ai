import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ToastProvider } from './components/ui';
import { PlaceholderPage } from './pages/PlaceholderPage';

export function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<PlaceholderPage title="New Analysis" description="Paste a job description to get started. Coming in Phase 3." />} />
          <Route path="applications" element={<PlaceholderPage title="Applications" description="Your analyses will appear here." />} />
          <Route path="resumes" element={<PlaceholderPage title="My Resumes" description="Upload and manage your resumes. Coming in Phase 2." />} />
          <Route path="settings" element={<PlaceholderPage title="Settings" description="Anthropic API key and model settings. Coming in Phase 1b." />} />
          <Route path="*" element={<PlaceholderPage title="Not found" description="That page does not exist." />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

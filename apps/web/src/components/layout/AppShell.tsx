import { NavLink, Outlet } from 'react-router-dom';
import { ApiKeyBanner } from '../../features/apiKey/ApiKeyBanner';
import { cn } from '../../lib/cn';
import { UserMenu } from './UserMenu';

const nav = [
  { to: '/', label: 'New Analysis', end: true },
  { to: '/applications', label: 'Applications' },
  { to: '/resumes', label: 'My Resumes' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell({ userName, onSignOut }: { userName?: string; onSignOut?: () => void }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[14rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-control focus:bg-white focus:px-3 focus:py-2 dark:focus:bg-slate-900"
      >
        Skip to content
      </a>
      <aside className="border-b border-slate-200 bg-white md:border-b-0 md:border-r dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:px-5 md:py-5">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden className="inline-block size-5 rounded-md bg-accent dark:bg-accent-dark" />
            Shortlist AI
          </div>
          <div className="md:hidden">
            <UserMenu userName={userName} onSignOut={onSignOut} />
          </div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-control px-3 py-2 text-sm font-medium',
                  isActive
                    ? 'bg-accent-soft text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <ApiKeyBanner />
        <header className="hidden justify-end px-8 py-4 md:flex">
          <UserMenu userName={userName} onSignOut={onSignOut} />
        </header>
        <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

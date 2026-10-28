import { Navigate, Outlet } from 'react-router-dom';
import { Button } from '../../components/ui';
import { Loading } from '../auth/RouteGuards';
import { useProfile } from '../profile/hooks';

/** App routes are only for users who finished onboarding; everyone else goes to the wizard. */
export function RequireOnboarded() {
  const profile = useProfile();
  if (profile.isPending) return <Loading />;
  if (profile.isError) {
    return (
      <div role="alert" className="grid min-h-screen place-items-center px-4 text-center">
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">Could not load your account.</p>
          <Button variant="secondary" onClick={() => void profile.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!profile.data.onboardingCompletedAt) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

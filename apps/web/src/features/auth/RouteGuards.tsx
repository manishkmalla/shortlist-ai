import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

function Loading() {
  return (
    <div role="status" className="grid min-h-screen place-items-center text-sm text-slate-500">
      Loading...
    </div>
  );
}

/** Wraps app routes: signed-out visitors are sent to /login and returned afterwards. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading />;
  if (status === 'signed-out') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Wraps login/sign-up routes: signed-in users go straight to the app. */
export function PublicOnly() {
  const { status } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status === 'signed-in') return <Navigate to="/" replace />;
  return <Outlet />;
}

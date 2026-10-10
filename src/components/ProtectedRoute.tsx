import { Navigate, useLocation } from 'react-router-dom';
import '@/styles/platform.css';
import { safeReturnTo, useSession } from '@/stores/session';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Gate for every signed-in screen. The session store is the single source of
 * truth: no session, no screen. The owner app has its own login page, so its
 * paths return there; everything else goes to /login.
 */
const ProtectedRoute = ({ children }: ProtectedRouteProps) => {
  const connected = useSession((s) => s.connected);
  const location = useLocation();

  if (!connected) {
    const login = location.pathname.startsWith('/telephony') ? '/telephony/login' : '/login';
    const here = safeReturnTo(location.pathname + location.search);
    return <Navigate to={here ? `${login}?returnTo=${encodeURIComponent(here)}` : login} replace />;
  }

  return <div className="platform min-h-screen">{children}</div>;
};

export default ProtectedRoute;

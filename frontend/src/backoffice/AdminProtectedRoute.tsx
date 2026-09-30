import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from './useAdminAuth';

export function AdminProtectedRoute() {
  const { isAuthenticated } = useAdminAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/backoffice/login"
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  return <Outlet />;
}

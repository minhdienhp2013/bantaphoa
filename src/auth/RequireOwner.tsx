import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function RequireOwner() {
  const { appUser } = useAuth();

  if (!appUser) return null;
  if (appUser.role !== 'owner') return <Navigate to="/" replace />;

  return <Outlet />;
}

import { Navigate, Outlet } from 'react-router-dom';
import type { AppModulePermission } from '../types/models';
import { useAuth } from './AuthContext';
import { hasModulePermission } from './permissions';

export function RequirePermission({ permission }: { permission: AppModulePermission }) {
  const { appUser } = useAuth();

  if (!appUser) return null;
  if (!hasModulePermission(appUser, permission)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

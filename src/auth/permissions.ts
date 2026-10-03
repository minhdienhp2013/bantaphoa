import type { AppModulePermission, AppModulePermissions, AppUser } from '../types/models';

export const APP_MODULES: ReadonlyArray<{
  key: AppModulePermission;
  label: string;
  path: string;
}> = [
  { key: 'dashboard', label: 'Tổng quan', path: '/dashboard' },
  { key: 'products', label: 'Hàng hóa', path: '/products' },
  { key: 'customers', label: 'Khách hàng', path: '/customers' },
  { key: 'suppliers', label: 'Nhà cung cấp', path: '/suppliers' },
  { key: 'sales', label: 'Bán hàng', path: '/sales' },
  { key: 'purchases', label: 'Nhập hàng', path: '/purchases' },
  { key: 'debts', label: 'Công nợ', path: '/debts' },
  { key: 'inventory', label: 'Kho', path: '/inventory' },
  { key: 'stockouts', label: 'Xuất kho', path: '/stockouts' },
  { key: 'stocktakes', label: 'Kiểm kê', path: '/stocktakes' },
  { key: 'expenses', label: 'Chi phí', path: '/expenses' },
  { key: 'qrPrinting', label: 'QR & In tem', path: '/qr-printing' },
  { key: 'reports', label: 'Báo cáo & Backup', path: '/reports' },
];

export function hasModulePermission(user: AppUser, permission: AppModulePermission) {
  return user.role === 'owner' || user.permissions?.[permission] === true;
}

export function firstPermittedPath(user: AppUser) {
  if (user.role === 'owner') return '/';
  return APP_MODULES.find((item) => hasModulePermission(user, item.key))?.path ?? null;
}

export function normalizeModulePermissions(value: unknown): AppModulePermissions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    APP_MODULES
      .filter((item) => source[item.key] === true)
      .map((item) => [item.key, true]),
  ) as AppModulePermissions;
}

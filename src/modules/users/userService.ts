import { deleteApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut,
} from 'firebase/auth';
import {
  onValue,
  push,
  ref,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { firebaseApp, db } from '../../firebase/client';
import { invalidateReferenceCache } from '../../shared/data/referenceDataCache';
import { normalizeModulePermissions } from '../../auth/permissions';
import type { AppModulePermissions, AppUser, AuditLog } from '../../types/models';

export interface CreateStaffAccountInput {
  displayName: string;
  email: string;
  password: string;
  permissions: AppModulePermissions;
}

export interface UpdateStaffAccountInput {
  displayName: string;
  active: boolean;
  permissions: AppModulePermissions;
}

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function normalizeName(value: string) {
  const name = value.trim();
  if (name.length < 2) throw new Error('Tên nhân viên phải có ít nhất 2 ký tự.');
  if (name.length > 80) throw new Error('Tên nhân viên tối đa 80 ký tự.');
  return name;
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!email || !email.includes('@')) throw new Error('Email không hợp lệ.');
  return email;
}

function normalizePassword(value: string) {
  if (value.length < 6) throw new Error('Mật khẩu ban đầu phải có ít nhất 6 ký tự.');
  if (value.length > 128) throw new Error('Mật khẩu ban đầu quá dài.');
  return value;
}

function hasPermissions(permissions: AppModulePermissions) {
  return Object.keys(permissions).length > 0;
}

function makeAudit(actorUid: string, action: string, entityId: string, summary: string): AuditLog {
  const auditId = push(ref(requireDatabase(), 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký kiểm toán.');
  return {
    id: auditId,
    actorUid,
    action,
    entityType: 'user',
    entityId,
    summary,
    createdAt: Date.now(),
  };
}

export function subscribeUsers(
  onData: (users: AppUser[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'users'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, AppUser> | null;
      const users = raw
        ? Object.entries(raw)
            .map(([uid, user]) => ({
              ...user,
              uid,
              permissions: user.role === 'staff'
                ? normalizeModulePermissions(user.permissions)
                : undefined,
            }))
            .sort((a, b) => {
              if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
              return a.displayName.localeCompare(b.displayName, 'vi');
            })
        : [];
      onData(users);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải danh sách người dùng.')),
  );
}

export async function createStaffAccount(
  input: CreateStaffAccountInput,
  actorUid: string,
): Promise<AppUser> {
  if (!actorUid) throw new Error('Phiên Chủ cửa hàng không hợp lệ.');

  const displayName = normalizeName(input.displayName);
  const email = normalizeEmail(input.email);
  const password = normalizePassword(input.password);
  const permissions = normalizeModulePermissions(input.permissions);
  const secondaryApp = initializeApp(
    firebaseApp.options,
    `staff-create-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const secondaryAuth = getAuth(secondaryApp);
  let createdUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user'] | null = null;

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    createdUser = credential.user;
    const now = Date.now();
    const profile: AppUser = {
      uid: createdUser.uid,
      displayName,
      email,
      role: 'staff',
      active: true,
      ...(hasPermissions(permissions) ? { permissions } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const audit = makeAudit(actorUid, 'USER_CREATED', profile.uid, `Tạo nhân viên ${displayName}`);

    await update(ref(requireDatabase()), {
      [`users/${profile.uid}`]: profile,
      [`auditLogs/${audit.id}`]: audit,
    });
    invalidateReferenceCache('users');

    return { ...profile, permissions };
  } catch (error) {
    if (createdUser) {
      await deleteUser(createdUser).catch(() => undefined);
    }
    throw error;
  } finally {
    await signOut(secondaryAuth).catch(() => undefined);
    await deleteApp(secondaryApp).catch(() => undefined);
  }
}

export async function updateStaffAccount(
  uid: string,
  input: UpdateStaffAccountInput,
  actorUid: string,
) {
  if (!actorUid) throw new Error('Phiên Chủ cửa hàng không hợp lệ.');
  if (!uid) throw new Error('Thiếu UID nhân viên.');

  const displayName = normalizeName(input.displayName);
  const permissions = normalizeModulePermissions(input.permissions);
  const updatedAt = Date.now();
  const audit = makeAudit(
    actorUid,
    input.active ? 'USER_UPDATED' : 'USER_DISABLED',
    uid,
    input.active ? `Cập nhật nhân viên ${displayName}` : `Ngừng tài khoản ${displayName}`,
  );

  await update(ref(requireDatabase()), {
    [`users/${uid}/displayName`]: displayName,
    [`users/${uid}/active`]: input.active,
    [`users/${uid}/permissions`]: hasPermissions(permissions) ? permissions : null,
    [`users/${uid}/updatedAt`]: updatedAt,
    [`auditLogs/${audit.id}`]: audit,
  });
  invalidateReferenceCache('users');
}

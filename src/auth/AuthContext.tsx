import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { get, onValue, ref, set } from 'firebase/database';
import { auth, db } from '../firebase/client';
import { clearReferenceCache } from '../shared/data/referenceDataCache';
import { isOwnerUid } from '../config/security';
import type { AppUser } from '../types/models';
import { normalizeModulePermissions } from './permissions';

interface AuthContextValue {
  firebaseUser: User | null;
  appUser: AppUser | null;
  loading: boolean;
  accessError: string | null;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function isValidProfile(value: unknown): value is AppUser {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<AppUser>;
  return (
    typeof candidate.uid === 'string' &&
    typeof candidate.displayName === 'string' &&
    (candidate.role === 'owner' || candidate.role === 'staff') &&
    typeof candidate.active === 'boolean' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number' &&
    (candidate.permissions === undefined || (
      typeof candidate.permissions === 'object' &&
      candidate.permissions !== null &&
      !Array.isArray(candidate.permissions)
    ))
  );
}

function normalizeProfile(profile: AppUser): AppUser {
  if (profile.role === 'owner') return { ...profile, permissions: undefined };
  return { ...profile, permissions: normalizeModulePermissions(profile.permissions) };
}

async function loadOrBootstrapProfile(user: User): Promise<AppUser> {
  if (!db) {
    throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  }

  const userRef = ref(db, `users/${user.uid}`);
  const snapshot = await get(userRef);

  if (snapshot.exists()) {
    const profile = snapshot.val() as unknown;
    if (!isValidProfile(profile) || profile.uid !== user.uid) {
      throw new Error('Hồ sơ người dùng trong cơ sở dữ liệu không hợp lệ.');
    }
    return normalizeProfile(profile);
  }

  if (!isOwnerUid(user.uid)) {
    throw new Error('Tài khoản chưa được Chủ cửa hàng cấp quyền sử dụng hệ thống.');
  }

  const now = Date.now();
  const ownerProfile: AppUser = {
    uid: user.uid,
    displayName: user.displayName?.trim() || 'Chủ cửa hàng',
    role: 'owner',
    active: true,
    createdAt: now,
    updatedAt: now,
    ...(user.email ? { email: user.email } : {}),
  };

  await set(userRef, ownerProfile);
  return ownerProfile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeProfile: (() => void) | null = null;

    function applyProfile(profile: AppUser) {
      if (cancelled) return;
      if (!profile.active) {
        setAppUser(null);
        setAccessError('Tài khoản này đã bị khóa.');
        setLoading(false);
        return;
      }

      setAppUser(normalizeProfile(profile));
      setAccessError(null);
      setLoading(false);
    }

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      // Reference caches are session-scoped. Clearing on every auth transition
      // prevents an owner-only users snapshot from surviving into another login.
      clearReferenceCache();
      unsubscribeProfile?.();
      unsubscribeProfile = null;

      if (cancelled) return;
      setFirebaseUser(user);
      setAppUser(null);
      setAccessError(null);
      setLoading(true);

      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const profile = await loadOrBootstrapProfile(user);
        if (cancelled) return;
        applyProfile(profile);

        if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
        const profileRef = ref(db, `users/${user.uid}`);
        unsubscribeProfile = onValue(
          profileRef,
          (snapshot) => {
            if (cancelled) return;
            if (!snapshot.exists()) {
              setAppUser(null);
              setAccessError('Hồ sơ người dùng không còn tồn tại.');
              setLoading(false);
              return;
            }

            const nextProfile = snapshot.val() as unknown;
            if (!isValidProfile(nextProfile) || nextProfile.uid !== user.uid) {
              setAppUser(null);
              setAccessError('Hồ sơ người dùng trong cơ sở dữ liệu không hợp lệ.');
              setLoading(false);
              return;
            }
            applyProfile(nextProfile);
          },
          (error) => {
            if (cancelled) return;
            setAppUser(null);
            setAccessError(error instanceof Error ? error.message : 'Không thể cập nhật quyền người dùng.');
            setLoading(false);
          },
        );
      } catch (error) {
        if (cancelled) return;
        setAccessError(error instanceof Error ? error.message : 'Không thể tải quyền người dùng.');
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      firebaseUser,
      appUser,
      loading,
      accessError,
      logout: () => signOut(auth),
    }),
    [firebaseUser, appUser, loading, accessError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth phải được dùng bên trong AuthProvider.');
  }
  return context;
}

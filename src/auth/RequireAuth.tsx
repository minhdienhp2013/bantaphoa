import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import AuthLoadingScreen from './AuthLoadingScreen';

export function RequireAuth() {
  const { firebaseUser, appUser, loading, accessError, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AuthLoadingScreen displayName={appUser?.displayName ?? firebaseUser?.displayName} />;
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!appUser || accessError) {
    return (
      <main className="center-screen">
        <section className="auth-card">
          <p className="eyebrow">Không thể truy cập</p>
          <h1>Tài khoản chưa có quyền</h1>
          <p className="form-error">{accessError ?? 'Không tìm thấy hồ sơ người dùng hợp lệ.'}</p>
          <button className="button button--primary" type="button" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </section>
      </main>
    );
  }

  return <Outlet />;
}

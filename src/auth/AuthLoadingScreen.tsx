import './authLoadingScreen.css';

type AuthLoadingScreenProps = {
  displayName?: string | null;
};

export default function AuthLoadingScreen({ displayName }: AuthLoadingScreenProps) {
  const greetingName = displayName?.trim();

  return (
    <main className="auth-loading-screen" role="status" aria-live="polite" aria-busy="true">
      <section className="auth-loading-screen__content">
        <div className="auth-loading-screen__artwork" aria-hidden="true">
          <span aria-hidden="true">🛒</span>
        </div>

        <div className="auth-loading-screen__copy">
          <strong>{greetingName ? `Chào ${greetingName}` : 'Đang đăng nhập'}</strong>
          <span className="auth-loading-screen__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>

        <small className="auth-loading-screen__powered">Bán Tạp Hóa</small>
      </section>
    </main>
  );
}

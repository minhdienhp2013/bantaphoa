import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
const App = lazy(() => import('./App'));
const firebaseConfigured = [
  import.meta.env.VITE_FIREBASE_API_KEY,
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  import.meta.env.VITE_FIREBASE_DATABASE_URL,
  import.meta.env.VITE_FIREBASE_PROJECT_ID,
  import.meta.env.VITE_FIREBASE_APP_ID,
].every((value) => typeof value === 'string' && value.trim().length > 0);
import { installCapacitorRuntimeShell } from './platform/runtime';
import { installSalesMobileTopbarShortcuts } from './modules/sales/salesMobileTopbarShortcuts';
import { installSalesQuickCheckoutScrollSpeed } from './modules/sales/salesQuickCheckoutScrollSpeed';
import { installSalesSearchDismiss } from './modules/sales/salesSearchDismiss';
import './shared/ui/ui.css';
import './styles.css';
import './shared/ui/brand-theme.css';
import './modules/settings/settingsBrand.css';
import './modules/users/usersBrand.css';
import './shared/ui/final-mobile-polish.css';
import './modules/sales/salesSearchMotion.css';
import './modules/sales/salesUnifiedResultPanel.css';
import './modules/sales/salesMobileTopbarShortcuts.css';
import './modules/sales/salesSearchThumbnailMobile.css';
import './shared/ui/tabletOnly.css';
import './shared/ui/capacitorNative.css';

function installMobileZoomGuard() {
  const isTouchDevice = navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
  if (!isTouchDevice) return;

  const preventGestureZoom = (event: Event) => event.preventDefault();
  const preventMultiTouchZoom = (event: TouchEvent) => {
    if (event.touches.length > 1) event.preventDefault();
  };

  let lastTouchEnd = 0;
  const preventDoubleTapZoom = (event: TouchEvent) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  };

  document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
  document.addEventListener('gesturechange', preventGestureZoom, { passive: false });
  document.addEventListener('gestureend', preventGestureZoom, { passive: false });
  document.addEventListener('touchstart', preventMultiTouchZoom, { passive: false });
  document.addEventListener('touchmove', preventMultiTouchZoom, { passive: false });
  document.addEventListener('touchend', preventDoubleTapZoom, { passive: false });
}

installCapacitorRuntimeShell();
installMobileZoomGuard();
installSalesSearchDismiss();
installSalesQuickCheckoutScrollSpeed();
installSalesMobileTopbarShortcuts();

const root = document.getElementById('root');

if (!root) {
  throw new Error('Không tìm thấy phần tử #root để khởi tạo ứng dụng.');
}

createRoot(root).render(
  <StrictMode>
    {firebaseConfigured ? (
      <Suspense fallback={<p role="status">Đang tải Bán Tạp Hóa…</p>}><App /></Suspense>
    ) : (
      <main style={{ maxWidth: 640, margin: '64px auto', padding: 24 }}>
        <h1>Bán Tạp Hóa</h1>
        <h2>Chưa cấu hình Firebase riêng</h2>
        <p>Tạo Firebase Project dành cho cửa hàng tạp hóa, bật Authentication và Realtime Database, rồi điền cấu hình vào .env.local theo .env.example.</p>
        <p>Khi chạy trên Cloudflare Pages, điền các biến môi trường tương ứng và build lại ứng dụng.</p>
      </main>
    )}
  </StrictMode>,
);

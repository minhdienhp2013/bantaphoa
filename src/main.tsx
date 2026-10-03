import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
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
import './modules/sales/salesAiInlineMobile.css';
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
    <App />
  </StrictMode>,
);

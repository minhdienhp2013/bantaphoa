import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasModulePermission } from '../auth/permissions';
import brandLogo from '../assets/minh-dien-logo.jpg';
import NavigationIcon, { type NavigationIconName } from './NavigationIcon';
import type { AppModulePermission } from '../types/models';

type NavigationItem = {
  to: string;
  label: string;
  icon: NavigationIconName;
  permission?: AppModulePermission;
  ownerOnly?: boolean;
};

const navigation: NavigationItem[] = [
  { to: '/dashboard', label: 'Tổng quan', icon: 'dashboard', permission: 'dashboard' },
  { to: '/sales', label: 'Bán hàng', icon: 'sales', permission: 'sales' },
  { to: '/products', label: 'Hàng hóa', icon: 'products', permission: 'products' },
  { to: '/reports', label: 'Đơn hàng và báo cáo', icon: 'reports', permission: 'reports' },
  { to: '/customers', label: 'Khách hàng', icon: 'customers', permission: 'customers' },
  { to: '/suppliers', label: 'Nhà cung cấp', icon: 'suppliers', permission: 'suppliers' },
  { to: '/purchases', label: 'Nhập hàng', icon: 'purchases', permission: 'purchases' },
  { to: '/debts', label: 'Công nợ', icon: 'debts', permission: 'debts' },
  { to: '/inventory', label: 'Kho', icon: 'inventory', permission: 'inventory' },
  { to: '/stockouts', label: 'Xuất kho', icon: 'stockouts', permission: 'stockouts' },
  { to: '/stocktakes', label: 'Kiểm kê', icon: 'stocktakes', permission: 'stocktakes' },
  { to: '/expenses', label: 'Chi phí', icon: 'expenses', permission: 'expenses' },
  { to: '/qr-printing', label: 'QR & In tem', icon: 'qrPrinting', permission: 'qrPrinting' },
  { to: '/users', label: 'Người dùng', icon: 'users', ownerOnly: true },
  { to: '/settings', label: 'Cài đặt', icon: 'settings' },
];

const pageDescriptions: Record<string, string> = {
  '/dashboard': 'Theo dõi nhanh hoạt động của cửa hàng',
  '/sales': 'Power by TienHoang',
  '/products': 'Danh mục hàng hóa, giá và thông tin sản phẩm',
  '/customers': 'Quản lý khách hàng và thông tin liên hệ',
  '/suppliers': 'Quản lý nhà cung cấp',
  '/purchases': 'Nhập hàng và theo dõi phiếu nhập',
  '/debts': 'Theo dõi phải thu, phải trả và khoản vay',
  '/inventory': 'Tồn kho và lịch sử biến động',
  '/stockouts': 'Xuất kho nội bộ, hỏng, biếu tặng',
  '/stocktakes': 'Kiểm kê và điều chỉnh chênh lệch',
  '/expenses': 'Theo dõi các khoản chi của cửa hàng',
  '/qr-printing': 'Quét mã, tạo barcode/QR và in tem',
  '/reports': 'Đơn hàng, báo cáo kinh doanh và sao lưu dữ liệu',
  '/users': 'Phân quyền tài khoản sử dụng',
  '/settings': 'Thiết lập hệ thống',
  '/ui-lab': 'Thử nghiệm Design System nội bộ',
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getPageContext(pathname: string) {
  if (pathname === '/ui-lab') {
    return { title: 'UI Lab', description: pageDescriptions['/ui-lab'] };
  }

  const item = navigation.find((candidate) =>
    candidate.to === '/' ? pathname === '/' : pathname === candidate.to || pathname.startsWith(`${candidate.to}/`),
  );

  if (!item) {
    return { title: 'Không gian làm việc', description: 'Hệ thống quản lý bán hàng' };
  }

  return {
    title: item.label,
    description: pageDescriptions[item.to] ?? 'Hệ thống quản lý bán hàng',
  };
}

export default function AppLayout() {
  const { appUser, logout } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileDrawerRef = useRef<HTMLElement | null>(null);
  const pageContext = getPageContext(location.pathname);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;

    const drawer = mobileDrawerRef.current;
    if (!drawer) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const activeLink = drawer.querySelector<HTMLElement>('.nav-link--active');
    (activeLink ?? focusable[0] ?? drawer).focus();

    function handleKeyDown(event: KeyboardEvent) {
      const currentDrawer = mobileDrawerRef.current;
      if (!currentDrawer) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
        return;
      }

      if (event.key !== 'Tab') return;

      const currentFocusable = Array.from(currentDrawer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
      );

      if (currentFocusable.length === 0) {
        event.preventDefault();
        currentDrawer.focus();
        return;
      }

      const activeElement = document.activeElement;
      const activeIndex = currentFocusable.findIndex((element) => element === activeElement);

      if (!currentDrawer.contains(activeElement) || activeIndex < 0) {
        event.preventDefault();
        (event.shiftKey ? currentFocusable[currentFocusable.length - 1] : currentFocusable[0]).focus();
        return;
      }

      if (event.shiftKey && activeIndex === 0) {
        event.preventDefault();
        currentFocusable[currentFocusable.length - 1].focus();
      } else if (!event.shiftKey && activeIndex === currentFocusable.length - 1) {
        event.preventDefault();
        currentFocusable[0].focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      menuButtonRef.current?.focus();
    };
  }, [mobileNavOpen]);

  if (!appUser) return null;

  const roleLabel = appUser.role === 'owner' ? 'Chủ cửa hàng' : 'Nhân viên';
  const showRoleLabel = appUser.displayName.trim().toLocaleLowerCase('vi') !== roleLabel.toLocaleLowerCase('vi');

  const visibleNavigation = navigation.filter((item) => {
    if (item.ownerOnly) return appUser.role === 'owner';
    return item.permission ? hasModulePermission(appUser, item.permission) : true;
  });

  function renderNavigation(closeAfterNavigate = false) {
    return visibleNavigation.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/dashboard'}
        onClick={closeAfterNavigate ? () => setMobileNavOpen(false) : undefined}
        className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
      >
        <NavigationIcon name={item.icon} />
        <span className="nav-link__label">{item.label}</span>
      </NavLink>
    ));
  }

  return (
    <div className="workspace">
      <aside className="sidebar sidebar--desktop" aria-label="Thanh điều hướng chính">
        <div className="sidebar__brand">
          <img className="sidebar__brand-logo" src={brandLogo} alt="" aria-hidden="true" />
          <div>
            <p className="sidebar__eyebrow">Quản lý bán hàng</p>
            <h2 className="sidebar__title">Minh Điến</h2>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label="Điều hướng chính">
          {renderNavigation()}
        </nav>

        <div className="sidebar__account">
          <div className="sidebar__account-copy">
            <strong>{appUser.displayName}</strong>
            {showRoleLabel ? <span>{roleLabel}</span> : null}
          </div>
          <button className="button button--secondary button--full" type="button" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </aside>

      <div className={`workspace__main${location.pathname.startsWith('/sales') ? ' workspace__main--sales' : ''}`}>
        <header className="topbar">
          <button
            ref={menuButtonRef}
            className="shell-menu-button"
            type="button"
            aria-label="Mở menu điều hướng"
            aria-controls="mobile-navigation-drawer"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <div className="topbar__context">
            <strong>{pageContext.title}</strong>
            <span className={`topbar__sub${location.pathname.startsWith('/sales') ? ' topbar__sub--sales-credit' : ''}`}>{pageContext.description}</span>
          </div>

          <div id="topbar-notification-slot" className="topbar__notification-slot" />

          <span className="role-badge">{appUser.role === 'owner' ? 'OWNER' : 'STAFF'}</span>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>

      {mobileNavOpen ? (
        <div
          className="mobile-drawer-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMobileNavOpen(false);
          }}
        >
          <aside
            id="mobile-navigation-drawer"
            ref={mobileDrawerRef}
            className="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu điều hướng"
            tabIndex={-1}
          >
            <header className="mobile-drawer__header">
              <div className="sidebar__brand">
                <img className="sidebar__brand-logo" src={brandLogo} alt="" aria-hidden="true" />
                <div>
                  <p className="sidebar__eyebrow">Quản lý bán hàng</p>
                  <strong>Minh Điến</strong>
                </div>
              </div>
              <button
                className="shell-close-button"
                type="button"
                aria-label="Đóng menu điều hướng"
                onClick={() => setMobileNavOpen(false)}
              >
                ×
              </button>
            </header>

            <nav className="mobile-drawer__nav" aria-label="Điều hướng trên điện thoại">
              {renderNavigation(true)}
            </nav>

            <footer className="mobile-drawer__account">
              <div>
                <strong>{appUser.displayName}</strong>
                {showRoleLabel ? <span>{roleLabel}</span> : null}
              </div>
              <button className="button button--secondary button--full" type="button" onClick={() => void logout()}>
                Đăng xuất
              </button>
            </footer>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

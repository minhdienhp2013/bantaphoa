import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { firstPermittedPath, hasModulePermission } from './auth/permissions';
import { RequireAuth } from './auth/RequireAuth';
import { RequireOwner } from './auth/RequireOwner';
import { RequirePermission } from './auth/RequirePermission';
import AppLayout from './layout/AppLayout';
import { CameraPermissionProvider } from './shared/camera/CameraPermissionContext';
import CustomersPage from './modules/customers/CustomersPage';
import DebtsPage from './modules/debts/DebtsPage';
import './modules/customers/crmBrand.css';
import ExpensesPage from './modules/expenses/ExpensesPage';
import InventoryWorkspacePage from './modules/inventory/InventoryWorkspacePage';
import ProductsWorkspacePage from './modules/products/ProductsWorkspacePage';
import './modules/products/products.css';
import PurchasesPage from './modules/purchases/PurchasesPage';
import './modules/purchases/purchaseBrand.css';
import QrPrintingPage from './modules/qr/QrPrintingPage';
import ReportsPage from './modules/reports/ReportsPage';
import SalesPage from './modules/sales/SalesPage';
import SettingsPage from './modules/settings/SettingsPage';
import StockOutPage from './modules/stockout/StockOutPage';
import StocktakePage from './modules/stocktake/StocktakePage';
import './modules/inventory/inventoryBrand.css';
import './modules/stocktake/stocktakeBrand.css';
import SuppliersPage from './modules/suppliers/SuppliersPage';
import UsersPage from './modules/users/UsersPage';
import DashboardPage from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import './tabletUiPolish.css';

function HomeRoute() {
  const { appUser } = useAuth();
  if (!appUser) return null;
  if (hasModulePermission(appUser, 'sales')) return <Navigate to="/sales" replace />;
  if (hasModulePermission(appUser, 'dashboard')) return <Navigate to="/dashboard" replace />;

  const firstPath = firstPermittedPath(appUser);
  if (firstPath && firstPath !== '/') return <Navigate to={firstPath} replace />;

  return (
    <section className="auth-card">
      <p className="eyebrow">Tài khoản nhân viên</p>
      <h1>Chưa được cấp phần nào</h1>
      <p>Hãy liên hệ Chủ cửa hàng để được cấp quyền truy cập một hoặc nhiều phần của ứng dụng.</p>
    </section>
  );
}

export default function App() {
  const Router = window.banTapHoaDesktop?.isElectron ? HashRouter : BrowserRouter;

  return (
    <Router>
      <AuthProvider>
        <CameraPermissionProvider>
          <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<HomeRoute />} />
              <Route element={<RequirePermission permission="dashboard" />}>
                <Route path="dashboard" element={<DashboardPage />} />
              </Route>

              <Route element={<RequirePermission permission="products" />}>
                <Route path="products" element={<ProductsWorkspacePage />} />
              </Route>
              <Route element={<RequirePermission permission="customers" />}>
                <Route path="customers" element={<CustomersPage />} />
              </Route>
              <Route element={<RequirePermission permission="suppliers" />}>
                <Route path="suppliers" element={<SuppliersPage />} />
              </Route>
              <Route element={<RequirePermission permission="sales" />}>
                <Route path="sales" element={<SalesPage />} />
              </Route>
              <Route element={<RequirePermission permission="purchases" />}>
                <Route path="purchases" element={<PurchasesPage />} />
              </Route>
              <Route element={<RequirePermission permission="debts" />}>
                <Route path="debts" element={<DebtsPage />} />
              </Route>
              <Route element={<RequirePermission permission="inventory" />}>
                <Route path="inventory" element={<InventoryWorkspacePage />} />
              </Route>
              <Route element={<RequirePermission permission="stockouts" />}>
                <Route path="stockouts" element={<StockOutPage />} />
              </Route>
              <Route element={<RequirePermission permission="stocktakes" />}>
                <Route path="stocktakes" element={<StocktakePage />} />
              </Route>
              <Route element={<RequirePermission permission="expenses" />}>
                <Route path="expenses" element={<ExpensesPage />} />
              </Route>
              <Route element={<RequirePermission permission="qrPrinting" />}>
                <Route path="qr-printing" element={<QrPrintingPage />} />
              </Route>
              <Route element={<RequirePermission permission="reports" />}>
                <Route path="reports" element={<ReportsPage />} />
              </Route>

              <Route path="settings" element={<SettingsPage />} />
              <Route element={<RequireOwner />}>
                <Route path="users" element={<UsersPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </CameraPermissionProvider>
      </AuthProvider>
    </Router>
  );
}

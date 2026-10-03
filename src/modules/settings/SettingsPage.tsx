import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Dialog } from '../../shared/ui/dialog';
import BackupPanel from '../backup/BackupPanel';
import BusinessDataResetPanel from '../backup/BusinessDataResetPanel';
import TransactionHistoryResetPanel from '../backup/TransactionHistoryResetPanel';
import ReceiptSettingsPanel from './ReceiptSettingsPanel';
import DeviceSettingsPage from './DeviceSettingsPage';
import A4InvoiceSettingsPanel from './A4InvoiceSettingsPanel';
import '../reports/reports.css';
import './settings.css';
import './settingsDesktopMobilePolish.css';

type SettingsPanel = 'receipt' | 'a4-invoice' | 'backup' | 'history-reset' | 'business-reset' | null;

function SettingsLauncherIcon({ kind }: { kind: Exclude<SettingsPanel, null> }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': true } as const;
  switch (kind) {
    case 'receipt': return <svg {...common}><path d="M7 3h10v18l-2-1.5L13 21l-2-1.5L9 21l-2-1.5V3Z" /><path d="M9.5 8h5M9.5 12h5M9.5 16h3.5" /></svg>;
    case 'a4-invoice': return <svg {...common}><path d="M6 3h9l3 3v15H6V3Z" /><path d="M15 3v4h4M9 10h6M9 14h6M9 18h4" /></svg>;
    case 'backup': return <svg {...common}><path d="M6 4h9l3 3v13H6V4Z" /><path d="M9 4v5h6V4M9 15h6M12 12v6" /></svg>;
    case 'history-reset': return <svg {...common}><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" /><path d="M4 4v4.6h4.6M12 8v4l2.8 1.8" /></svg>;
    case 'business-reset': return <svg {...common}><path d="M12 3 3.8 18h16.4L12 3Z" /><path d="M12 9v4M12 16h.01" /></svg>;
    default: return null;
  }
}

export default function SettingsPage() {
  const { appUser } = useAuth();
  if (!appUser?.active) return null;
  return appUser.role === 'owner' ? <OwnerSettingsPage key={appUser.uid} /> : <DeviceSettingsPage key={appUser.uid} />;
}

function OwnerSettingsPage() {
  const { appUser } = useAuth();
  const [activePanel, setActivePanel] = useState<SettingsPanel>(null);
  if (!appUser || appUser.role !== 'owner') return null;
  const closePanel = () => setActivePanel(null);

  return (
    <div className="settings-shell settings-page settings-launcher-page">
      <header className="settings-header">
        <div>
          <p className="eyebrow">QUẢN TRỊ HỆ THỐNG</p>
          <h1>Cài đặt</h1>
          <p className="muted">Cấu hình in hóa đơn, thiết bị và sao lưu dữ liệu cho cửa hàng tạp hóa.</p>
        </div>
      </header>

      <DeviceSettingsPage />

      <section className="settings-launcher-section" aria-labelledby="settings-general-heading">
        <div className="settings-launcher-heading"><div><p className="eyebrow">CẤU HÌNH</p><h2 id="settings-general-heading">Hóa đơn và dữ liệu</h2></div></div>
        <div className="settings-launcher-grid">
          <button id="settings-receipt" className="settings-launcher-card" type="button" onClick={() => setActivePanel('receipt')}>
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="receipt" /></span>
            <span className="settings-launcher-card__copy"><strong>Hóa đơn nhiệt 58/80mm</strong><small>Cấu hình máy in hóa đơn, QR và in thử.</small></span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>
          <button id="settings-a4-invoice" className="settings-launcher-card" type="button" onClick={() => setActivePanel('a4-invoice')}>
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="a4-invoice" /></span>
            <span className="settings-launcher-card__copy"><strong>Thiết lập hóa đơn A4</strong><small>Mẫu phiếu bán hàng A4, tổng tiền, QR và chữ ký.</small></span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>
          <button className="settings-launcher-card" type="button" onClick={() => setActivePanel('backup')}>
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="backup" /></span>
            <span className="settings-launcher-card__copy"><strong>Sao lưu & khôi phục</strong><small>Tạo bản sao dữ liệu hoặc khôi phục từ bản sao lưu.</small></span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </section>

      <section id="settings-danger-zone" className="settings-launcher-section settings-launcher-section--danger" aria-labelledby="settings-data-heading">
        <div className="settings-launcher-heading"><div><p className="eyebrow">DỮ LIỆU HỆ THỐNG</p><h2 id="settings-data-heading">Thao tác dữ liệu</h2><p>Các thao tác xóa vẫn giữ bước xác nhận an toàn.</p></div></div>
        <div className="settings-launcher-grid settings-launcher-grid--danger">
          <button className="settings-launcher-card settings-launcher-card--warning" type="button" onClick={() => setActivePanel('history-reset')}>
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="history-reset" /></span>
            <span className="settings-launcher-card__copy"><strong>Xóa lịch sử giao dịch</strong><small>Xóa lịch sử theo phạm vi cho phép.</small></span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>
          <button className="settings-launcher-card settings-launcher-card--danger" type="button" onClick={() => setActivePanel('business-reset')}>
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="business-reset" /></span>
            <span className="settings-launcher-card__copy"><strong>Reset toàn bộ dữ liệu</strong><small>Hard reset dữ liệu kinh doanh sau bước xác nhận.</small></span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </section>

      <Dialog open={activePanel === 'receipt'} title="Hóa đơn nhiệt 58/80mm" onClose={closePanel}><div className="settings-window-content"><ReceiptSettingsPanel /></div></Dialog>
      <Dialog open={activePanel === 'a4-invoice'} title="Thiết lập hóa đơn A4" onClose={closePanel}><div className="settings-window-content"><A4InvoiceSettingsPanel /></div></Dialog>
      <Dialog open={activePanel === 'backup'} title="Sao lưu & khôi phục" onClose={closePanel}><div className="settings-window-content settings-window-embedded"><BackupPanel actorUid={appUser.uid} /></div></Dialog>
      <Dialog open={activePanel === 'history-reset'} title="Xóa lịch sử giao dịch" onClose={closePanel}><div className="settings-window-content settings-window-embedded"><TransactionHistoryResetPanel actorUid={appUser.uid} /></div></Dialog>
      <Dialog open={activePanel === 'business-reset'} title="Reset toàn bộ dữ liệu" onClose={closePanel}><div className="settings-window-content settings-window-embedded"><BusinessDataResetPanel actorUid={appUser.uid} /></div></Dialog>
    </div>
  );
}

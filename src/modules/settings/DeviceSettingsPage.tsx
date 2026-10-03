import DesktopPrinterSettings from './DesktopPrinterSettings';
import CashDrawerConnectionSettings from './CashDrawerConnectionSettings';

export default function DeviceSettingsPage() {
  const isDesktop = Boolean(window.minhDienDesktop?.isElectron);
  return (
    <div className="settings-shell settings-page">
      <header className="settings-header">
        <div>
          <p className="eyebrow">THIẾT BỊ</p>
          <h1>Cài đặt máy in và két tiền</h1>
          <p className="muted">Cấu hình lưu riêng trên thiết bị đang sử dụng.</p>
        </div>
      </header>
      {isDesktop ? (
        <>
          <DesktopPrinterSettings />
          <DesktopPrinterSettings mode="a4" />
        </>
      ) : (
        <p className="muted">
          Khi in hóa đơn trên trình duyệt, chọn máy in trong hộp thoại In.
          Để mở két qua máy tính tại quầy, nhập địa chỉ và mã ghép nối bên dưới.
        </p>
      )}
      <CashDrawerConnectionSettings />
    </div>
  );
}

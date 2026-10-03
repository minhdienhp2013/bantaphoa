import { useEffect, useState } from 'react';
import type { CashDrawerSettings, CashDrawerLanInfo } from '../../types/electron';

const defaults: CashDrawerSettings = { enabled: false, host: '', port: 9100, pin: 0, onTime: 25, offTime: 250 };

export default function DesktopCashDrawerSettings() {
  const desktop = window.banTapHoaDesktop;
  const [settings, setSettings] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [lanInfo, setLanInfo] = useState<CashDrawerLanInfo>({ addresses: [], certificate: null, running: false });
  useEffect(() => {
    let active = true;
    if (!desktop?.getCashDrawerSettings) return;
    desktop.getCashDrawerSettings().then((value) => {
      if (active) setSettings(value);
    }).catch(() => {
      if (active) setError('Không đọc được cấu hình két tiền trên máy tính này.');
    }).finally(() => { if (active) setLoading(false); });
    desktop.getCashDrawerLanInfo?.().then((value) => { if (active) setLanInfo(value); })
      .catch(() => { if (active) setError('Không đọc được địa chỉ mạng nội bộ của máy tính.'); });
    return () => { active = false; };
  }, [desktop]);
  if (!desktop?.getCashDrawerSettings || !desktop.saveCashDrawerSettings) return null;
  const disabled = loading || saving;
  return (
    <section className="receipt-desktop-printer" aria-labelledby="cash-drawer-settings-heading">
      <div className="receipt-desktop-printer__heading">
        <div>
          <strong id="cash-drawer-settings-heading">Két JJ405 · máy in PRP-085K</strong>
          <small>Cấu hình kết nối USB hoặc LAN lưu riêng trên máy tính này. Chỉ bật sau khi kiểm tra cổng két và giao thức máy in.</small>
        </div>
      </div>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (disabled || !desktop.saveCashDrawerSettings) return;
        setSaving(true); setError(''); setMessage('');
        try {
          setSettings(await desktop.saveCashDrawerSettings(settings));
          if (desktop.getCashDrawerLanInfo) setLanInfo(await desktop.getCashDrawerLanInfo());
          setMessage('Đã lưu cấu hình két. Thao tác lưu không gửi lệnh mở két.');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Không lưu được cấu hình két.');
        } finally { setSaving(false); }
      }}>
        <label className="receipt-settings-field">
          <span><input type="checkbox" checked={settings.enabled} disabled={disabled}
            onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />
            {' '}Tự mở két khi thu hoặc xuất tiền mặt</span>
        </label>
        <label className="receipt-settings-field"><span>Kết nối máy in</span>
          <select disabled={disabled} value={settings.transport || 'lan'}
            onChange={(event) => setSettings({ ...settings, transport: event.target.value === 'usb' ? 'usb' : 'lan' })}>
            <option value="lan">LAN (dây mạng hoặc Wi-Fi)</option>
            <option value="usb" disabled={desktop.platform !== 'win32'}>USB qua Windows</option>
          </select></label>
        {settings.transport === 'usb' ? <label className="receipt-settings-field"><span>Tên máy in USB trong Windows</span>
          <input disabled={disabled} value={settings.printerName || ''} placeholder="Nhập đúng tên máy in đã cài trong Windows"
            onChange={(event) => setSettings({ ...settings, printerName: event.target.value })} /></label> : null}
        <div className="receipt-desktop-printer__grid">
          <label className="receipt-settings-field"><span>IP nội bộ của máy in</span>
            <input value={settings.host} disabled={disabled} placeholder="Chưa cấu hình"
              onChange={(event) => setSettings({ ...settings, host: event.target.value })} /></label>
          <label className="receipt-settings-field"><span>Cổng máy in LAN</span>
            <input type="number" inputMode="numeric" step="1" min={1} max={65535} required value={settings.port} disabled={disabled}
              onChange={(event) => setSettings({ ...settings, port: Number(event.target.value) })} /></label>
        </div>
        <details>
          <summary>Ghép nối PC, iPad và điện thoại</summary>
          <label className="receipt-settings-field"><span><input type="checkbox" disabled={disabled}
            checked={Boolean(settings.relayEnabled)} onChange={(event) => setSettings({ ...settings, relayEnabled: event.target.checked })} /> Bật cầu nối trên máy tính này</span></label>
          <label className="receipt-settings-field"><span>Cách kết nối thiết bị khác</span>
            <select value={settings.relayMode || 'tailscale'} disabled={disabled}
              onChange={(event) => setSettings({ ...settings, relayMode: event.target.value === 'lan' ? 'lan' : 'tailscale',
                relayHost: settings.relayHost || lanInfo.addresses[0]?.address || '',
                relayOrigin: settings.relayOrigin || 'https://ban-tap-hoa-web.pages.dev' })}>
              <option value="lan" disabled={desktop.platform !== 'win32'}>Mạng nội bộ — không VPN</option>
              <option value="tailscale">Tailscale</option>
            </select></label>
          {settings.relayMode === 'lan' ? <>
            <label className="receipt-settings-field"><span>IP mạng nội bộ của máy tính tại quầy</span>
              <select disabled={disabled} value={settings.relayHost || ''}
                onChange={(event) => { setSettings({ ...settings, relayHost: event.target.value }); setLanInfo({ ...lanInfo, certificate: null, running: false }); }}>
                <option value="">Chọn mạng đang dùng</option>
                {lanInfo.addresses.map((entry) => <option key={`${entry.name}-${entry.address}`} value={entry.address}>{entry.name}: {entry.address}</option>)}
              </select></label>
            <button type="button" className="button" disabled={disabled || !settings.relayHost || !desktop.prepareCashDrawerLan}
              onClick={async () => {
                if (!desktop.prepareCashDrawerLan || !desktop.saveCashDrawerSettings || !settings.relayHost) return;
                setSaving(true); setError(''); setMessage('');
                try {
                  const certificate = await desktop.prepareCashDrawerLan(settings.relayHost);
                  const next = { ...settings, relayEnabled: true,
                    relayKey: settings.relayKey || Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('') };
                  setSettings(next);
                  await desktop.saveCashDrawerSettings(next);
                  if (desktop.getCashDrawerLanInfo) setLanInfo(await desktop.getCashDrawerLanInfo());
                  else setLanInfo({ ...lanInfo, certificate });
                  setMessage('Đã bật kết nối nội bộ. Trên điện thoại, mở địa chỉ cài chứng chỉ bên dưới, sau đó nhập địa chỉ kết nối và mã ghép nối.');
                } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không chuẩn bị được LAN.'); }
                finally { setSaving(false); }
              }}>{saving ? 'Đang thiết lập…' : 'Thiết lập mạng nội bộ'}</button>
            {lanInfo.certificate ? <div style={{ overflowWrap: 'anywhere' }}>
              <p>Địa chỉ nhập trên thiết bị khác: <strong>{lanInfo.certificate.url}</strong></p>
              <p>Trên điện thoại, mở <strong>{lanInfo.certificate.certificateUrl}</strong> để cài chứng chỉ một lần. Trang tải hoạt động sau khi lưu cấu hình.</p>
              <details><summary>Thông tin chứng chỉ</summary>
                <p>Dấu vân tay để đối chiếu: {lanInfo.certificate.fingerprint}</p>
                <p>Chứng chỉ hết hạn: {new Date(lanInfo.certificate.expiresAt).toLocaleDateString('vi-VN')}.</p>
              </details>
            </div> : null}
            <p>iPhone/iPad: cài hồ sơ chứng chỉ, rồi bật tin cậy trong Cài đặt chung → Giới thiệu → Cài đặt tin cậy chứng chỉ. Hồ sơ chỉ chứa chứng chỉ, không tạo VPN. Android/PC: cài chứng chỉ CA theo hướng dẫn ở trang tải.</p>
            <p>Giữ máy tính và điện thoại cùng mạng, dùng IP máy tính cố định trên modem. Cho phép ứng dụng qua Windows Firewall trên mạng Private; xem hướng dẫn LAN nếu vẫn bị chặn.</p>
            <p>{lanInfo.running ? 'Kết nối nội bộ đang chạy.' : 'Bấm Thiết lập mạng nội bộ để bắt đầu.'}</p>
          </> : null}
          <details><summary>Ghép nối nâng cao / đổi mã</summary>
          <label className="receipt-settings-field"><span>Địa chỉ ứng dụng bán hàng (HTTPS, không có đường dẫn)</span>
            <input disabled={disabled} value={settings.relayOrigin || ''} placeholder="https://dia-chi-ung-dung"
              onChange={(event) => setSettings({ ...settings, relayOrigin: event.target.value })} /></label>
          <label className="receipt-settings-field"><span>Mã ghép nối riêng của cửa hàng</span>
            <input type="password" autoComplete="off" disabled={disabled} value={settings.relayKey || ''}
              onChange={(event) => setSettings({ ...settings, relayKey: event.target.value })} /></label>
          <button type="button" className="button" disabled={disabled} onClick={() => setSettings({ ...settings,
            relayKey: Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('') })}>Tạo mã ghép nối mới</button>
          <p>Đổi mã rồi bấm Lưu cấu hình két để ngắt các thiết bị đã ghép bằng mã cũ.</p>
          </details>
          <button type="button" className="button" disabled={disabled || !settings.relayKey} onClick={async () => {
            try { await navigator.clipboard.writeText(settings.relayKey || ''); setMessage('Đã sao chép mã ghép nối.'); }
            catch { setError('Không sao chép được mã; chọn và sao chép thủ công.'); }
          }}>Sao chép mã</button>
          <p>{settings.relayMode === 'lan'
            ? 'Dùng địa chỉ HTTPS nội bộ và mã ghép nối ở Cài đặt hóa đơn trên từng thiết bị. Cho phép trình duyệt truy cập mạng nội bộ nếu được hỏi. Giữ máy tính bật khi bán hàng.'
            : 'Cần bật Tailscale Serve HTTPS tới cổng 28089 trên máy tính này, rồi nhập địa chỉ HTTPS và mã ghép nối ở Cài đặt hóa đơn trên từng thiết bị. Giữ máy tính bật khi bán hàng.'}</p>
        </details>
        <details>
          <summary>Thông số lệnh mở két</summary>
          <p className="receipt-desktop-printer__hint">Các thông số ESC/POS cần đối chiếu tài liệu máy in trước khi bật.</p>
          <label className="receipt-settings-field"><span>Chân tín hiệu két</span>
            <select value={settings.pin} disabled={disabled}
              onChange={(event) => setSettings({ ...settings, pin: Number(event.target.value) === 1 ? 1 : 0 })}>
              <option value={0}>Pin 2</option><option value={1}>Pin 5</option>
            </select></label>
          <label className="receipt-settings-field"><span>Thời gian bật xung (đơn vị 2 ms)</span>
            <input type="number" inputMode="numeric" step="1" min={1} max={255} required value={settings.onTime} disabled={disabled}
              onChange={(event) => setSettings({ ...settings, onTime: Number(event.target.value) })} /></label>
          <label className="receipt-settings-field"><span>Thời gian nghỉ xung (đơn vị 2 ms)</span>
            <input type="number" inputMode="numeric" step="1" min={settings.onTime} max={255} required value={settings.offTime} disabled={disabled}
              onChange={(event) => setSettings({ ...settings, offTime: Number(event.target.value) })} /></label>
        </details>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {message ? <p className="settings-success" role="status">{message}</p> : null}
        <button className="button button--primary" type="submit" disabled={disabled}>
          {saving ? 'Đang lưu…' : 'Lưu cấu hình két'}
        </button>
      </form>
      <p className="receipt-desktop-printer__hint">Không in hóa đơn khi xuất tiền. USB cần máy in đã cài trên Windows; LAN cần máy tính và máy in cùng mạng; chưa kiểm thử trên thiết bị thật.</p>
    </section>
  );
}

import { useState } from 'react';
import { readCashDrawerConnection, requestCashDrawerRelay, saveCashDrawerConnection } from '../sales/cashDrawerConnection';
export default function CashDrawerConnectionSettings() {
  const [connection, setConnection] = useState(() => readCashDrawerConnection() || { url: '', key: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  if (window.banTapHoaDesktop?.isElectron) return null;
  return <section className="receipt-desktop-printer" aria-label="Kết nối két tiền">
    <strong>Két tiền · kết nối máy tính tại quầy</strong>
    <p>PC, iPad và điện thoại dùng chung két qua máy tính Windows tại quầy. Nếu chọn mạng nội bộ, dùng cùng Wi-Fi/LAN và cài chứng chỉ của máy tính một lần; không cần VPN. Máy tính cần giữ ứng dụng chạy và máy in kết nối. Tailscale là lựa chọn khác.</p>
    <form onSubmit={async (event) => {
      event.preventDefault(); if (busy) return;
      setBusy(true); setMessage(''); setError('');
      try { await requestCashDrawerRelay(connection); saveCashDrawerConnection(connection); setMessage('Đã kết nối két trên thiết bị này. Kiểm tra kết nối không mở két.'); }
      catch (cause) { setError(cause instanceof Error && cause.name !== 'TypeError'
        ? cause.message : 'Không kết nối được máy tính tại quầy. Kiểm tra cùng mạng, chứng chỉ đã tin cậy, quyền mạng nội bộ của trình duyệt và Windows Firewall.'); }
      finally { setBusy(false); }
    }}>
      <label className="receipt-settings-field"><span>Địa chỉ HTTPS của máy tính tại quầy</span>
        <input type="url" required disabled={busy} value={connection.url} placeholder="https://192.168.1.10:28090"
          onChange={(event) => setConnection({ ...connection, url: event.target.value })} /></label>
      <label className="receipt-settings-field"><span>Mã ghép nối</span>
        <input type="password" required autoComplete="off" disabled={busy} value={connection.key}
          onChange={(event) => setConnection({ ...connection, key: event.target.value })} /></label>
      <button type="submit" className="button button--primary" disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Kiểm tra và lưu kết nối'}</button>
      <button type="button" className="button" disabled={busy} onClick={() => {
        saveCashDrawerConnection(null); setConnection({ url: '', key: '' }); setError(''); setMessage('Đã ngắt ghép nối trên thiết bị này.');
      }}>Ngắt ghép nối</button>
    </form>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {message ? <p role="status" className="settings-success">{message}</p> : null}
  </section>;
}

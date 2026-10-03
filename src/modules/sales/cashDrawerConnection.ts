export interface CashDrawerConnection { url: string; key: string }
const STORAGE_KEY = 'minhdien.cashDrawerConnection.v1';
export function normalizeCashDrawerConnection(input: CashDrawerConnection): CashDrawerConnection {
  const url = new URL(input.url.trim());
  const octets = url.hostname.split('.');
  const ipv4 = octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  const privateIP = ipv4 && (Number(octets[0]) === 10
    || (Number(octets[0]) === 172 && Number(octets[1]) >= 16 && Number(octets[1]) <= 31)
    || (Number(octets[0]) === 192 && Number(octets[1]) === 168));
  const allowedHost = (url.hostname.endsWith('.ts.net') && !url.port)
    || (privateIP && url.port === '28090');
  if (url.protocol !== 'https:' || !allowedHost || url.username || url.password
    || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Nhập HTTPS IP nội bộ với cổng 28090 hoặc địa chỉ Tailscale, không có đường dẫn.');
  }
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(input.key)) throw new Error('Mã ghép nối không hợp lệ.');
  return { url: url.origin, key: input.key };
}
export function readCashDrawerConnection(): CashDrawerConnection | null {
  try { return normalizeCashDrawerConnection(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
  catch { return null; }
}
export function saveCashDrawerConnection(input: CashDrawerConnection | null) {
  if (!input) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeCashDrawerConnection(input)));
}
export async function requestCashDrawerRelay(connection: CashDrawerConnection, transactionId?: string) {
  const valid = normalizeCashDrawerConnection(connection);
  const response = await fetch(`${valid.url}/${transactionId ? 'open' : 'status'}`, {
    method: transactionId ? 'POST' : 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
    headers: { Authorization: `Bearer ${valid.key}`, ...(transactionId ? { 'Content-Type': 'application/json' } : {}) },
    ...(transactionId ? { body: JSON.stringify({ transactionId }) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Cầu nối từ chối kết nối; kiểm tra mã ghép nối và địa chỉ ứng dụng.');
  const result = await response.json();
  if (transactionId && !['sent', 'not_configured', 'busy', 'already_attempted', 'failed'].includes(result.status)) throw new Error('Phản hồi cầu nối không hợp lệ.');
  if (!transactionId && result.ready !== true) throw new Error('Cầu nối chưa sẵn sàng.');
  return result as { status: 'sent' | 'not_configured' | 'busy' | 'already_attempted' | 'failed'; ready?: boolean };
}

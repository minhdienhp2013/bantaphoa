import { readCashDrawerConnection, requestCashDrawerRelay } from './cashDrawerConnection';
export async function openCashDrawerAfterTransaction(transactionId: string, kind: 'expense' | 'quick_service' | 'product' | 'manual' = 'expense'): Promise<string | null> {
  const savedNotice = kind === 'manual' ? '' : kind === 'quick_service' ? 'Đã lưu thanh toán dịch vụ.'
    : kind === 'product' ? 'Đã lưu đơn bán hàng.' : 'Đã lưu khoản chi.';
  const desktop = typeof window !== 'undefined' ? window.minhDienDesktop : undefined;
  const connection = desktop?.isElectron && desktop.openCashDrawer ? null : readCashDrawerConnection();
  if (!(desktop?.isElectron && desktop.openCashDrawer) && !connection) {
    return `${savedNotice} Chưa kết nối két tiền trên thiết bị này.`.trim();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      desktop?.isElectron && desktop.openCashDrawer
        ? desktop.openCashDrawer({ transactionId })
        : requestCashDrawerRelay(connection!, transactionId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 5000);
      }),
    ]);
    switch (result.status) {
      case 'sent': return null;
      case 'not_configured': return `${savedNotice} Chưa kết nối két tiền; hãy kiểm tra cấu hình máy in.`.trim();
      case 'already_attempted': return `${savedNotice} Lệnh mở két đã được xử lý trước đó; không tự gửi lại.`.trim();
      case 'busy': return `${savedNotice} Két vừa nhận lệnh hoặc đang bận; vui lòng kiểm tra két.`.trim();
      default: return `${savedNotice} Không gửi được lệnh mở két; vui lòng kiểm tra máy in và mở két thủ công.`.trim();
    }
  } catch {
    return `${savedNotice} Kết nối két lỗi hoặc hết thời gian chờ; không tự gửi lặp lệnh.`.trim();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

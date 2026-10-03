import CashDrawerConnectionSettings from './CashDrawerConnectionSettings';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { InvoicePaperSize, ProductSale, StoreSettings } from '../../types/models';
import DesktopPrinterSettings from './DesktopPrinterSettings';
import { printSaleReceipt } from '../printing/receiptPrint';
import {
  DEFAULT_RECEIPT_SETTINGS,
  saveReceiptConfiguration,
  subscribeReceiptConfiguration,
  type ReceiptConfiguration,
} from './receiptSettings';

const EMPTY_CONFIGURATION: ReceiptConfiguration = {
  storeName: '',
  address: '',
  phone: '',
  defaultInvoicePaperSize: '80mm',
  receipt: { ...DEFAULT_RECEIPT_SETTINGS },
};

const MAX_QR_SOURCE_BYTES = 6 * 1024 * 1024;
const MAX_QR_DATA_URL_LENGTH = 180_000;
const MAX_QR_EDGE_PX = 480;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc ảnh QR đã chọn.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Ảnh QR không hợp lệ.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function loadQrImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Không thể mở ảnh QR đã chọn.'));
    image.src = src;
  });
}

async function prepareQrImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Ảnh QR phải là PNG, JPG hoặc WebP.');
  }
  if (file.size > MAX_QR_SOURCE_BYTES) {
    throw new Error('Ảnh QR quá lớn. Hãy chọn ảnh nhỏ hơn 6 MB.');
  }

  const source = await readFileAsDataUrl(file);
  const image = await loadQrImage(source);
  const maxSourceEdge = Math.max(image.naturalWidth, image.naturalHeight);
  if (!maxSourceEdge) throw new Error('Ảnh QR không có kích thước hợp lệ.');

  const scale = Math.min(1, MAX_QR_EDGE_PX / maxSourceEdge);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Trình duyệt không thể xử lý ảnh QR.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);

  let result = canvas.toDataURL('image/png');
  if (result.length > MAX_QR_DATA_URL_LENGTH) {
    result = canvas.toDataURL('image/webp', 0.92);
  }
  if (result.length > MAX_QR_DATA_URL_LENGTH) {
    throw new Error('Ảnh QR vẫn quá lớn sau khi tối ưu. Hãy cắt gọn chỉ phần mã QR rồi thử lại.');
  }
  return result;
}

function buildTestSale(): ProductSale {
  const createdAt = Date.now();
  return {
    id: 'receipt-preview',
    code: 'BH-IN-THU',
    saleKind: 'product',
    customerName: 'Khách lẻ',
    items: [
      {
        productId: 'preview-product',
        sku: 'SP-MAU',
        name: 'Sản phẩm mẫu',
        quantity: 1,
        unitPrice: 125000,
        costPrice: 90000,
        lineTotal: 125000,
      },
    ],
    subtotal: 125000,
    discount: 5000,
    total: 120000,
    costTotal: 90000,
    profit: 30000,
    paymentMethod: 'cash',
    note: 'Phiếu in thử – không ghi doanh thu.',
    status: 'completed',
    createdBy: 'preview',
    createdAt,
    updatedAt: createdAt,
  };
}

export default function ReceiptSettingsPanel() {
  const [draft, setDraft] = useState<ReceiptConfiguration>(EMPTY_CONFIGURATION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [processingQr, setProcessingQr] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    return subscribeReceiptConfiguration(
      (value) => {
        setDraft(value);
        setLoading(false);
      },
      (cause) => {
        setError(cause.message);
        setLoading(false);
      },
    );
  }, []);

  const previewSettings = useMemo<StoreSettings>(() => ({
    storeName: draft.storeName.trim(),
    ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
    ...(draft.phone.trim() ? { phone: draft.phone.trim() } : {}),
    currency: 'VND',
    defaultInvoicePaperSize: draft.defaultInvoicePaperSize,
    receipt: { ...draft.receipt },
    updatedAt: Date.now(),
  }), [draft]);

  function updateReceipt<K extends keyof ReceiptConfiguration['receipt']>(
    key: K,
    value: ReceiptConfiguration['receipt'][K],
  ) {
    setDraft((current) => ({
      ...current,
      receipt: { ...current.receipt, [key]: value },
    }));
    setMessage('');
  }

  async function handleQrImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || processingQr) return;

    setProcessingQr(true);
    setError('');
    setMessage('');
    try {
      const paymentQrImageDataUrl = await prepareQrImage(file);
      setDraft((current) => ({
        ...current,
        receipt: { ...current.receipt, paymentQrImageDataUrl },
      }));
      setMessage('Đã chèn ảnh QR. Bấm “Lưu cài đặt hóa đơn” để áp dụng.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xử lý ảnh QR.');
    } finally {
      setProcessingQr(false);
    }
  }

  function handleRemoveQrImage() {
    setDraft((current) => {
      const receipt = { ...current.receipt };
      delete receipt.paymentQrImageDataUrl;
      return { ...current, receipt };
    });
    setError('');
    setMessage('Đã bỏ ảnh QR khỏi bản nháp. Bấm “Lưu cài đặt hóa đơn” để áp dụng.');
  }

  async function handleSave() {
    if (saving || loading) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveReceiptConfiguration(draft);
      setDraft(saved);
      setMessage('Đã lưu cài đặt hóa đơn.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu cài đặt hóa đơn.');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestPrint() {
    if (printing) return;
    setPrinting(true);
    setError('');
    setMessage('');
    try {
      await printSaleReceipt(
        buildTestSale(),
        previewSettings,
        {
          paperSize: draft.receipt.defaultPaperSize,
          creatorName: 'Nhân viên mẫu',
        },
      );
      setMessage('Đã mở hộp thoại in thử. Phiếu mẫu không ghi vào doanh thu.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể mở bản in thử.');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <section className="receipt-settings-panel" aria-label="Cài đặt hóa đơn">
      <div className="settings-window-intro">
        <h3>Cấu hình phiếu bán hàng</h3>
        <p className="muted">
          Dùng chung cho nút In hóa đơn và In lại. Mẫu 7,8 cm được in trên máy giấy 80mm.
        </p>
      </div>

      {loading ? <p className="muted">Đang tải cài đặt hóa đơn…</p> : null}

      <div className="receipt-settings-grid">
        <label className="receipt-settings-field receipt-settings-field--wide">
          <span>Tên cửa hàng</span>
          <input
            type="text"
            maxLength={120}
            value={draft.storeName}
            disabled={loading || saving}
            placeholder="Ví dụ: Minh Điến"
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              setDraft((current) => ({ ...current, storeName: nextValue }));
            }}
          />
        </label>

        <label className="receipt-settings-field receipt-settings-field--wide">
          <span>Địa chỉ</span>
          <input
            type="text"
            maxLength={220}
            value={draft.address}
            disabled={loading || saving}
            placeholder="Địa chỉ cửa hàng"
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              setDraft((current) => ({ ...current, address: nextValue }));
            }}
          />
        </label>

        <label className="receipt-settings-field">
          <span>Số điện thoại</span>
          <input
            type="tel"
            maxLength={40}
            value={draft.phone}
            disabled={loading || saving}
            placeholder="Số điện thoại"
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              setDraft((current) => ({ ...current, phone: nextValue }));
            }}
          />
        </label>

        <label className="receipt-settings-field">
          <span>Khổ hóa đơn mặc định</span>
          <select
            value={draft.defaultInvoicePaperSize}
            disabled={loading || saving}
            onChange={(event) => {
              const nextValue = event.currentTarget.value as InvoicePaperSize;
              setDraft((current) => ({
                ...current,
                defaultInvoicePaperSize: nextValue,
                receipt: nextValue === 'A4'
                  ? current.receipt
                  : { ...current.receipt, defaultPaperSize: nextValue },
              }));
              setMessage('');
            }}
          >
            <option value="A4">A4 — máy in văn phòng</option>
            <option value="80mm">7,8 cm — máy in nhiệt 80mm</option>
            <option value="58mm">58mm — máy in nhiệt</option>
          </select>
        </label>

        <label className="receipt-settings-field receipt-settings-field--wide">
          <span>Tiêu đề hóa đơn</span>
          <input
            type="text"
            maxLength={80}
            value={draft.receipt.title}
            disabled={loading || saving}
            onChange={(event) => updateReceipt('title', event.currentTarget.value)}
          />
        </label>

        <label className="receipt-settings-field receipt-settings-field--wide">
          <span>Dòng cuối hóa đơn</span>
          <input
            type="text"
            maxLength={160}
            value={draft.receipt.footer}
            disabled={loading || saving}
            onChange={(event) => updateReceipt('footer', event.currentTarget.value)}
          />
        </label>
      </div>

      <fieldset className="receipt-settings-options" disabled={loading || saving}>
        <legend>Nội dung hiển thị</legend>
        <label>
          <input
            type="checkbox"
            checked={draft.receipt.showSku}
            onChange={(event) => updateReceipt('showSku', event.currentTarget.checked)}
          />
          <span>Hiện mã SKU sản phẩm</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.receipt.showCreator}
            onChange={(event) => updateReceipt('showCreator', event.currentTarget.checked)}
          />
          <span>Hiện tên nhân viên</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.receipt.showPaymentMethod}
            onChange={(event) => updateReceipt('showPaymentMethod', event.currentTarget.checked)}
          />
          <span>Hiện phương thức thanh toán</span>
        </label>
      </fieldset>

      <DesktopPrinterSettings paperSize={draft.receipt.defaultPaperSize} />
      <CashDrawerConnectionSettings />

      <section className="receipt-settings-qr" aria-labelledby="receipt-payment-qr-heading">
        <div className="receipt-settings-qr__heading">
          <div>
            <strong id="receipt-payment-qr-heading">Ảnh QR thanh toán</strong>
            <small>Chèn ảnh QR của bạn vào cuối hóa đơn. Phần mềm không tự thay đổi số tiền hay nội dung mã QR.</small>
          </div>
        </div>

        <div className="receipt-settings-qr__content">
          <div className="receipt-settings-qr__preview">
            {draft.receipt.paymentQrImageDataUrl ? (
              <img src={draft.receipt.paymentQrImageDataUrl} alt="Ảnh QR thanh toán đang chọn" />
            ) : (
              <span>Chưa có ảnh QR</span>
            )}
          </div>

          <div className="receipt-settings-qr__actions">
            <label className="button receipt-settings-qr__pick">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={loading || saving || processingQr}
                onChange={(event) => void handleQrImageChange(event)}
              />
              {processingQr
                ? 'Đang xử lý ảnh…'
                : draft.receipt.paymentQrImageDataUrl
                  ? 'Thay ảnh QR'
                  : 'Chọn ảnh QR'}
            </label>
            {draft.receipt.paymentQrImageDataUrl ? (
              <button
                className="button"
                type="button"
                disabled={loading || saving || processingQr}
                onClick={handleRemoveQrImage}
              >
                Xóa ảnh QR
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="settings-success" role="status">{message}</p> : null}

      <div className="receipt-settings-actions">
        <button
          className="button receipt-settings-test"
          type="button"
          disabled={loading || printing}
          onClick={() => void handleTestPrint()}
        >
          {printing ? 'Đang mở in…' : '🖨 In thử hóa đơn nhiệt'}
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={loading || saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Đang lưu…' : 'Lưu cài đặt hóa đơn'}
        </button>
      </div>
    </section>
  );
}


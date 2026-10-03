import { useEffect, useMemo, useState } from 'react';
import type { InvoicePaperSize, ProductSale, StoreSettings } from '../../types/models';
import { printA4Invoice } from '../printing/a4InvoicePrint';
import { DEFAULT_RECEIPT_SETTINGS } from './receiptSettings';
import DesktopPrinterSettings from './DesktopPrinterSettings';
import {
  DEFAULT_A4_INVOICE_SETTINGS,
  saveA4InvoiceConfiguration,
  subscribeA4InvoiceConfiguration,
  type A4InvoiceConfiguration,
} from './a4InvoiceSettings';

const EMPTY_CONFIGURATION: A4InvoiceConfiguration = {
  storeName: '',
  address: '',
  phone: '',
  defaultInvoicePaperSize: 'A4',
  a4Invoice: { ...DEFAULT_A4_INVOICE_SETTINGS },
};

function buildTestSale(): ProductSale {
  const createdAt = Date.now();
  return {
    id: 'a4-preview',
    code: 'BH-A4-IN-THU',
    saleKind: 'product',
    customerName: 'Nguyễn Văn A',
    items: [
      {
        productId: 'preview-1',
        sku: 'SP-A4-01',
        name: 'Sản phẩm mẫu 1',
        quantity: 2,
        unitPrice: 125000,
        costPrice: 80000,
        lineTotal: 250000,
      },
      {
        productId: 'preview-2',
        sku: 'SP-A4-02',
        name: 'Sản phẩm mẫu 2',
        quantity: 1,
        unitPrice: 350000,
        costPrice: 260000,
        lineTotal: 350000,
      },
    ],
    subtotal: 600000,
    discount: 20000,
    total: 580000,
    costTotal: 420000,
    profit: 160000,
    paymentMethod: 'bank_transfer',
    note: 'Số 12 đường mẫu, phường mẫu, Hải Phòng.',
    status: 'completed',
    createdBy: 'preview',
    createdAt,
    updatedAt: createdAt,
  };
}

export default function A4InvoiceSettingsPanel() {
  const [draft, setDraft] = useState<A4InvoiceConfiguration>(EMPTY_CONFIGURATION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    return subscribeA4InvoiceConfiguration(
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
    a4Invoice: { ...draft.a4Invoice },
    ...(draft.paymentQrImageDataUrl
      ? {
          receipt: {
            ...DEFAULT_RECEIPT_SETTINGS,
            paymentQrImageDataUrl: draft.paymentQrImageDataUrl,
          },
        }
      : {}),
    updatedAt: Date.now(),
  }), [draft]);

  function updateA4<K extends keyof A4InvoiceConfiguration['a4Invoice']>(
    key: K,
    value: A4InvoiceConfiguration['a4Invoice'][K],
  ) {
    setDraft((current) => ({
      ...current,
      a4Invoice: { ...current.a4Invoice, [key]: value },
    }));
    setMessage('');
  }

  async function handleSave() {
    if (saving || loading) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveA4InvoiceConfiguration(draft);
      setDraft(saved);
      setMessage('Đã lưu thiết lập phiếu bán hàng A4.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể lưu thiết lập A4.');
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
      await printA4Invoice(
        buildTestSale(),
        previewSettings,
        { creatorName: 'Nhân viên mẫu' },
      );
      setMessage('Đã mở bản in thử A4. Phiếu mẫu không ghi doanh thu.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể mở bản in thử A4.');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <section className="receipt-settings-panel" aria-label="Thiết lập phiếu bán hàng A4">
      <div className="settings-window-intro">
        <h3>Phiếu bán hàng A4</h3>
        <p className="muted">
          Mẫu A4 dọc dành cho máy in văn phòng. Phần này tách riêng, không làm thay đổi mẫu hóa đơn nhiệt 7,8 cm / 58mm.
        </p>
      </div>

      {loading ? <p className="muted">Đang tải thiết lập A4…</p> : null}

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
          <span>Địa chỉ cửa hàng</span>
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
              setDraft((current) => ({ ...current, defaultInvoicePaperSize: nextValue }));
              setMessage('');
            }}
          >
            <option value="A4">A4 — mặc định cho máy in văn phòng</option>
            <option value="80mm">80mm — máy in nhiệt</option>
            <option value="58mm">58mm — máy in nhiệt</option>
          </select>
        </label>

        <label className="receipt-settings-field">
          <span>Tiêu đề A4</span>
          <input
            type="text"
            maxLength={100}
            value={draft.a4Invoice.title}
            disabled={loading || saving}
            onChange={(event) => updateA4('title', event.currentTarget.value)}
          />
        </label>

        <label className="receipt-settings-field receipt-settings-field--wide">
          <span>Dòng phụ dưới tiêu đề</span>
          <input
            type="text"
            maxLength={120}
            value={draft.a4Invoice.subtitle}
            disabled={loading || saving}
            placeholder="Ví dụ: Phiếu bán hàng / giao hàng"
            onChange={(event) => updateA4('subtitle', event.currentTarget.value)}
          />
        </label>

        <label className="receipt-settings-field receipt-settings-field--wide">
          <span>Dòng cuối A4</span>
          <input
            type="text"
            maxLength={180}
            value={draft.a4Invoice.footer}
            disabled={loading || saving}
            onChange={(event) => updateA4('footer', event.currentTarget.value)}
          />
        </label>
      </div>

      <fieldset className="receipt-settings-options" disabled={loading || saving}>
        <legend>Nội dung A4</legend>
        <label>
          <input
            type="checkbox"
            checked={draft.a4Invoice.showSku}
            onChange={(event) => updateA4('showSku', event.currentTarget.checked)}
          />
          <span>Hiện mã SKU</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.a4Invoice.showCreator}
            onChange={(event) => updateA4('showCreator', event.currentTarget.checked)}
          />
          <span>Hiện tên nhân viên</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.a4Invoice.showPaymentMethod}
            onChange={(event) => updateA4('showPaymentMethod', event.currentTarget.checked)}
          />
          <span>Hiện phương thức thanh toán</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.a4Invoice.showPaymentQr}
            onChange={(event) => updateA4('showPaymentQr', event.currentTarget.checked)}
          />
          <span>Hiện QR thanh toán</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.a4Invoice.showSignatures}
            onChange={(event) => updateA4('showSignatures', event.currentTarget.checked)}
          />
          <span>Hiện ô ký khách / người lập</span>
        </label>
      </fieldset>

      <DesktopPrinterSettings mode="a4" />

      <div className="receipt-settings-qr">
        <div className="receipt-settings-qr__heading">
          <div>
            <strong>QR trên phiếu A4</strong>
            <small>
              A4 dùng lại ảnh QR thanh toán đang lưu ở Cài đặt hóa đơn nhiệt; không lưu thêm một bản ảnh trùng trong Firebase.
            </small>
          </div>
        </div>
        <p className="muted">
          {draft.paymentQrImageDataUrl
            ? 'Đã có ảnh QR để dùng trên A4.'
            : 'Chưa có ảnh QR. Nếu cần, hãy thêm ảnh QR trong Cài đặt hóa đơn.'}
        </p>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="settings-success" role="status">{message}</p> : null}

      <div className="receipt-settings-actions">
        <button
          className="button receipt-settings-test"
          type="button"
          disabled={loading || printing}
          onClick={() => void handleTestPrint()}
        >
          {printing ? 'Đang mở A4…' : '🖨 In thử A4'}
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={loading || saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Đang lưu…' : 'Lưu thiết lập A4'}
        </button>
      </div>
    </section>
  );
}

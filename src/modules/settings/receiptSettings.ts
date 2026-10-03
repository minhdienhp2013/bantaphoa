import { onValue, ref, update, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import type { InvoicePaperSize, ReceiptPaperSize, ReceiptSettings, StoreSettings } from '../../types/models';

export interface ReceiptConfiguration {
  storeName: string;
  address: string;
  phone: string;
  defaultInvoicePaperSize: InvoicePaperSize;
  receipt: ReceiptSettings;
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  defaultPaperSize: '80mm',
  title: 'PHIẾU BÁN HÀNG',
  footer: 'Cảm ơn quý khách!',
  showSku: true,
  showCreator: true,
  showPaymentMethod: true,
};

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function normalizeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizePaperSize(value: unknown): ReceiptPaperSize {
  return value === '58mm' ? '58mm' : '80mm';
}

function normalizeInvoicePaperSize(value: unknown, fallback: InvoicePaperSize = '80mm'): InvoicePaperSize {
  if (value === 'A4' || value === '58mm' || value === '80mm') return value;
  return fallback;
}

function normalizePaymentQrImage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(normalized)) return undefined;
  if (normalized.length > 200_000) return undefined;
  return normalized;
}

export function resolveReceiptSettings(value: unknown): ReceiptSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ReceiptSettings>
    : {};

  return {
    defaultPaperSize: normalizePaperSize(raw.defaultPaperSize),
    title: normalizeText(raw.title, DEFAULT_RECEIPT_SETTINGS.title) || DEFAULT_RECEIPT_SETTINGS.title,
    footer: normalizeText(raw.footer, DEFAULT_RECEIPT_SETTINGS.footer) || DEFAULT_RECEIPT_SETTINGS.footer,
    showSku: typeof raw.showSku === 'boolean' ? raw.showSku : DEFAULT_RECEIPT_SETTINGS.showSku,
    showCreator: typeof raw.showCreator === 'boolean' ? raw.showCreator : DEFAULT_RECEIPT_SETTINGS.showCreator,
    showPaymentMethod: typeof raw.showPaymentMethod === 'boolean'
      ? raw.showPaymentMethod
      : DEFAULT_RECEIPT_SETTINGS.showPaymentMethod,
    ...(normalizePaymentQrImage(raw.paymentQrImageDataUrl)
      ? { paymentQrImageDataUrl: normalizePaymentQrImage(raw.paymentQrImageDataUrl) }
      : {}),
  };
}

export function resolveReceiptConfiguration(value: unknown): ReceiptConfiguration {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<StoreSettings>
    : {};

  return {
    storeName: normalizeText(raw.storeName),
    address: normalizeText(raw.address),
    phone: normalizeText(raw.phone),
    defaultInvoicePaperSize: normalizeInvoicePaperSize(
      raw.defaultInvoicePaperSize,
      raw.receipt?.defaultPaperSize === '58mm' ? '58mm' : '80mm',
    ),
    receipt: resolveReceiptSettings(raw.receipt),
  };
}

export function subscribeReceiptConfiguration(
  onData: (value: ReceiptConfiguration) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'settings'),
    (snapshot) => onData(resolveReceiptConfiguration(snapshot.exists() ? snapshot.val() : null)),
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải cài đặt hóa đơn.')),
  );
}

function validateText(value: string, label: string, maxLength: number, required = false): string {
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label} không được để trống.`);
  if (normalized.length > maxLength) throw new Error(`${label} tối đa ${maxLength} ký tự.`);
  return normalized;
}

export async function saveReceiptConfiguration(
  value: ReceiptConfiguration,
): Promise<ReceiptConfiguration> {
  const storeName = validateText(value.storeName, 'Tên cửa hàng', 120, true);
  const address = validateText(value.address, 'Địa chỉ', 220);
  const phone = validateText(value.phone, 'Số điện thoại', 40);
  const title = validateText(value.receipt.title, 'Tiêu đề hóa đơn', 80, true);
  const footer = validateText(value.receipt.footer, 'Dòng cuối hóa đơn', 160, true);
  const paymentQrImageDataUrl = normalizePaymentQrImage(value.receipt.paymentQrImageDataUrl);
  if (value.receipt.paymentQrImageDataUrl && !paymentQrImageDataUrl) {
    throw new Error('Ảnh QR thanh toán không hợp lệ hoặc quá lớn. Hãy chọn ảnh PNG/JPG/WebP nhỏ hơn.');
  }

  const receipt: ReceiptSettings = {
    defaultPaperSize: normalizePaperSize(value.receipt.defaultPaperSize),
    title,
    footer,
    showSku: Boolean(value.receipt.showSku),
    showCreator: Boolean(value.receipt.showCreator),
    showPaymentMethod: Boolean(value.receipt.showPaymentMethod),
    ...(paymentQrImageDataUrl ? { paymentQrImageDataUrl } : {}),
  };

  await update(ref(requireDatabase()), {
    'settings/storeName': storeName,
    'settings/address': address || null,
    'settings/phone': phone || null,
    'settings/currency': 'VND',
    'settings/receipt': receipt,
    'settings/defaultInvoicePaperSize': normalizeInvoicePaperSize(value.defaultInvoicePaperSize),
    'settings/updatedAt': Date.now(),
  });

  return {
    storeName,
    address,
    phone,
    defaultInvoicePaperSize: normalizeInvoicePaperSize(value.defaultInvoicePaperSize),
    receipt,
  };
}

import { onValue, ref, update, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import type { A4InvoiceSettings, InvoicePaperSize, StoreSettings } from '../../types/models';

export interface A4InvoiceConfiguration {
  storeName: string;
  address: string;
  phone: string;
  paymentQrImageDataUrl?: string;
  defaultInvoicePaperSize: InvoicePaperSize;
  a4Invoice: A4InvoiceSettings;
}

export const DEFAULT_A4_INVOICE_SETTINGS: A4InvoiceSettings = {
  title: 'PHIẾU BÁN HÀNG',
  subtitle: 'Khổ A4',
  footer: 'Cảm ơn quý khách!',
  showSku: true,
  showCreator: true,
  showPaymentMethod: true,
  showPaymentQr: true,
  showSignatures: true,
};

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function normalizeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeInvoicePaperSize(value: unknown, fallback: InvoicePaperSize = '80mm'): InvoicePaperSize {
  if (value === 'A4' || value === '58mm' || value === '80mm') return value;
  return fallback;
}

export function resolveA4InvoiceSettings(value: unknown): A4InvoiceSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<A4InvoiceSettings>
    : {};

  return {
    title: normalizeText(raw.title, DEFAULT_A4_INVOICE_SETTINGS.title) || DEFAULT_A4_INVOICE_SETTINGS.title,
    subtitle: normalizeText(raw.subtitle, DEFAULT_A4_INVOICE_SETTINGS.subtitle),
    footer: normalizeText(raw.footer, DEFAULT_A4_INVOICE_SETTINGS.footer) || DEFAULT_A4_INVOICE_SETTINGS.footer,
    showSku: typeof raw.showSku === 'boolean' ? raw.showSku : DEFAULT_A4_INVOICE_SETTINGS.showSku,
    showCreator: typeof raw.showCreator === 'boolean' ? raw.showCreator : DEFAULT_A4_INVOICE_SETTINGS.showCreator,
    showPaymentMethod: typeof raw.showPaymentMethod === 'boolean'
      ? raw.showPaymentMethod
      : DEFAULT_A4_INVOICE_SETTINGS.showPaymentMethod,
    showPaymentQr: typeof raw.showPaymentQr === 'boolean'
      ? raw.showPaymentQr
      : DEFAULT_A4_INVOICE_SETTINGS.showPaymentQr,
    showSignatures: typeof raw.showSignatures === 'boolean'
      ? raw.showSignatures
      : DEFAULT_A4_INVOICE_SETTINGS.showSignatures,
  };
}

export function resolveA4InvoiceConfiguration(value: unknown): A4InvoiceConfiguration {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<StoreSettings>
    : {};

  const paymentQrImageDataUrl = typeof raw.receipt?.paymentQrImageDataUrl === 'string'
    ? raw.receipt.paymentQrImageDataUrl
    : undefined;

  return {
    storeName: normalizeText(raw.storeName),
    address: normalizeText(raw.address),
    phone: normalizeText(raw.phone),
    ...(paymentQrImageDataUrl ? { paymentQrImageDataUrl } : {}),
    defaultInvoicePaperSize: normalizeInvoicePaperSize(
      raw.defaultInvoicePaperSize,
      raw.receipt?.defaultPaperSize === '58mm' ? '58mm' : '80mm',
    ),
    a4Invoice: resolveA4InvoiceSettings(raw.a4Invoice),
  };
}

export function subscribeA4InvoiceConfiguration(
  onData: (value: A4InvoiceConfiguration) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'settings'),
    (snapshot) => onData(resolveA4InvoiceConfiguration(snapshot.exists() ? snapshot.val() : null)),
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải cài đặt hóa đơn A4.')),
  );
}

function validateText(value: string, label: string, maxLength: number, required = false): string {
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${label} không được để trống.`);
  if (normalized.length > maxLength) throw new Error(`${label} tối đa ${maxLength} ký tự.`);
  return normalized;
}

export async function saveA4InvoiceConfiguration(
  value: A4InvoiceConfiguration,
): Promise<A4InvoiceConfiguration> {
  const storeName = validateText(value.storeName, 'Tên cửa hàng', 120, true);
  const address = validateText(value.address, 'Địa chỉ', 220);
  const phone = validateText(value.phone, 'Số điện thoại', 40);
  const a4Invoice: A4InvoiceSettings = {
    title: validateText(value.a4Invoice.title, 'Tiêu đề A4', 100, true),
    subtitle: validateText(value.a4Invoice.subtitle, 'Dòng phụ A4', 120),
    footer: validateText(value.a4Invoice.footer, 'Dòng cuối A4', 180, true),
    showSku: Boolean(value.a4Invoice.showSku),
    showCreator: Boolean(value.a4Invoice.showCreator),
    showPaymentMethod: Boolean(value.a4Invoice.showPaymentMethod),
    showPaymentQr: Boolean(value.a4Invoice.showPaymentQr),
    showSignatures: Boolean(value.a4Invoice.showSignatures),
  };

  await update(ref(requireDatabase()), {
    'settings/storeName': storeName,
    'settings/address': address || null,
    'settings/phone': phone || null,
    'settings/currency': 'VND',
    'settings/a4Invoice': a4Invoice,
    'settings/defaultInvoicePaperSize': normalizeInvoicePaperSize(value.defaultInvoicePaperSize),
    'settings/updatedAt': Date.now(),
  });

  return {
    storeName,
    address,
    phone,
    ...(value.paymentQrImageDataUrl ? { paymentQrImageDataUrl: value.paymentQrImageDataUrl } : {}),
    defaultInvoicePaperSize: normalizeInvoicePaperSize(value.defaultInvoicePaperSize),
    a4Invoice,
  };
}

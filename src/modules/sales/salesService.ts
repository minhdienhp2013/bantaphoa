import {
  endAt,
  get,
  limitToLast,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  startAt,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { db } from '../../firebase/client';
import type {
  AppUser,
  AuditLog,
  Customer,
  PaymentMethod,
  Product,
  ProductSale,
  QuickServiceCategory,
  QuickServiceSale,
  Sale,
  SaleItem,
  StockMovementType,
  StockOperationReceipt,
} from '../../types/models';
import { commitStockOperation } from '../inventory/inventoryService';
import { buildStockOperationId, roundStockQuantity } from '../inventory/stockOperationCas';
import { readQuickServiceProfitRate } from '../settings/quickServiceSettings';
import {
  normalizeQuickServiceOptionalText,
  quickServiceSaleMatchesIntent,
} from './quickServiceIntent';
import { normalizeSale } from './saleNormalizer';

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 200;

export interface SaleLineInput {
  productId: string;
  quantity: number;
}

export interface CreateSaleInput {
  saleId: string;
  customerId?: string;
  items: SaleLineInput[];
  discount: number;
  paymentMethod: PaymentMethod;
  note?: string;
}

export interface CreateQuickServiceSaleInput {
  saleId: string;
  serviceCategory: QuickServiceCategory;
  amount: number;
  paymentMethod: 'cash' | 'bank_transfer';
  customerId?: string;
  note?: string;
}

export interface SaleHistoryQuery {
  from?: number;
  to?: number;
  limit?: number;
}

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function makeSaleCode(key: string, createdAt: number) {
  const date = new Date(createdAt);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `BH-${y}${m}${d}-${key.slice(-6).toUpperCase()}`;
}

function normalizeMoney(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} không hợp lệ.`);
  return Math.round(number);
}

function normalizeQuickAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Số tiền dịch vụ phải là số nguyên VND lớn hơn 0.');
  }
  return amount;
}

function normalizeQuantity(value: unknown) {
  const quantity = roundStockQuantity(Number(value));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Số lượng bán phải lớn hơn 0.');
  }
  return quantity;
}

async function readProduct(productId: string): Promise<Product> {
  const snapshot = await get(ref(requireDatabase(), `products/${productId}`));
  if (!snapshot.exists()) throw new Error(`Không tìm thấy sản phẩm ${productId}.`);
  const product = snapshot.val() as Product;
  const normalized: Product = {
    ...product,
    id: product.id || productId,
    stockQuantity: Number(product.stockQuantity) || 0,
    stockVersion: Number(product.stockVersion) || 0,
    costPrice: normalizeMoney(product.costPrice, `Giá vốn của ${product.sku || productId}`),
    salePrice: normalizeMoney(product.salePrice, `Giá bán của ${product.sku || productId}`),
  };
  if (!normalized.sku || !normalized.name) throw new Error(`Sản phẩm ${productId} thiếu SKU hoặc tên.`);
  if (normalized.active !== true) throw new Error(`${normalized.sku} - ${normalized.name} đã ngừng hoạt động.`);
  return normalized;
}

async function readCustomer(customerId?: string): Promise<Customer | null> {
  const id = normalizeQuickServiceOptionalText(customerId);
  if (!id) return null;
  const snapshot = await get(ref(requireDatabase(), `customers/${id}`));
  if (!snapshot.exists()) throw new Error('Khách hàng đã chọn không còn tồn tại.');
  const customer = snapshot.val() as Customer;
  if (!customer.name || customer.active !== true) throw new Error('Khách hàng đã chọn hiện không hoạt động.');
  return { ...customer, id: customer.id || id };
}

async function readProductSaleOrNull(saleId: string): Promise<ProductSale | null> {
  const snapshot = await get(ref(requireDatabase(), `sales/${saleId}`));
  if (!snapshot.exists()) return null;
  const sale = normalizeSale(saleId, snapshot.val());
  if (!sale || sale.saleKind !== 'product') {
    throw new Error('Đơn bán đã tồn tại nhưng dữ liệu không hợp lệ.');
  }
  return sale;
}

async function getPersistedProductSale(saleId: string): Promise<ProductSale> {
  const sale = await readProductSaleOrNull(saleId);
  if (!sale) throw new Error('Nghiệp vụ kho đã hoàn tất nhưng không đọc được đơn bán đã lưu.');
  return sale;
}

async function readQuickServiceSaleOrNull(saleId: string): Promise<QuickServiceSale | null> {
  const snapshot = await get(ref(requireDatabase(), `quickServiceSales/${saleId}`));
  if (!snapshot.exists()) return null;
  const sale = normalizeSale(saleId, snapshot.val());
  if (!sale || sale.saleKind !== 'quick_service') {
    throw new Error('Giao dịch bán nhanh đã tồn tại nhưng dữ liệu không hợp lệ.');
  }
  return sale;
}

function assertReceiptMatches(
  receipt: StockOperationReceipt,
  type: StockMovementType,
  referenceId: string,
) {
  const expectedId = buildStockOperationId(type, referenceId);
  if (
    receipt.id !== expectedId ||
    receipt.type !== type ||
    receipt.referenceType !== 'sale' ||
    receipt.referenceId !== referenceId
  ) {
    throw new Error('Phát hiện stockOperations receipt không khớp với đơn bán.');
  }
}

async function readReceipt(type: StockMovementType, saleId: string): Promise<StockOperationReceipt | null> {
  const operationId = buildStockOperationId(type, saleId);
  const snapshot = await get(ref(requireDatabase(), `stockOperations/${operationId}`));
  if (!snapshot.exists()) return null;
  const receipt = snapshot.val() as StockOperationReceipt;
  assertReceiptMatches(receipt, type, saleId);
  return receipt;
}

async function readCommittedCreateRetry(saleId: string): Promise<ProductSale | null> {
  const [sale, receipt] = await Promise.all([readProductSaleOrNull(saleId), readReceipt('SALE', saleId)]);
  if (!sale && !receipt) return null;
  if (sale && receipt) return sale;
  throw new Error('Phát hiện đơn bán/stockOperations receipt không đồng bộ. Dừng retry để tránh thay đổi tồn kho sai.');
}

function buildHistoryQuery(path: string, options: SaleHistoryQuery, limit: number) {
  const base = ref(requireDatabase(), path);
  const ordered = orderByChild('createdAt');
  if (typeof options.from === 'number' && typeof options.to === 'number') {
    return query(base, ordered, startAt(options.from), endAt(options.to), limitToLast(limit));
  }
  if (typeof options.from === 'number') return query(base, ordered, startAt(options.from), limitToLast(limit));
  if (typeof options.to === 'number') return query(base, ordered, endAt(options.to), limitToLast(limit));
  return query(base, ordered, limitToLast(limit));
}

function normalizeHistoryNode(value: unknown, expectedKind: Sale['saleKind']): Sale[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([id, raw]) => {
    const sale = normalizeSale(id, raw);
    return sale?.saleKind === expectedKind ? [sale] : [];
  });
}

export function createSaleId() {
  const saleId = push(ref(requireDatabase(), 'sales')).key;
  if (!saleId) throw new Error('Không thể tạo mã giao dịch.');
  return saleId;
}

export async function createSale(input: CreateSaleInput, actorUid: string): Promise<ProductSale> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (!input.saleId) throw new Error('Thiếu mã đơn bán.');

  const committedRetry = await readCommittedCreateRetry(input.saleId);
  if (committedRetry) return committedRetry;

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Giỏ hàng phải có ít nhất một sản phẩm.');
  }
  if (!input.paymentMethod) throw new Error('Vui lòng chọn phương thức thanh toán.');

  const seen = new Set<string>();
  const normalizedLines = input.items.map((line) => {
    if (!line.productId) throw new Error('Dòng bán hàng thiếu sản phẩm.');
    if (seen.has(line.productId)) throw new Error('Một sản phẩm chỉ được xuất hiện một lần trong giỏ hàng.');
    seen.add(line.productId);
    return { productId: line.productId, quantity: normalizeQuantity(line.quantity) };
  });

  const [products, customer] = await Promise.all([
    Promise.all(normalizedLines.map((line) => readProduct(line.productId))),
    readCustomer(input.customerId),
  ]);

  const createdAt = Date.now();
  const items: SaleItem[] = normalizedLines.map((line, index) => {
    const product = products[index];
    const unitPrice = Math.round(product.salePrice);
    const costPrice = Math.round(product.costPrice);
    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      quantity: line.quantity,
      unitPrice,
      costPrice,
      lineTotal: Math.round(line.quantity * unitPrice),
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const discount = normalizeMoney(input.discount, 'Giảm giá');
  if (discount > subtotal) throw new Error('Giảm giá không được lớn hơn tổng tiền hàng.');
  const total = subtotal - discount;
  const costTotal = items.reduce((sum, item) => sum + Math.round(item.quantity * item.costPrice), 0);

  const sale: ProductSale = {
    id: input.saleId,
    code: makeSaleCode(input.saleId, createdAt),
    saleKind: 'product',
    items,
    subtotal,
    discount,
    total,
    costTotal,
    profit: total - costTotal,
    paymentMethod: input.paymentMethod,
    status: 'completed',
    createdBy: actorUid,
    createdAt,
    updatedAt: createdAt,
    ...(customer ? { customerId: customer.id, customerName: customer.name } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };

  await commitStockOperation({
    type: 'SALE',
    referenceType: 'sale',
    referenceId: input.saleId,
    actorUid,
    changes: items.map((item) => ({
      productId: item.productId,
      quantityDelta: -Math.abs(item.quantity),
      unitCost: item.costPrice,
      note: `Bán hàng ${sale.code}`,
    })),
    extraUpdates: { [`sales/${input.saleId}`]: sale },
    audit: {
      action: 'SALE_COMPLETED',
      entityType: 'sale',
      entityId: input.saleId,
      summary: `Hoàn tất đơn ${sale.code}, ${items.length} mặt hàng`,
    },
  });

  return getPersistedProductSale(input.saleId);
}

export async function reverseSale(
  saleId: string,
  actorUid: string,
  nextStatus: 'cancelled' | 'refunded',
): Promise<ProductSale> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (!saleId) throw new Error('Thiếu mã đơn bán.');

  const [sale, existingReturnReceipt] = await Promise.all([
    getPersistedProductSale(saleId),
    readReceipt('SALE_RETURN', saleId),
  ]);

  if (existingReturnReceipt) {
    if (sale.status === 'completed') {
      throw new Error('Đơn vẫn ở trạng thái hoàn tất nhưng receipt hoàn kho đã tồn tại. Cần kiểm tra dữ liệu trước khi thao tác tiếp.');
    }
    return sale;
  }
  if (sale.status !== 'completed') {
    throw new Error('Đơn đã đóng nhưng chưa có receipt hoàn kho. Cần kiểm tra dữ liệu trước khi thao tác tiếp.');
  }

  const linkedDebtSnapshot = await get(ref(requireDatabase(), `debts/sale_${saleId}`));
  if (linkedDebtSnapshot.exists() && linkedDebtSnapshot.child('status').val() !== 'cancelled') {
    throw new Error('Đơn bán đang có công nợ. Hãy hoàn tác các lần thu tiền (nếu có) và hủy công nợ trước khi hủy/hoàn đơn.');
  }

  if (sale.items.length === 0) throw new Error('Đơn bán không có dữ liệu mặt hàng để hoàn kho.');

  const updatedAt = Date.now();
  await commitStockOperation({
    type: 'SALE_RETURN',
    referenceType: 'sale',
    referenceId: saleId,
    actorUid,
    changes: sale.items.map((item) => ({
      productId: item.productId,
      quantityDelta: Math.abs(normalizeQuantity(item.quantity)),
      unitCost: normalizeMoney(item.costPrice, 'Giá vốn snapshot'),
      note: `${nextStatus === 'cancelled' ? 'Hủy' : 'Hoàn'} đơn ${sale.code}`,
    })),
    extraUpdates: {
      [`sales/${saleId}/saleKind`]: 'product',
      [`sales/${saleId}/status`]: nextStatus,
      [`sales/${saleId}/updatedAt`]: updatedAt,
    },
    audit: {
      action: nextStatus === 'cancelled' ? 'SALE_CANCELLED' : 'SALE_REFUNDED',
      entityType: 'sale',
      entityId: saleId,
      summary: `${nextStatus === 'cancelled' ? 'Hủy' : 'Hoàn'} đơn ${sale.code} và hoàn tồn kho`,
    },
  });

  return getPersistedProductSale(saleId);
}

export async function createQuickServiceSale(
  input: CreateQuickServiceSaleInput,
  actorUid: string,
): Promise<QuickServiceSale> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (!input.saleId) throw new Error('Thiếu mã giao dịch.');

  const amount = normalizeQuickAmount(input.amount);
  const customerId = normalizeQuickServiceOptionalText(input.customerId);
  const note = normalizeQuickServiceOptionalText(input.note);
  const intent = {
    serviceCategory: input.serviceCategory,
    amount,
    paymentMethod: input.paymentMethod,
    ...(customerId ? { customerId } : {}),
    ...(note ? { note } : {}),
  };

  const existing = await readQuickServiceSaleOrNull(input.saleId);
  if (existing) {
    if (quickServiceSaleMatchesIntent(existing, intent, actorUid)) return existing;
    throw new Error('Mã giao dịch bán nhanh đã được dùng cho một nội dung khác.');
  }

  const [rate, customer] = await Promise.all([
    readQuickServiceProfitRate(input.serviceCategory),
    readCustomer(customerId),
  ]);
  const createdAt = Date.now();
  const sale: QuickServiceSale = {
    id: input.saleId,
    code: makeSaleCode(input.saleId, createdAt),
    saleKind: 'quick_service',
    serviceCategory: input.serviceCategory,
    estimatedProfitRatePercent: rate,
    subtotal: amount,
    discount: 0,
    total: amount,
    paymentMethod: input.paymentMethod,
    status: 'completed',
    createdBy: actorUid,
    createdAt,
    updatedAt: createdAt,
    ...(customer ? { customerId: customer.id, customerName: customer.name } : {}),
    ...(note ? { note } : {}),
  };

  const auditId = push(ref(requireDatabase(), 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký kiểm toán.');
  const audit: AuditLog = {
    id: auditId,
    actorUid,
    action: 'QUICK_SERVICE_SALE_COMPLETED',
    entityType: 'quick_service_sale',
    entityId: input.saleId,
    summary: `Hoàn tất bán nhanh ${sale.code}`,
    createdAt,
  };

  try {
    await update(ref(requireDatabase()), {
      [`quickServiceSales/${input.saleId}`]: sale,
      [`auditLogs/${auditId}`]: audit,
    });
  } catch (error) {
    const committed = await readQuickServiceSaleOrNull(input.saleId).catch(() => null);
    if (committed && quickServiceSaleMatchesIntent(committed, intent, actorUid)) return committed;
    throw error;
  }

  return sale;
}

export async function cancelQuickServiceSale(
  saleId: string,
  actor: Pick<AppUser, 'uid' | 'role'>,
): Promise<QuickServiceSale> {
  if (!actor.uid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (actor.role !== 'owner' && actor.role !== 'staff') throw new Error('Vai trò người dùng không hợp lệ.');
  if (!saleId) throw new Error('Thiếu mã giao dịch.');

  const sale = await readQuickServiceSaleOrNull(saleId);
  if (!sale) throw new Error('Không tìm thấy giao dịch bán nhanh.');
  if (sale.status === 'cancelled') return sale;
  if (sale.status !== 'completed') throw new Error('Giao dịch bán nhanh không thể hủy ở trạng thái hiện tại.');
  if (actor.role !== 'owner' && sale.createdBy !== actor.uid) {
    throw new Error('Nhân viên chỉ được hủy giao dịch bán nhanh do chính mình tạo.');
  }

  const updatedAt = Date.now();
  const auditId = push(ref(requireDatabase(), 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký kiểm toán.');
  const audit: AuditLog = {
    id: auditId,
    actorUid: actor.uid,
    action: 'QUICK_SERVICE_SALE_CANCELLED',
    entityType: 'quick_service_sale',
    entityId: saleId,
    summary: `Hủy giao dịch bán nhanh ${sale.code}`,
    createdAt: updatedAt,
  };

  try {
    await update(ref(requireDatabase()), {
      [`quickServiceSales/${saleId}/status`]: 'cancelled',
      [`quickServiceSales/${saleId}/updatedAt`]: updatedAt,
      [`auditLogs/${auditId}`]: audit,
    });
  } catch (error) {
    const committed = await readQuickServiceSaleOrNull(saleId).catch(() => null);
    if (committed?.status === 'cancelled') return committed;
    throw error;
  }

  return { ...sale, status: 'cancelled', updatedAt };
}

export function subscribeSales(
  options: SaleHistoryQuery,
  onData: (sales: Sale[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const limit = Math.min(MAX_HISTORY_LIMIT, Math.max(20, Math.round(options.limit ?? DEFAULT_HISTORY_LIMIT)));
  let productSales: Sale[] = [];
  let quickServiceSales: Sale[] = [];

  const emit = () => {
    onData(
      [...productSales, ...quickServiceSales]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit),
    );
  };

  const unsubscribeProducts = onValue(
    buildHistoryQuery('sales', options, limit),
    (snapshot) => {
      productSales = normalizeHistoryNode(snapshot.val(), 'product');
      emit();
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải lịch sử đơn bán.')),
  );

  const unsubscribeQuick = onValue(
    buildHistoryQuery('quickServiceSales', options, limit),
    (snapshot) => {
      quickServiceSales = normalizeHistoryNode(snapshot.val(), 'quick_service');
      emit();
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải lịch sử bán nhanh.')),
  );

  return () => {
    unsubscribeProducts();
    unsubscribeQuick();
  };
}

export function subscribeCustomers(
  onData: (customers: Customer[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'customers'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, Customer> | null;
      const customers = raw
        ? Object.entries(raw)
            .map(([id, customer]) => ({ ...customer, id: customer.id || id }))
            .filter((customer) => customer.active === true && Boolean(customer.name))
            .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
        : [];
      onData(customers);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải danh sách khách hàng.')),
  );
}

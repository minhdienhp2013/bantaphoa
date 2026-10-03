export type UserRole = 'owner' | 'staff';

export type AppModulePermission =
  | 'dashboard'
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'sales'
  | 'purchases'
  | 'debts'
  | 'inventory'
  | 'stockouts'
  | 'stocktakes'
  | 'expenses'
  | 'qrPrinting'
  | 'reports';

export type AppModulePermissions = Partial<Record<AppModulePermission, boolean>>;

export interface AppUser {
  uid: string;
  displayName: string;
  email?: string;
  role: UserRole;
  active: boolean;
  permissions?: AppModulePermissions;
  createdAt: number;
  updatedAt: number;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  aliases?: string[];
  barcode?: string;
  qrCode?: string;
  categoryId?: string;
  unit?: string;
  costPrice: number;
  salePrice: number;
  stockQuantity: number;
  stockVersion?: number;
  lastStockOperationId?: string;
  minStock?: number;
  imageKey?: string;
  imageUpdatedAt?: number;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  taxCode?: string;
  note?: string;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SaleItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  costPrice: number;
  lineTotal: number;
}

export type PaymentMethod = 'cash' | 'bank_transfer' | 'other';
export type SaleKind = 'product' | 'quick_service';
export type QuickServiceCategory =
  | 'photo'
  | 'printing'
  | 'scan'
  | 'computer'
  | 'stationery'
  | 'other';

export interface SaleBase {
  id: string;
  code: string;
  customerId?: string;
  customerName?: string;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod?: PaymentMethod;
  note?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProductSale extends SaleBase {
  saleKind: 'product';
  items: SaleItem[];
  costTotal: number;
  profit: number;
  status: 'completed' | 'cancelled' | 'refunded';
}

export interface QuickServiceSale extends SaleBase {
  saleKind: 'quick_service';
  serviceCategory: QuickServiceCategory;
  estimatedProfitRatePercent: number;
  paymentMethod: 'cash' | 'bank_transfer';
  discount: 0;
  status: 'completed' | 'cancelled';
}

export type Sale = ProductSale | QuickServiceSale;

export interface PurchaseItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface Purchase {
  id: string;
  code: string;
  supplierId?: string;
  supplierName?: string;
  items: PurchaseItem[];
  total: number;
  note?: string;
  status: 'completed' | 'cancelled';
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type DebtKind = 'receivable' | 'payable';
export type DebtStatus = 'open' | 'settled' | 'cancelled';
export type DebtPaymentEventType = 'payment' | 'reversal';

export interface ReceivableDebt {
  id: string;
  code: string;
  kind: 'receivable';
  customerId: string;
  customerName: string;
  sourceType: 'sale' | 'opening';
  sourceId?: string;
  originalAmount: number;
  paidAmount: number;
  dueDate?: number;
  note?: string;
  status: DebtStatus;
  paymentVersion: number;
  lastPaymentEventId?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface PayableDebt {
  id: string;
  code: string;
  kind: 'payable';
  supplierId: string;
  supplierName: string;
  sourceType: 'purchase' | 'opening';
  sourceId?: string;
  originalAmount: number;
  paidAmount: number;
  dueDate?: number;
  note?: string;
  status: DebtStatus;
  paymentVersion: number;
  lastPaymentEventId?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type Debt = ReceivableDebt | PayableDebt;

export interface DebtPaymentEvent {
  id: string;
  debtId: string;
  debtKind: DebtKind;
  eventType: DebtPaymentEventType;
  amount: number;
  paymentMethod: PaymentMethod;
  originalPaymentId?: string;
  note?: string;
  createdBy: string;
  createdAt: number;
}

export interface LoanInstallment {
  id: string;
  sequence: number;
  dueDate: number;
  principalDue: number;
  interestDue: number;
}

export type LoanStatus = 'active' | 'settled' | 'cancelled';

export interface Loan {
  id: string;
  code: string;
  lenderName: string;
  principalAmount: number;
  annualInterestRatePercent: number;
  termMonths: number;
  startDate: number;
  firstDueDate: number;
  plannedInterestTotal: number;
  principalPaid: number;
  interestPaid: number;
  installments: Record<string, LoanInstallment>;
  status: LoanStatus;
  paymentVersion: number;
  lastPaymentEventId?: string;
  note?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface LoanPaymentEvent {
  id: string;
  loanId: string;
  eventType: DebtPaymentEventType;
  principalAmount: number;
  interestAmount: number;
  paymentMethod: PaymentMethod;
  originalPaymentId?: string;
  note?: string;
  createdBy: string;
  createdAt: number;
}

export type StockOutReason = 'internal_use' | 'damage' | 'gift' | 'other';

export interface StockOutItem {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  costPrice: number;
}

export interface StockOut {
  id: string;
  code: string;
  reason: StockOutReason;
  items: StockOutItem[];
  note?: string;
  status: 'completed' | 'cancelled';
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type StockMovementType =
  | 'OPENING_BALANCE'
  | 'PURCHASE'
  | 'PURCHASE_RETURN'
  | 'SALE'
  | 'SALE_RETURN'
  | 'STOCK_OUT'
  | 'STOCK_OUT_REVERSAL'
  | 'STOCKTAKE_ADJUSTMENT'
  | 'MANUAL_ADJUSTMENT';

export type StockReferenceType =
  | 'opening'
  | 'sale'
  | 'purchase'
  | 'stockout'
  | 'stocktake'
  | 'manual';

export interface StockMovement {
  id: string;
  productId: string;
  type: StockMovementType;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  unitCost?: number;
  referenceType?: StockReferenceType;
  referenceId?: string;
  note?: string;
  createdBy: string;
  createdAt: number;
}

export interface StockOperationReceipt {
  id: string;
  type: StockMovementType;
  referenceType: StockReferenceType;
  referenceId: string;
  actorUid: string;
  createdAt: number;
}

export interface StocktakeItem {
  productId: string;
  systemQuantity: number;
  actualQuantity: number;
  difference: number;
}

export interface Stocktake {
  id: string;
  code: string;
  status: 'draft' | 'completed' | 'cancelled';
  items: StocktakeItem[];
  note?: string;
  createdBy: string;
  createdAt: number;
  completedAt?: number;
}

export interface Expense {
  id: string;
  code: string;
  category: string;
  amount: number;
  expenseDate: number;
  note?: string;
  status: 'completed' | 'cancelled';
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface LabelTemplateSettings {
  id: string;
  name: string;
  columns: 1 | 2;
  labelWidthMm: number;
  labelHeightMm: number;
  gapMm?: number;
  pageMarginMm?: number;
}

export type QuickServiceProfitRatesPercent = Partial<Record<QuickServiceCategory, number>>;

export type ReceiptPaperSize = '58mm' | '80mm';
export type InvoicePaperSize = ReceiptPaperSize | 'A4';

export interface ReceiptSettings {
  defaultPaperSize: ReceiptPaperSize;
  title: string;
  footer: string;
  showSku: boolean;
  showCreator: boolean;
  showPaymentMethod: boolean;
  paymentQrImageDataUrl?: string;
}

export interface A4InvoiceSettings {
  title: string;
  subtitle: string;
  footer: string;
  showSku: boolean;
  showCreator: boolean;
  showPaymentMethod: boolean;
  showPaymentQr: boolean;
  showSignatures: boolean;
}

export interface StoreSettings {
  storeName: string;
  address?: string;
  phone?: string;
  currency: 'VND';
  defaultLabelTemplateId?: string;
  labelTemplates?: Record<string, LabelTemplateSettings>;
  quickServiceProfitRatesPercent?: QuickServiceProfitRatesPercent;
  receipt?: ReceiptSettings;
  a4Invoice?: A4InvoiceSettings;
  defaultInvoicePaperSize?: InvoicePaperSize;
  updatedAt: number;
}

export interface BackupEnvelope {
  schemaVersion: 3;
  exportedAt: number;
  data: {
    products?: Record<string, Product>;
    categories?: Record<string, Category>;
    customers?: Record<string, Customer>;
    suppliers?: Record<string, Supplier>;
    sales?: Record<string, ProductSale>;
    quickServiceSales?: Record<string, QuickServiceSale>;
    purchases?: Record<string, Purchase>;
    debts?: Record<string, Debt>;
    debtPayments?: Record<string, DebtPaymentEvent>;
    loans?: Record<string, Loan>;
    loanPayments?: Record<string, LoanPaymentEvent>;
    stockOuts?: Record<string, StockOut>;
    stockMovements?: Record<string, StockMovement>;
    stockOperations?: Record<string, StockOperationReceipt>;
    stocktakes?: Record<string, Stocktake>;
    expenses?: Record<string, Expense>;
    salesAiLearning?: Record<string, Record<string, unknown>>;
    salesAiLearningComponents?: Record<string, Record<string, unknown>>;
    salesAiLearningEvents?: Record<string, Record<string, unknown>>;
    settings?: StoreSettings;
  };
}

export interface AuditLog {
  id: string;
  actorUid: string;
  action: string;
  entityType: string;
  entityId?: string;
  summary?: string;
  createdAt: number;
}

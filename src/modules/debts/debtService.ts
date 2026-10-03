import {
  equalTo,
  get,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { db } from '../../firebase/client';
import type {
  AppUser,
  AuditLog,
  Customer,
  Debt,
  DebtKind,
  DebtPaymentEvent,
  Loan,
  LoanPaymentEvent,
  PayableDebt,
  PaymentMethod,
  ProductSale,
  Purchase,
  ReceivableDebt,
  Supplier,
} from '../../types/models';
import { buildLoanSchedule, getLoanPlannedInterest } from './debtMetrics';

const MAX_PAYMENT_RETRIES = 5;

type DebtFinanceActor = Pick<AppUser, 'uid' | 'role' | 'permissions'>;

export interface CreateOpeningDebtInput {
  kind: DebtKind;
  partyId: string;
  amount: number;
  dueDate?: number;
  note?: string;
}

export interface CreateLinkedDebtInput {
  sourceId: string;
  dueDate?: number;
  note?: string;
}

export interface CreateDebtPaymentInput {
  debtId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  note?: string;
}

export interface CreateLoanInput {
  lenderName: string;
  principalAmount: number;
  annualInterestRatePercent: number;
  termMonths: number;
  startDate: number;
  firstDueDate: number;
  note?: string;
}

export interface CreateLoanPaymentInput {
  loanId: string;
  principalAmount: number;
  interestAmount: number;
  paymentMethod: PaymentMethod;
  note?: string;
}

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function canManageDebtFinance(actor: DebtFinanceActor) {
  return actor.role === 'owner' || actor.permissions?.debts === true;
}

function requireDebtFinancePermission(actor: DebtFinanceActor) {
  if (!canManageDebtFinance(actor)) {
    throw new Error('Tài khoản cần được cấp quyền Công nợ để thực hiện thao tác này.');
  }
}

function money(value: unknown, label: string) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error(`${label} phải là số nguyên VND không âm.`);
  return amount;
}

function positiveMoney(value: unknown, label: string) {
  const amount = money(value, label);
  if (amount <= 0) throw new Error(`${label} phải lớn hơn 0.`);
  return amount;
}

function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}

function dateValue(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} không hợp lệ.`);
  return Math.round(parsed);
}

function linkedDebtId(kind: DebtKind, sourceId: string) {
  return `${kind === 'receivable' ? 'sale' : 'purchase'}_${sourceId}`;
}

function makeCode(prefix: string, key: string, at = Date.now()) {
  const date = new Date(at);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${key.slice(-6).toUpperCase()}`;
}

function buildAudit(
  id: string,
  actorUid: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string,
  createdAt: number,
): AuditLog {
  return { id, actorUid, action, entityType, entityId, summary, createdAt };
}

function isPermissionDenied(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code ?? '');
  const message = String((error as { message?: unknown }).message ?? '');
  return /permission.?denied/i.test(code) || /permission.?denied/i.test(message);
}

async function readDebt(debtId: string): Promise<Debt> {
  const snapshot = await get(ref(requireDatabase(), `debts/${debtId}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy khoản công nợ.');
  const value = snapshot.val() as Debt;
  const debt = { ...value, id: value.id || debtId } as Debt;
  if (
    !debt.code
    || (debt.kind !== 'receivable' && debt.kind !== 'payable')
    || !Number.isSafeInteger(Number(debt.originalAmount))
    || !Number.isSafeInteger(Number(debt.paidAmount))
    || !Number.isSafeInteger(Number(debt.paymentVersion ?? 0))
  ) {
    throw new Error('Dữ liệu công nợ không hợp lệ.');
  }
  return debt;
}

async function readLoan(loanId: string): Promise<Loan> {
  const snapshot = await get(ref(requireDatabase(), `loans/${loanId}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy khoản vay.');
  const value = snapshot.val() as Loan;
  const loan = { ...value, id: value.id || loanId };
  if (
    !loan.code
    || !Number.isSafeInteger(Number(loan.principalAmount))
    || !Number.isSafeInteger(Number(loan.principalPaid))
    || !Number.isSafeInteger(Number(loan.interestPaid))
    || !Number.isSafeInteger(Number(loan.paymentVersion ?? 0))
  ) {
    throw new Error('Dữ liệu khoản vay không hợp lệ.');
  }
  return loan;
}

async function ensureDebtMissing(debtId: string) {
  const snapshot = await get(ref(requireDatabase(), `debts/${debtId}`));
  if (snapshot.exists()) throw new Error('Giao dịch này đã có hồ sơ công nợ.');
}

function validateDebtAmounts(debt: Debt) {
  const original = positiveMoney(debt.originalAmount, 'Giá trị công nợ');
  const paid = money(debt.paidAmount, 'Đã thanh toán');
  if (paid > original) throw new Error('Dữ liệu công nợ có số đã thanh toán vượt giá trị gốc.');
  return { original, paid, remaining: original - paid };
}

export function getDebtRemaining(debt: Pick<Debt, 'originalAmount' | 'paidAmount'>) {
  return Math.max(0, money(debt.originalAmount, 'Giá trị công nợ') - money(debt.paidAmount, 'Đã thanh toán'));
}

export function subscribeDebts(
  onData: (debts: Debt[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'debts'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, Debt> | null;
      const debts = raw
        ? Object.entries(raw)
            .map(([id, item]) => ({ ...item, id: item.id || id } as Debt))
            .sort((a, b) => b.createdAt - a.createdAt)
        : [];
      onData(debts);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải công nợ.')),
  );
}

export function subscribeDebtPayments(
  onData: (payments: DebtPaymentEvent[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'debtPayments'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, DebtPaymentEvent> | null;
      onData(
        raw
          ? Object.entries(raw)
              .map(([id, item]) => ({ ...item, id: item.id || id }))
              .sort((a, b) => b.createdAt - a.createdAt)
          : [],
      );
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải lịch sử thanh toán công nợ.')),
  );
}

export function subscribeDebtCustomers(
  onData: (customers: Customer[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'customers'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, Customer> | null;
      onData(raw
        ? Object.entries(raw)
            .map(([id, item]) => ({ ...item, id: item.id || id }))
            .filter((item) => item.active === true)
            .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
        : []);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải khách hàng.')),
  );
}

export function subscribeDebtSuppliers(
  onData: (suppliers: Supplier[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'suppliers'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, Supplier> | null;
      onData(raw
        ? Object.entries(raw)
            .map(([id, item]) => ({ ...item, id: item.id || id }))
            .filter((item) => item.active === true)
            .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
        : []);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải nhà cung cấp.')),
  );
}

export function subscribeDebtSales(
  onData: (sales: ProductSale[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'sales'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, ProductSale> | null;
      onData(raw
        ? Object.entries(raw)
            .map(([id, item]) => ({ ...item, id: item.id || id }))
            .filter((item) => item.saleKind === 'product' && item.status === 'completed' && Boolean(item.customerId))
            .sort((a, b) => b.createdAt - a.createdAt)
        : []);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải đơn bán để đối chiếu công nợ.')),
  );
}

export function subscribeDebtPurchases(
  onData: (purchases: Purchase[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'purchases'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, Purchase> | null;
      onData(raw
        ? Object.entries(raw)
            .map(([id, item]) => ({ ...item, id: item.id || id }))
            .filter((item) => item.status === 'completed' && Boolean(item.supplierId))
            .sort((a, b) => b.createdAt - a.createdAt)
        : []);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải phiếu nhập để đối chiếu công nợ.')),
  );
}

export async function createReceivableFromSale(
  input: CreateLinkedDebtInput,
  actorUid: string,
): Promise<ReceivableDebt> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  const database = requireDatabase();
  const saleId = input.sourceId.trim();
  if (!saleId) throw new Error('Vui lòng chọn đơn bán.');

  const snapshot = await get(ref(database, `sales/${saleId}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy đơn bán.');
  const sale = snapshot.val() as ProductSale;
  if (sale.saleKind !== 'product' || sale.status !== 'completed') {
    throw new Error('Chỉ tạo phải thu từ đơn bán hàng hóa đang hoàn tất.');
  }
  if (!sale.customerId || !sale.customerName) {
    throw new Error('Đơn bán phải có khách hàng trước khi tạo công nợ.');
  }

  const originalAmount = positiveMoney(sale.total, 'Tổng đơn bán');
  const id = linkedDebtId('receivable', saleId);
  await ensureDebtMissing(id);
  const now = Date.now();
  const debt: ReceivableDebt = {
    id,
    code: `PT-${sale.code}`,
    kind: 'receivable',
    customerId: sale.customerId,
    customerName: sale.customerName,
    sourceType: 'sale',
    sourceId: saleId,
    originalAmount,
    paidAmount: 0,
    status: 'open',
    paymentVersion: 0,
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
    ...(input.dueDate ? { dueDate: dateValue(input.dueDate, 'Hạn thanh toán') } : {}),
    ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
  };

  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký công nợ.');
  await update(ref(database), {
    [`debts/${id}`]: debt,
    [`auditLogs/${auditId}`]: buildAudit(
      auditId,
      actorUid,
      'RECEIVABLE_CREATED',
      'debt',
      id,
      `Tạo phải thu ${debt.code} từ đơn ${sale.code}`,
      now,
    ),
  });
  return debt;
}

export async function createPayableFromPurchase(
  input: CreateLinkedDebtInput,
  actorUid: string,
): Promise<PayableDebt> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  const database = requireDatabase();
  const purchaseId = input.sourceId.trim();
  if (!purchaseId) throw new Error('Vui lòng chọn phiếu nhập.');

  const snapshot = await get(ref(database, `purchases/${purchaseId}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy phiếu nhập.');
  const purchase = snapshot.val() as Purchase;
  if (purchase.status !== 'completed') throw new Error('Chỉ tạo phải trả từ phiếu nhập đang hoàn tất.');
  if (!purchase.supplierId || !purchase.supplierName) {
    throw new Error('Phiếu nhập phải có nhà cung cấp trước khi tạo công nợ.');
  }

  const originalAmount = positiveMoney(purchase.total, 'Tổng phiếu nhập');
  const id = linkedDebtId('payable', purchaseId);
  await ensureDebtMissing(id);
  const now = Date.now();
  const debt: PayableDebt = {
    id,
    code: `PTR-${purchase.code}`,
    kind: 'payable',
    supplierId: purchase.supplierId,
    supplierName: purchase.supplierName,
    sourceType: 'purchase',
    sourceId: purchaseId,
    originalAmount,
    paidAmount: 0,
    status: 'open',
    paymentVersion: 0,
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
    ...(input.dueDate ? { dueDate: dateValue(input.dueDate, 'Hạn thanh toán') } : {}),
    ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
  };

  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký công nợ.');
  await update(ref(database), {
    [`debts/${id}`]: debt,
    [`auditLogs/${auditId}`]: buildAudit(
      auditId,
      actorUid,
      'PAYABLE_CREATED',
      'debt',
      id,
      `Tạo phải trả ${debt.code} từ phiếu ${purchase.code}`,
      now,
    ),
  });
  return debt;
}

export async function createOpeningDebt(
  input: CreateOpeningDebtInput,
  actor: DebtFinanceActor,
): Promise<Debt> {
  requireDebtFinancePermission(actor);
  const database = requireDatabase();
  const amount = positiveMoney(input.amount, 'Số dư đầu kỳ');
  const partyId = input.partyId.trim();
  if (!partyId) throw new Error('Vui lòng chọn đối tượng công nợ.');

  const partyPath = input.kind === 'receivable' ? `customers/${partyId}` : `suppliers/${partyId}`;
  const partySnapshot = await get(ref(database, partyPath));
  if (!partySnapshot.exists()) throw new Error('Không tìm thấy đối tượng công nợ.');
  const party = partySnapshot.val() as Customer | Supplier;
  if (!party.name) throw new Error('Đối tượng công nợ thiếu tên.');

  const id = push(ref(database, 'debts')).key;
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!id || !auditId) throw new Error('Không thể tạo mã công nợ.');
  const now = Date.now();
  const common = {
    id,
    kind: input.kind,
    sourceType: 'opening' as const,
    originalAmount: amount,
    paidAmount: 0,
    status: 'open' as const,
    paymentVersion: 0,
    createdBy: actor.uid,
    createdAt: now,
    updatedAt: now,
    ...(input.dueDate ? { dueDate: dateValue(input.dueDate, 'Hạn thanh toán') } : {}),
    ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
  };

  const debt: Debt = input.kind === 'receivable'
    ? {
        ...common,
        code: makeCode('PT-DK', id, now),
        kind: 'receivable',
        customerId: partyId,
        customerName: party.name,
      }
    : {
        ...common,
        code: makeCode('PTR-DK', id, now),
        kind: 'payable',
        supplierId: partyId,
        supplierName: party.name,
      };

  await update(ref(database), {
    [`debts/${id}`]: debt,
    [`auditLogs/${auditId}`]: buildAudit(
      auditId,
      actor.uid,
      input.kind === 'receivable' ? 'RECEIVABLE_OPENING_CREATED' : 'PAYABLE_OPENING_CREATED',
      'debt',
      id,
      `Tạo số dư đầu kỳ ${debt.code}`,
      now,
    ),
  });
  return debt;
}

export async function recordDebtPayment(
  input: CreateDebtPaymentInput,
  actorUid: string,
): Promise<DebtPaymentEvent> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  const amount = positiveMoney(input.amount, 'Số tiền thanh toán');
  const database = requireDatabase();
  const paymentId = push(ref(database, 'debtPayments')).key;
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!paymentId || !auditId) throw new Error('Không thể tạo mã thanh toán.');

  for (let attempt = 0; attempt < MAX_PAYMENT_RETRIES; attempt += 1) {
    const debt = await readDebt(input.debtId);
    if (debt.status === 'cancelled') throw new Error('Khoản công nợ đã hủy.');
    const { original, paid, remaining } = validateDebtAmounts(debt);
    if (amount > remaining) throw new Error('Số tiền thanh toán vượt số còn nợ.');

    const now = Date.now();
    const nextPaid = paid + amount;
    const event: DebtPaymentEvent = {
      id: paymentId,
      debtId: debt.id,
      debtKind: debt.kind,
      eventType: 'payment',
      amount,
      paymentMethod: input.paymentMethod,
      createdBy: actorUid,
      createdAt: now,
      ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
    };

    try {
      await update(ref(database), {
        [`debts/${debt.id}/paidAmount`]: nextPaid,
        [`debts/${debt.id}/status`]: nextPaid === original ? 'settled' : 'open',
        [`debts/${debt.id}/paymentVersion`]: Number(debt.paymentVersion || 0) + 1,
        [`debts/${debt.id}/lastPaymentEventId`]: paymentId,
        [`debts/${debt.id}/updatedAt`]: now,
        [`debtPayments/${paymentId}`]: event,
        [`auditLogs/${auditId}`]: buildAudit(
          auditId,
          actorUid,
          debt.kind === 'receivable' ? 'RECEIVABLE_PAYMENT_RECORDED' : 'PAYABLE_PAYMENT_RECORDED',
          'debt_payment',
          paymentId,
          `Ghi thanh toán ${debt.code}: ${amount} VND`,
          now,
        ),
      });
      return event;
    } catch (error) {
      if (!isPermissionDenied(error) || attempt === MAX_PAYMENT_RETRIES - 1) throw error;
    }
  }

  throw new Error('Không thể ghi thanh toán sau nhiều lần thử.');
}

export async function reverseDebtPayment(
  paymentId: string,
  actor: DebtFinanceActor,
): Promise<DebtPaymentEvent> {
  const database = requireDatabase();
  const originalSnapshot = await get(ref(database, `debtPayments/${paymentId}`));
  if (!originalSnapshot.exists()) throw new Error('Không tìm thấy lần thanh toán.');
  const original = originalSnapshot.val() as DebtPaymentEvent;
  if (original.eventType !== 'payment') throw new Error('Chỉ có thể hoàn tác một lần thanh toán gốc.');
  requireDebtFinancePermission(actor);

  const reversalId = `REV_${paymentId}`;
  const existing = await get(ref(database, `debtPayments/${reversalId}`));
  if (existing.exists()) return existing.val() as DebtPaymentEvent;
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký hoàn tác.');

  for (let attempt = 0; attempt < MAX_PAYMENT_RETRIES; attempt += 1) {
    const debt = await readDebt(original.debtId);
    if (debt.kind !== original.debtKind) throw new Error('Loại công nợ của thanh toán không khớp.');
    const paid = money(debt.paidAmount, 'Đã thanh toán');
    if (original.amount > paid) throw new Error('Không thể hoàn tác vì số đã trả hiện tại thấp hơn giao dịch gốc.');

    const now = Date.now();
    const nextPaid = paid - original.amount;
    const event: DebtPaymentEvent = {
      id: reversalId,
      debtId: original.debtId,
      debtKind: original.debtKind,
      eventType: 'reversal',
      amount: original.amount,
      paymentMethod: original.paymentMethod,
      originalPaymentId: paymentId,
      createdBy: actor.uid,
      createdAt: now,
      ...(original.note ? { note: `Hoàn tác: ${original.note}` } : {}),
    };

    try {
      await update(ref(database), {
        [`debts/${debt.id}/paidAmount`]: nextPaid,
        [`debts/${debt.id}/status`]: nextPaid === debt.originalAmount ? 'settled' : 'open',
        [`debts/${debt.id}/paymentVersion`]: Number(debt.paymentVersion || 0) + 1,
        [`debts/${debt.id}/lastPaymentEventId`]: reversalId,
        [`debts/${debt.id}/updatedAt`]: now,
        [`debtPayments/${reversalId}`]: event,
        [`auditLogs/${auditId}`]: buildAudit(
          auditId,
          actor.uid,
          debt.kind === 'receivable' ? 'RECEIVABLE_PAYMENT_REVERSED' : 'PAYABLE_PAYMENT_REVERSED',
          'debt_payment',
          reversalId,
          `Hoàn tác thanh toán ${paymentId} của ${debt.code}`,
          now,
        ),
      });
      return event;
    } catch (error) {
      if (!isPermissionDenied(error) || attempt === MAX_PAYMENT_RETRIES - 1) throw error;
    }
  }
  throw new Error('Không thể hoàn tác thanh toán sau nhiều lần thử.');
}

export async function cancelDebt(debtId: string, actor: DebtFinanceActor) {
  requireDebtFinancePermission(actor);
  const database = requireDatabase();
  const debt = await readDebt(debtId);
  if (money(debt.paidAmount, 'Đã thanh toán') !== 0) {
    throw new Error('Phải hoàn tác toàn bộ thanh toán trước khi xóa công nợ.');
  }

  const paymentSnapshot = await get(query(
    ref(database, 'debtPayments'),
    orderByChild('debtId'),
    equalTo(debt.id),
  ));
  const paymentIds = paymentSnapshot.exists()
    ? Object.keys(paymentSnapshot.val() as Record<string, DebtPaymentEvent>)
    : [];
  const now = Date.now();
  const auditId = `DEBT_DELETE_${debt.id}_${debt.createdAt}`;
  const updates: Record<string, unknown> = {
    [`debts/${debt.id}`]: null,
    [`auditLogs/${auditId}`]: buildAudit(
      auditId,
      actor.uid,
      'DELETE_DEBT',
      'debt',
      debt.id,
      `Xóa vĩnh viễn công nợ ${debt.code}`,
      now,
    ),
  };
  for (const paymentId of paymentIds) {
    updates[`debtPayments/${paymentId}`] = null;
  }

  await update(ref(database), updates);
  return debt;
}

export function subscribeLoans(
  onData: (loans: Loan[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'loans'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, Loan> | null;
      onData(raw
        ? Object.entries(raw)
            .map(([id, item]) => ({ ...item, id: item.id || id }))
            .sort((a, b) => b.createdAt - a.createdAt)
        : []);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải khoản vay.')),
  );
}

export function subscribeLoanPayments(
  onData: (payments: LoanPaymentEvent[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'loanPayments'),
    (snapshot) => {
      const raw = snapshot.val() as Record<string, LoanPaymentEvent> | null;
      onData(raw
        ? Object.entries(raw)
            .map(([id, item]) => ({ ...item, id: item.id || id }))
            .sort((a, b) => b.createdAt - a.createdAt)
        : []);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải lịch sử trả vay.')),
  );
}

export async function createLoan(
  input: CreateLoanInput,
  actor: DebtFinanceActor,
): Promise<Loan> {
  requireDebtFinancePermission(actor);
  const database = requireDatabase();
  const lenderName = input.lenderName.trim();
  if (!lenderName) throw new Error('Vui lòng nhập ngân hàng/người cho vay.');
  const principalAmount = positiveMoney(input.principalAmount, 'Tiền gốc');
  const startDate = dateValue(input.startDate, 'Ngày vay');
  const firstDueDate = dateValue(input.firstDueDate, 'Ngày trả kỳ đầu');
  const schedule = buildLoanSchedule(
    principalAmount,
    input.annualInterestRatePercent,
    input.termMonths,
    firstDueDate,
  );
  const plannedInterestTotal = getLoanPlannedInterest(schedule);
  const id = push(ref(database, 'loans')).key;
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!id || !auditId) throw new Error('Không thể tạo mã khoản vay.');
  const now = Date.now();
  const loan: Loan = {
    id,
    code: makeCode('VAY', id, now),
    lenderName,
    principalAmount,
    annualInterestRatePercent: Number(input.annualInterestRatePercent),
    termMonths: input.termMonths,
    startDate,
    firstDueDate,
    plannedInterestTotal,
    principalPaid: 0,
    interestPaid: 0,
    installments: schedule,
    status: 'active',
    paymentVersion: 0,
    createdBy: actor.uid,
    createdAt: now,
    updatedAt: now,
    ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
  };

  await update(ref(database), {
    [`loans/${id}`]: loan,
    [`auditLogs/${auditId}`]: buildAudit(
      auditId,
      actor.uid,
      'LOAN_CREATED',
      'loan',
      id,
      `Tạo khoản vay ${loan.code} - ${lenderName}`,
      now,
    ),
  });
  return loan;
}

export async function recordLoanPayment(
  input: CreateLoanPaymentInput,
  actor: DebtFinanceActor,
): Promise<LoanPaymentEvent> {
  requireDebtFinancePermission(actor);
  const principalAmount = money(input.principalAmount, 'Trả gốc');
  const interestAmount = money(input.interestAmount, 'Trả lãi');
  if (principalAmount + interestAmount <= 0) throw new Error('Số tiền trả vay phải lớn hơn 0.');
  const database = requireDatabase();
  const paymentId = push(ref(database, 'loanPayments')).key;
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!paymentId || !auditId) throw new Error('Không thể tạo mã trả vay.');

  for (let attempt = 0; attempt < MAX_PAYMENT_RETRIES; attempt += 1) {
    const loan = await readLoan(input.loanId);
    if (loan.status === 'cancelled') throw new Error('Khoản vay đã hủy.');
    const principalPaid = money(loan.principalPaid, 'Gốc đã trả');
    const interestPaid = money(loan.interestPaid, 'Lãi đã trả');
    if (principalAmount > loan.principalAmount - principalPaid) throw new Error('Số trả gốc vượt dư nợ gốc.');
    if (interestAmount > loan.plannedInterestTotal - interestPaid) throw new Error('Số trả lãi vượt tổng lãi theo lịch.');

    const now = Date.now();
    const nextPrincipal = principalPaid + principalAmount;
    const nextInterest = interestPaid + interestAmount;
    const event: LoanPaymentEvent = {
      id: paymentId,
      loanId: loan.id,
      eventType: 'payment',
      principalAmount,
      interestAmount,
      paymentMethod: input.paymentMethod,
      createdBy: actor.uid,
      createdAt: now,
      ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
    };

    try {
      await update(ref(database), {
        [`loans/${loan.id}/principalPaid`]: nextPrincipal,
        [`loans/${loan.id}/interestPaid`]: nextInterest,
        [`loans/${loan.id}/status`]:
          nextPrincipal === loan.principalAmount && nextInterest === loan.plannedInterestTotal ? 'settled' : 'active',
        [`loans/${loan.id}/paymentVersion`]: Number(loan.paymentVersion || 0) + 1,
        [`loans/${loan.id}/lastPaymentEventId`]: paymentId,
        [`loans/${loan.id}/updatedAt`]: now,
        [`loanPayments/${paymentId}`]: event,
        [`auditLogs/${auditId}`]: buildAudit(
          auditId,
          actor.uid,
          'LOAN_PAYMENT_RECORDED',
          'loan_payment',
          paymentId,
          `Trả khoản vay ${loan.code}: gốc ${principalAmount}, lãi ${interestAmount}`,
          now,
        ),
      });
      return event;
    } catch (error) {
      if (!isPermissionDenied(error) || attempt === MAX_PAYMENT_RETRIES - 1) throw error;
    }
  }
  throw new Error('Không thể ghi trả vay sau nhiều lần thử.');
}

export async function reverseLoanPayment(
  paymentId: string,
  actor: DebtFinanceActor,
): Promise<LoanPaymentEvent> {
  requireDebtFinancePermission(actor);
  const database = requireDatabase();
  const snapshot = await get(ref(database, `loanPayments/${paymentId}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy lần trả vay.');
  const original = snapshot.val() as LoanPaymentEvent;
  if (original.eventType !== 'payment') throw new Error('Chỉ hoàn tác được giao dịch trả vay gốc.');

  const reversalId = `REV_${paymentId}`;
  const existing = await get(ref(database, `loanPayments/${reversalId}`));
  if (existing.exists()) return existing.val() as LoanPaymentEvent;
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký hoàn tác.');

  for (let attempt = 0; attempt < MAX_PAYMENT_RETRIES; attempt += 1) {
    const loan = await readLoan(original.loanId);
    const principalPaid = money(loan.principalPaid, 'Gốc đã trả');
    const interestPaid = money(loan.interestPaid, 'Lãi đã trả');
    if (original.principalAmount > principalPaid || original.interestAmount > interestPaid) {
      throw new Error('Không thể hoàn tác vì số đã trả hiện tại thấp hơn giao dịch gốc.');
    }

    const now = Date.now();
    const event: LoanPaymentEvent = {
      id: reversalId,
      loanId: loan.id,
      eventType: 'reversal',
      principalAmount: original.principalAmount,
      interestAmount: original.interestAmount,
      paymentMethod: original.paymentMethod,
      originalPaymentId: paymentId,
      createdBy: actor.uid,
      createdAt: now,
      ...(original.note ? { note: `Hoàn tác: ${original.note}` } : {}),
    };

    try {
      await update(ref(database), {
        [`loans/${loan.id}/principalPaid`]: principalPaid - original.principalAmount,
        [`loans/${loan.id}/interestPaid`]: interestPaid - original.interestAmount,
        [`loans/${loan.id}/status`]: 'active',
        [`loans/${loan.id}/paymentVersion`]: Number(loan.paymentVersion || 0) + 1,
        [`loans/${loan.id}/lastPaymentEventId`]: reversalId,
        [`loans/${loan.id}/updatedAt`]: now,
        [`loanPayments/${reversalId}`]: event,
        [`auditLogs/${auditId}`]: buildAudit(
          auditId,
          actor.uid,
          'LOAN_PAYMENT_REVERSED',
          'loan_payment',
          reversalId,
          `Hoàn tác trả vay ${paymentId} của ${loan.code}`,
          now,
        ),
      });
      return event;
    } catch (error) {
      if (!isPermissionDenied(error) || attempt === MAX_PAYMENT_RETRIES - 1) throw error;
    }
  }
  throw new Error('Không thể hoàn tác trả vay sau nhiều lần thử.');
}

export async function cancelLoan(loanId: string, actor: DebtFinanceActor) {
  requireDebtFinancePermission(actor);
  const database = requireDatabase();
  const loan = await readLoan(loanId);
  if (loan.status === 'cancelled') return loan;
  if (loan.principalPaid !== 0 || loan.interestPaid !== 0) {
    throw new Error('Phải hoàn tác toàn bộ lần trả trước khi hủy khoản vay.');
  }
  const now = Date.now();
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký hủy khoản vay.');
  await update(ref(database), {
    [`loans/${loan.id}/status`]: 'cancelled',
    [`loans/${loan.id}/updatedAt`]: now,
    [`auditLogs/${auditId}`]: buildAudit(
      auditId,
      actor.uid,
      'LOAN_CANCELLED',
      'loan',
      loan.id,
      `Hủy khoản vay ${loan.code}`,
      now,
    ),
  });
  return { ...loan, status: 'cancelled' as const, updatedAt: now };
}

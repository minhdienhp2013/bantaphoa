import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { openCashDrawerAfterTransaction } from './cashDrawerClient';
import { createExpense, type ExpenseInput } from '../expenses/expenseService';

type PayoutMethod = 'cash' | 'bank_transfer';
type PendingPayout = { id: string; input: ExpenseInput; method: PayoutMethod };
export type CashExpenseHandle = { submit: (method: PayoutMethod) => Promise<void> };
export type CashExpenseStatus = { saving: boolean; pending: { amount: number; note: string; method: PayoutMethod } | null };

function readPending(key: string): PendingPayout | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingPayout;
    if (/^POS_EXPENSE_[A-Za-z0-9_-]+$/.test(pending.id)
      && pending.input.category === 'Xuất tiền'
      && Number.isSafeInteger(pending.input.amount) && pending.input.amount > 0
      && Number.isFinite(pending.input.expenseDate) && pending.input.expenseDate > 0
      && typeof pending.input.note === 'string'
      && (pending.method === 'cash' || pending.method === 'bank_transfer')) return pending;
  } catch { /* A malformed local draft is never submitted. */ }
  return null;
}

interface Props {
  actorUid: string;
  active: boolean;
  disabled: boolean;
  amount: number;
  note: string;
  onReset: () => void;
  onStatusChange: (status: CashExpenseStatus) => void;
  onActiveChange: (active: boolean) => void;
  onLockChange: (locked: boolean) => void;
  onNotice: (message: string | null, error: string | null) => void;
}

const PosCashExpense = forwardRef<CashExpenseHandle, Props>(function PosCashExpense({
  actorUid, active, disabled, amount, note, onReset, onStatusChange, onActiveChange, onLockChange, onNotice,
}, ref) {
  const storageKey = `minhdien.pos-expense.pending.${actorUid}`;
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);
  const pendingRef = useRef(pending);

  useEffect(() => {
    onLockChange(saving || Boolean(pending));
    if (pending) onActiveChange(true);
  }, [pending, saving, onLockChange, onActiveChange]);

  useEffect(() => {
    onStatusChange({ saving, pending: pending ? { amount: pending.input.amount, note: pending.input.note ?? '', method: pending.method } : null });
  }, [pending, saving, onStatusChange]);

  useImperativeHandle(ref, () => ({ submit }));

  async function submit(method: PayoutMethod) {
    if ((!active && !pendingRef.current) || disabled || submittingRef.current) return;
    if (pendingRef.current && method !== pendingRef.current.method) return;
    if (!navigator.onLine) {
      onNotice(null, 'Đang offline. Kết nối mạng trước khi xác nhận xuất tiền.');
      return;
    }
    const amountVnd = Number(amount);
    if (!pendingRef.current && (!Number.isSafeInteger(amountVnd) || amountVnd <= 0)) {
      onNotice(null, 'Số tiền xuất phải là số nguyên VND lớn hơn 0.');
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    onNotice(null, null);
    try {
      let request = pendingRef.current;
      if (!request) {
        request = {
          id: `POS_EXPENSE_${crypto.randomUUID()}`,
          method,
          input: {
            category: 'Xuất tiền',
            amount: amountVnd,
            expenseDate: Date.now(),
            note: `[${method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'}]${note.trim() ? ` ${note.trim()}` : ''}`,
          },
        };
        // Persist before sending so a reload/retry retains the same immutable intent.
        localStorage.setItem(storageKey, JSON.stringify(request));
        pendingRef.current = request;
        setPending(request);
      }
      const expense = await createExpense(request.input, actorUid, request.id);
      const drawerWarning = request.method === 'cash'
        ? await openCashDrawerAfterTransaction(expense.id)
        : null;
      // A cleanup failure must not turn a confirmed expense into a failed write.
      try { localStorage.removeItem(storageKey); } catch { /* Retry lookup still finds the saved expense. */ }
      pendingRef.current = null;
      setPending(null);
      onReset();
      onActiveChange(false);
      onNotice(
        `Đã xuất ${expense.amount.toLocaleString('vi-VN')}đ · ${expense.code} · Đã thêm vào Chi phí.${request.method === 'cash' && !drawerWarning ? ' Đã gửi lệnh mở két; vui lòng kiểm tra két.' : ''}`,
        drawerWarning,
      );
    } catch (cause) {
      onNotice(null, `${cause instanceof Error ? cause.message : 'Không thể lưu khoản xuất tiền.'} Thử lại với cùng nội dung; không tạo khoản chi mới.`);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  if (!active && !pending) return (
    <button className="sales-cash-expense-button" type="button" disabled={disabled || saving}
      aria-expanded={false} onClick={() => { onNotice(null, null); onActiveChange(true); }}>
      <span aria-hidden="true">↗</span> Xuất tiền
    </button>
  );

  return (
    <div className="sales-cash-expense-form" aria-label="Xuất tiền vào Chi phí">
      <div className="sales-cash-expense-heading">
        <strong>Xuất tiền · ghi vào Chi phí</strong>
        <button type="button" disabled={saving || Boolean(pending)} aria-label="Đóng xuất tiền"
          onClick={() => onActiveChange(false)}>×</button>
      </div>
      {pending ? (
        <p className="sales-cash-expense-pending">
          {pending.input.amount.toLocaleString('vi-VN')}đ · {pending.input.note}
          <small>Đang giữ mã giao dịch. Thử lại để xác nhận, tránh ghi trùng.</small>
        </p>
      ) : null}
    </div>
  );
});

export default PosCashExpense;

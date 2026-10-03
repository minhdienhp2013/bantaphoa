import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import VndMoneyInput from '../../shared/numeric/VndMoneyInput';
import type { Expense } from '../../types/models';
import { cancelExpense, createExpense, subscribeExpenses, updateExpense, type ExpenseInput } from './expenseService';
import '../customers/crm.css';
import './expensesDesktopMobilePolish.css';

type ExpenseForm = {
  category: string;
  amount: string;
  expenseDate: string;
  note: string;
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toDateInput(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateToTimestamp(value: string, endOfDay = false) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return Number.NaN;
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).getTime();
}

function getDefaultDates() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toDateInput(first.getTime()), to: toDateInput(now.getTime()) };
}

function emptyExpenseForm(): ExpenseForm {
  return { category: '', amount: '', expenseDate: toDateInput(Date.now()), note: '' };
}

function toForm(expense: Expense): ExpenseForm {
  return {
    category: expense.category,
    amount: String(expense.amount),
    expenseDate: toDateInput(expense.expenseDate),
    note: expense.note ?? '',
  };
}

function validate(form: ExpenseForm) {
  const amount = Number(form.amount);
  if (!form.category.trim()) return 'Danh mục chi phí là bắt buộc.';
  if (!Number.isSafeInteger(amount) || amount <= 0) return 'Số tiền phải là số nguyên VND lớn hơn 0.';
  if (!Number.isFinite(dateToTimestamp(form.expenseDate))) return 'Ngày chi phí không hợp lệ.';
  return null;
}

function toInput(form: ExpenseForm): ExpenseInput {
  return {
    category: form.category.trim(),
    amount: Number(form.amount),
    expenseDate: dateToTimestamp(form.expenseDate),
    note: form.note.trim() || undefined,
  };
}

function formatVnd(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(value);
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('vi');
}

const initialDates = getDefaultDates();

export default function ExpensesPage() {
  const { appUser } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(initialDates.from);
  const [toDate, setToDate] = useState(initialDates.to);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [queryText, setQueryText] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [form, setForm] = useState<ExpenseForm>(() => emptyExpenseForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const from = fromDate ? dateToTimestamp(fromDate) : undefined;
    const to = toDate ? dateToTimestamp(toDate, true) : undefined;
    if (typeof from === 'number' && typeof to === 'number' && from > to) {
      setError('Khoảng ngày không hợp lệ: ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
      setExpenses([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError(null);
    try {
      return subscribeExpenses(
        { from, to },
        (next) => {
          setExpenses(next);
          setLoading(false);
        },
        (nextError) => {
          setError(nextError.message);
          setLoading(false);
        },
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể kết nối cơ sở dữ liệu.');
      setLoading(false);
      return undefined;
    }
  }, [fromDate, toDate]);

  const categories = useMemo(
    () => Array.from(new Set(expenses.map((expense) => expense.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi')),
    [expenses],
  );

  const filtered = useMemo(() => {
    const needle = normalize(queryText);
    return expenses.filter((expense) => {
      if (categoryFilter && expense.category !== categoryFilter) return false;
      if (!needle) return true;
      return [expense.code, expense.category, expense.note ?? ''].some((value) => normalize(value).includes(needle));
    });
  }, [categoryFilter, expenses, queryText]);

  const total = useMemo(
    () => filtered.filter((expense) => expense.status === 'completed').reduce((sum, expense) => sum + expense.amount, 0),
    [filtered],
  );
  const cancelledCount = useMemo(() => filtered.filter((expense) => expense.status === 'cancelled').length, [filtered]);
  const activeFilterCount = Number(Boolean(categoryFilter)) + Number(Boolean(queryText.trim()));

  function openCreate() {
    setEditing(null);
    setForm(emptyExpenseForm());
    setFormError(null);
    setSuccess(null);
    setEditorOpen(true);
  }

  function openEdit(expense: Expense) {
    if (expense.status !== 'completed') return;
    setEditing(expense);
    setForm(toForm(expense));
    setFormError(null);
    setSuccess(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (saving) return;
    setEditorOpen(false);
    setEditing(null);
    setForm(emptyExpenseForm());
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appUser || saving) return;
    const validationError = validate(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);
    setFormError(null);
    setError(null);
    try {
      if (editing) {
        await updateExpense(editing, toInput(form), appUser.uid);
        setSuccess('Đã cập nhật chi phí thành công.');
      } else {
        await createExpense(toInput(form), appUser.uid);
        setSuccess('Đã ghi nhận chi phí thành công.');
      }
      setEditorOpen(false);
      setEditing(null);
      setForm(emptyExpenseForm());
    } catch (nextError) {
      setFormError(nextError instanceof Error ? nextError.message : 'Không thể lưu chi phí.');
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(expense: Expense) {
    if (!appUser || cancellingId || expense.status === 'cancelled') return;
    const confirmed = window.confirm(`Hủy chi phí “${expense.code}”? Giao dịch sẽ được giữ lại để phục vụ lịch sử và báo cáo.`);
    if (!confirmed) return;

    setCancellingId(expense.id);
    setError(null);
    setSuccess(null);
    try {
      await cancelExpense(expense, appUser.uid);
      setSuccess('Đã hủy ghi nhận chi phí.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể hủy chi phí.');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="crm-page expenses-page">
      <div className="page-heading crm-heading expenses-heading">
        <div><p className="eyebrow">Tài chính nội bộ</p><h1>Chi phí</h1><p className="muted">Chi phí lưu số nguyên VND, có lịch sử chỉnh sửa/hủy và không tác động tồn kho.</p></div>
        <button className="button button--primary crm-touch" type="button" onClick={openCreate}>+ Ghi chi phí</button>
      </div>

      <section className="crm-stats expenses-stats" aria-label="Tổng hợp chi phí">
        <div className="crm-stat expenses-stat expenses-stat--total"><span>Tổng theo bộ lọc</span><strong>{formatVnd(total)}</strong></div>
        <div className="crm-stat expenses-stat"><span>Số giao dịch</span><strong>{filtered.length}</strong></div>
        <div className="crm-stat expenses-stat expenses-stat--cancelled"><span>Đã hủy</span><strong>{cancelledCount}</strong></div>
      </section>

      {success && <p className="crm-success" role="status">{success}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {editorOpen && (
        <section className="crm-editor expenses-editor" aria-label={editing ? 'Sửa chi phí' : 'Ghi nhận chi phí'}>
          <div className="crm-section-heading expenses-editor-heading">
            <div><h2>{editing ? 'Sửa chi phí' : 'Ghi nhận chi phí'}</h2><p>Danh mục là ô tự do; các gợi ý bên dưới không giới hạn loại chi phí.</p></div>
            <button className="expenses-editor-close" type="button" aria-label="Đóng cửa sổ chi phí" onClick={closeEditor} disabled={saving}>×</button>
          </div>
          <form className="crm-form expenses-form" onSubmit={handleSubmit}>
            <label>Danh mục *<input required list="expense-category-suggestions" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Nhập danh mục chi phí" /></label>
            <datalist id="expense-category-suggestions"><option value="Điện" /><option value="Nước" /><option value="Internet" /><option value="Thuê mặt bằng" /><option value="Vận chuyển" /><option value="Lương" /><option value="Văn phòng phẩm" /><option value="Bảo trì" /><option value="Marketing" /><option value="Phí ngân hàng" /><option value="Chi phí khác" /></datalist>
            <VndMoneyInput label="Số tiền (VND) *" value={form.amount} min={1} required onChange={(value) => setForm({ ...form, amount: value })} />
            <label>Ngày chi phí *<input required type="date" value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} /></label>
            <label className="crm-field-full">Ghi chú<textarea rows={3} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
            {formError && <p className="form-error crm-field-full" role="alert">{formError}</p>}
            <div className="crm-actions crm-field-full">
              <button className="button button--secondary crm-touch" type="button" onClick={closeEditor} disabled={saving}>Hủy</button>
              <button className="button button--primary crm-touch" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : editing ? 'Lưu thay đổi' : 'Ghi nhận chi phí'}</button>
            </div>
          </form>
        </section>
      )}

      <section className="crm-panel expenses-panel">
        <div className="expenses-mobile-filterbar">
          <div>
            <strong>Lịch sử chi phí</strong>
            <span>{filtered.length} giao dịch trong bộ lọc</span>
          </div>
          <button
            className={`button button--secondary expenses-filter-toggle${filtersOpen ? ' is-open' : ''}`}
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((current) => !current)}
          >
            Bộ lọc{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </button>
        </div>
        <div className={`crm-toolbar expenses-filter-panel${filtersOpen ? ' is-open' : ''}`}>
          <div className="crm-filter-grid expenses-filter-grid">
            <label className="crm-filter">Từ ngày<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
            <label className="crm-filter">Đến ngày<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
            <label className="crm-filter">Danh mục<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Tất cả</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
            <label className="crm-filter crm-filter-search">Tìm kiếm<input type="search" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Mã, danh mục hoặc ghi chú..." /></label>
          </div>
        </div>

        {loading ? (
          <div className="crm-empty">Đang tải lịch sử chi phí...</div>
        ) : filtered.length === 0 ? (
          <div className="crm-empty"><strong>Không có chi phí trong bộ lọc hiện tại.</strong><span>Có thể đổi khoảng ngày, danh mục hoặc từ khóa tìm kiếm.</span></div>
        ) : (
          <div className="crm-table-wrap expenses-table-wrap">
            <table className="crm-table expenses-table">
              <thead><tr><th>Ngày / Mã</th><th>Danh mục</th><th>Ghi chú</th><th className="crm-number">Số tiền</th><th>Trạng thái</th><th aria-label="Thao tác" /></tr></thead>
              <tbody>
                {filtered.map((expense) => (
                  <tr key={expense.id} className={expense.status === 'cancelled' ? 'crm-row-inactive' : undefined}>
                    <td data-label="Ngày / Mã"><strong>{formatDate(expense.expenseDate)}</strong><span className="crm-sub">{expense.code}</span></td>
                    <td data-label="Danh mục">{expense.category}</td>
                    <td data-label="Ghi chú">{expense.note || '—'}</td>
                    <td data-label="Số tiền" className="crm-number"><strong>{formatVnd(expense.amount)}</strong></td>
                    <td data-label="Trạng thái"><span className={expense.status === 'completed' ? 'crm-status crm-status-active' : 'crm-status crm-status-cancelled'}>{expense.status === 'completed' ? 'Đã ghi nhận' : 'Đã hủy'}</span></td>
                    <td className="crm-row-actions" data-label="Thao tác">
                      {expense.status === 'completed' ? <><button className="crm-text-button" type="button" onClick={() => openEdit(expense)}>Sửa</button><button className="crm-text-button crm-text-button-danger" type="button" onClick={() => void handleCancel(expense)} disabled={cancellingId === expense.id}>{cancellingId === expense.id ? 'Đang hủy...' : 'Hủy'}</button></> : <span className="crm-sub">Không còn thao tác</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

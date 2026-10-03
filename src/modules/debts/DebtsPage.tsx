import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { hasModulePermission } from '../../auth/permissions';
import VndMoneyInput from '../../shared/numeric/VndMoneyInput';
import type {
  Customer,
  Debt,
  DebtPaymentEvent,
  Loan,
  LoanPaymentEvent,
  PaymentMethod,
  ProductSale,
  Purchase,
  Supplier,
} from '../../types/models';
import {
  cancelDebt,
  cancelLoan,
  createLoan,
  createOpeningDebt,
  createPayableFromPurchase,
  createReceivableFromSale,
  getDebtRemaining,
  recordDebtPayment,
  recordLoanPayment,
  reverseDebtPayment,
  reverseLoanPayment,
  subscribeDebtCustomers,
  subscribeDebtPayments,
  subscribeDebtPurchases,
  subscribeDebtSales,
  subscribeDebtSuppliers,
  subscribeDebts,
  subscribeLoanPayments,
  subscribeLoans,
} from './debtService';
import {
  buildDebtAgingSummary,
  buildLoanSummary,
  getLoanScheduleDueAmount,
} from './debtMetrics';
import './debts.css';
import './debtsDesktopMobilePolish.css';

type DebtTab = 'receivable' | 'payable' | 'loan';
type DebtCreateMode = 'linked' | 'opening';

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: 'cash', label: 'Tiền mặt' },
  { value: 'bank_transfer', label: 'Chuyển khoản' },
  { value: 'other', label: 'Khác' },
];

function vnd(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

function dateText(value?: number) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(value);
}

function dateTimeText(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}

function fromDateInput(value: string) {
  if (!value) return undefined;
  const time = new Date(`${value}T12:00:00`).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function todayInput() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addOneMonthInput() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function debtParty(debt: Debt) {
  return debt.kind === 'receivable' ? debt.customerName : debt.supplierName;
}

function debtSource(debt: Debt) {
  if (debt.sourceType === 'opening') return 'Số dư đầu kỳ';
  return debt.kind === 'receivable' ? 'Đơn bán' : 'Phiếu nhập';
}

function statusLabel(status: Debt['status']) {
  if (status === 'settled') return 'Đã tất toán';
  if (status === 'cancelled') return 'Đã hủy';
  return 'Đang nợ';
}

function loanStatusLabel(status: Loan['status']) {
  if (status === 'settled') return 'Đã tất toán';
  if (status === 'cancelled') return 'Đã hủy';
  return 'Đang vay';
}

function SummaryCards({
  kind,
  debts,
}: {
  kind: 'receivable' | 'payable';
  debts: Debt[];
}) {
  const summary = buildDebtAgingSummary(debts, kind);
  return (
    <section className="debt-summary-grid" aria-label={kind === 'receivable' ? 'Tổng hợp phải thu' : 'Tổng hợp phải trả'}>
      <article className="debt-summary-card">
        <span>{kind === 'receivable' ? 'Tổng phải thu' : 'Tổng phải trả'}</span>
        <strong>{vnd(summary.totalOutstanding)}</strong>
        <small>{summary.openCount} khoản chưa tất toán</small>
      </article>
      <article className="debt-summary-card debt-summary-card--danger">
        <span>Quá hạn</span>
        <strong>{vnd(summary.overdueAmount)}</strong>
        <small>{summary.overdueCount} khoản</small>
      </article>
      <article className="debt-summary-card debt-summary-card--warning">
        <span>Đến hạn trong 7 ngày</span>
        <strong>{vnd(summary.dueSoonAmount)}</strong>
        <small>Cần theo dõi sớm</small>
      </article>
      <article className="debt-summary-card">
        <span>Quá hạn trên 90 ngày</span>
        <strong>{vnd(summary.overdueOver90)}</strong>
        <small>Ưu tiên xử lý</small>
      </article>
    </section>
  );
}

export default function DebtsPage() {
  const { appUser } = useAuth();
  const [tab, setTab] = useState<DebtTab>('receivable');
  const [debts, setDebts] = useState<Debt[]>([]);
  const [debtPayments, setDebtPayments] = useState<DebtPaymentEvent[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sales, setSales] = useState<ProductSale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loanPayments, setLoanPayments] = useState<LoanPaymentEvent[]>([]);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const [selectedDebtId, setSelectedDebtId] = useState<string>('');
  const [debtSearch, setDebtSearch] = useState('');
  const [debtStatusFilter, setDebtStatusFilter] = useState<'all' | Debt['status']>('all');
  const [createMode, setCreateMode] = useState<DebtCreateMode>('linked');
  const [linkedSourceId, setLinkedSourceId] = useState('');
  const [openingPartyId, setOpeningPartyId] = useState('');
  const [openingAmount, setOpeningAmount] = useState('');
  const [debtDueDate, setDebtDueDate] = useState('');
  const [debtNote, setDebtNote] = useState('');

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paymentNote, setPaymentNote] = useState('');

  const [selectedLoanId, setSelectedLoanId] = useState('');
  const [lenderName, setLenderName] = useState('');
  const [loanPrincipal, setLoanPrincipal] = useState('');
  const [loanRate, setLoanRate] = useState('');
  const [loanTerm, setLoanTerm] = useState('12');
  const [loanStartDate, setLoanStartDate] = useState(todayInput());
  const [loanFirstDueDate, setLoanFirstDueDate] = useState(addOneMonthInput());
  const [loanNote, setLoanNote] = useState('');
  const [loanPaymentPrincipal, setLoanPaymentPrincipal] = useState('');
  const [loanPaymentInterest, setLoanPaymentInterest] = useState('');
  const [loanPaymentMethod, setLoanPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [loanPaymentNote, setLoanPaymentNote] = useState('');

  useEffect(() => {
    const onError = (error: Error) => setLoadError(error.message);
    const unsubscribers = [
      subscribeDebts(setDebts, onError),
      subscribeDebtPayments(setDebtPayments, onError),
      subscribeDebtCustomers(setCustomers, onError),
      subscribeDebtSuppliers(setSuppliers, onError),
      subscribeDebtSales(setSales, onError),
      subscribeDebtPurchases(setPurchases, onError),
    ];

    if (appUser && hasModulePermission(appUser, 'debts')) {
      unsubscribers.push(
        subscribeLoans(setLoans, onError),
        subscribeLoanPayments(setLoanPayments, onError),
      );
    }

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [appUser]);

  useEffect(() => {
    setSelectedDebtId('');
    setLinkedSourceId('');
    setOpeningPartyId('');
    setOpeningAmount('');
    setDebtDueDate('');
    setDebtNote('');
    setMessage('');
  }, [tab]);

  const currentKind = tab === 'payable' ? 'payable' : 'receivable';
  const visibleDebts = useMemo(() => {
    const query = debtSearch.trim().toLocaleLowerCase('vi');
    return debts.filter((debt) => {
      if (debt.kind !== currentKind) return false;
      if (debtStatusFilter !== 'all' && debt.status !== debtStatusFilter) return false;
      if (!query) return true;
      const haystack = [
        debt.code,
        debtParty(debt),
        debt.sourceId ?? '',
        debtSource(debt),
      ].join(' ').toLocaleLowerCase('vi');
      return haystack.includes(query);
    });
  }, [currentKind, debtSearch, debtStatusFilter, debts]);
  const selectedDebt = useMemo(
    () => debts.find((debt) => debt.id === selectedDebtId) ?? null,
    [debts, selectedDebtId],
  );
  const selectedDebtPayments = useMemo(
    () => debtPayments.filter((payment) => payment.debtId === selectedDebtId),
    [debtPayments, selectedDebtId],
  );
  const reversedDebtPaymentIds = useMemo(
    () => new Set(
      selectedDebtPayments
        .filter((payment) => payment.eventType === 'reversal' && payment.originalPaymentId)
        .map((payment) => payment.originalPaymentId as string),
    ),
    [selectedDebtPayments],
  );

  const debtSourceIds = useMemo(
    () => new Set(debts.filter((debt) => debt.sourceId).map((debt) => debt.sourceId as string)),
    [debts],
  );
  const availableSales = useMemo(
    () => sales.filter((sale) => !debtSourceIds.has(sale.id)),
    [debtSourceIds, sales],
  );
  const availablePurchases = useMemo(
    () => purchases.filter((purchase) => !debtSourceIds.has(purchase.id)),
    [debtSourceIds, purchases],
  );

  const selectedLoan = useMemo(
    () => loans.find((loan) => loan.id === selectedLoanId) ?? null,
    [loans, selectedLoanId],
  );
  const selectedLoanPayments = useMemo(
    () => loanPayments.filter((payment) => payment.loanId === selectedLoanId),
    [loanPayments, selectedLoanId],
  );
  const reversedLoanPaymentIds = useMemo(
    () => new Set(
      selectedLoanPayments
        .filter((payment) => payment.eventType === 'reversal' && payment.originalPaymentId)
        .map((payment) => payment.originalPaymentId as string),
    ),
    [selectedLoanPayments],
  );
  const loanSummary = useMemo(() => buildLoanSummary(loans), [loans]);

  if (!appUser) return null;
  const currentUser = appUser;
  const canManageAllDebtFinance = hasModulePermission(currentUser, 'debts');

  async function run(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể hoàn tất thao tác.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateDebt(event: React.FormEvent) {
    event.preventDefault();
    const dueDate = fromDateInput(debtDueDate);

    if (createMode === 'linked') {
      if (!linkedSourceId) {
        setMessage(tab === 'receivable' ? 'Vui lòng chọn đơn bán.' : 'Vui lòng chọn phiếu nhập.');
        return;
      }
      await run(
        () => tab === 'receivable'
          ? createReceivableFromSale({ sourceId: linkedSourceId, dueDate, note: debtNote }, currentUser.uid)
          : createPayableFromPurchase({ sourceId: linkedSourceId, dueDate, note: debtNote }, currentUser.uid),
        'Đã tạo hồ sơ công nợ.',
      );
      setLinkedSourceId('');
    } else {
      await run(
        () => createOpeningDebt({
          kind: currentKind,
          partyId: openingPartyId,
          amount: Number(openingAmount),
          dueDate,
          note: debtNote,
        }, currentUser),
        'Đã tạo số dư công nợ đầu kỳ.',
      );
      setOpeningAmount('');
      setOpeningPartyId('');
    }
    setDebtDueDate('');
    setDebtNote('');
  }

  async function handleDebtPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedDebt) return;
    await run(
      () => recordDebtPayment({
        debtId: selectedDebt.id,
        amount: Number(paymentAmount),
        paymentMethod,
        note: paymentNote,
      }, currentUser.uid),
      selectedDebt.kind === 'receivable' ? 'Đã ghi nhận tiền khách trả.' : 'Đã ghi nhận tiền trả nhà cung cấp.',
    );
    setPaymentAmount('');
    setPaymentNote('');
  }

  async function handleCreateLoan(event: React.FormEvent) {
    event.preventDefault();
    await run(
      () => createLoan({
        lenderName,
        principalAmount: Number(loanPrincipal),
        annualInterestRatePercent: Number(loanRate),
        termMonths: Number(loanTerm),
        startDate: fromDateInput(loanStartDate) ?? Date.now(),
        firstDueDate: fromDateInput(loanFirstDueDate) ?? Date.now(),
        note: loanNote,
      }, currentUser),
      'Đã tạo khoản vay và lịch trả nợ.',
    );
    setLenderName('');
    setLoanPrincipal('');
    setLoanRate('');
    setLoanTerm('12');
    setLoanNote('');
  }

  async function handleLoanPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLoan) return;
    await run(
      () => recordLoanPayment({
        loanId: selectedLoan.id,
        principalAmount: Number(loanPaymentPrincipal || 0),
        interestAmount: Number(loanPaymentInterest || 0),
        paymentMethod: loanPaymentMethod,
        note: loanPaymentNote,
      }, currentUser),
      'Đã ghi nhận lần trả vay.',
    );
    setLoanPaymentPrincipal('');
    setLoanPaymentInterest('');
    setLoanPaymentNote('');
  }

  return (
    <div className="debts-page">
      <header className="debts-header">
        <div>
          <p className="eyebrow">Tài chính</p>
          <h1>Công nợ</h1>
          <p>Quản lý phải thu khách hàng, phải trả nhà cung cấp và khoản vay riêng biệt với doanh thu/kho.</p>
        </div>
      </header>

      {loadError ? <div className="debt-message debt-message--error" role="alert">{loadError}</div> : null}
      {message ? <div className="debt-message" role="status">{message}</div> : null}

      <nav className="debt-tabs" aria-label="Nhóm công nợ">
        <button type="button" className={tab === 'receivable' ? 'is-active' : ''} onClick={() => setTab('receivable')}>
          Khách hàng nợ mình
        </button>
        <button type="button" className={tab === 'payable' ? 'is-active' : ''} onClick={() => setTab('payable')}>
          Mình nợ nhà cung cấp
        </button>
        {canManageAllDebtFinance ? (
          <button type="button" className={tab === 'loan' ? 'is-active' : ''} onClick={() => setTab('loan')}>
            Vay ngân hàng
          </button>
        ) : null}
      </nav>

      {tab !== 'loan' ? (
        <>
          <SummaryCards kind={currentKind} debts={debts} />

          <section className="debt-workspace">
            <form className="debt-card debt-create-card" onSubmit={handleCreateDebt}>
              <div className="debt-card__heading">
                <div>
                  <h2>Tạo khoản {currentKind === 'receivable' ? 'phải thu' : 'phải trả'}</h2>
                  <p>
                    {currentKind === 'receivable'
                      ? 'Liên kết đơn bán thật hoặc nhập số dư đầu kỳ.'
                      : 'Liên kết phiếu nhập thật hoặc nhập số dư đầu kỳ.'}
                  </p>
                </div>
              </div>

              <div className="debt-mode-switch">
                <button
                  type="button"
                  className={createMode === 'linked' ? 'is-active' : ''}
                  onClick={() => setCreateMode('linked')}
                >
                  {currentKind === 'receivable' ? 'Từ đơn bán' : 'Từ phiếu nhập'}
                </button>
                {canManageAllDebtFinance ? (
                  <button
                    type="button"
                    className={createMode === 'opening' ? 'is-active' : ''}
                    onClick={() => setCreateMode('opening')}
                  >
                    Số dư đầu kỳ
                  </button>
                ) : null}
              </div>

              {createMode === 'linked' ? (
                <label className="debt-field">
                  <span>{currentKind === 'receivable' ? 'Đơn bán có khách hàng' : 'Phiếu nhập có nhà cung cấp'}</span>
                  <select value={linkedSourceId} onChange={(event) => setLinkedSourceId(event.target.value)} required>
                    <option value="">Chọn giao dịch…</option>
                    {currentKind === 'receivable'
                      ? availableSales.map((sale) => (
                          <option key={sale.id} value={sale.id}>
                            {sale.code} · {sale.customerName} · {vnd(sale.total)}
                          </option>
                        ))
                      : availablePurchases.map((purchase) => (
                          <option key={purchase.id} value={purchase.id}>
                            {purchase.code} · {purchase.supplierName} · {vnd(purchase.total)}
                          </option>
                        ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="debt-field">
                    <span>{currentKind === 'receivable' ? 'Khách hàng' : 'Nhà cung cấp'}</span>
                    <select value={openingPartyId} onChange={(event) => setOpeningPartyId(event.target.value)} required>
                      <option value="">Chọn đối tượng…</option>
                      {(currentKind === 'receivable' ? customers : suppliers).map((party) => (
                        <option key={party.id} value={party.id}>{party.code} · {party.name}</option>
                      ))}
                    </select>
                  </label>
                  <VndMoneyInput
                    className="debt-field"
                    label="Số dư đầu kỳ"
                    value={openingAmount}
                    onChange={setOpeningAmount}
                    min={1}
                    required
                  />
                </>
              )}

              <label className="debt-field">
                <span>Hạn thanh toán</span>
                <input type="date" value={debtDueDate} onChange={(event) => setDebtDueDate(event.target.value)} />
              </label>
              <label className="debt-field">
                <span>Ghi chú</span>
                <textarea rows={2} value={debtNote} onChange={(event) => setDebtNote(event.target.value)} />
              </label>
              <button className="button button--primary" type="submit" disabled={busy}>
                {busy ? 'Đang lưu…' : 'Tạo công nợ'}
              </button>
            </form>

            <section className="debt-card debt-list-card">
              <div className="debt-card__heading">
                <div>
                  <h2>Sổ công nợ / đối chiếu</h2>
                  <p>{visibleDebts.length} hồ sơ phù hợp</p>
                </div>
              </div>
              <div className="debt-list-filters">
                <label className="debt-field">
                  <span>Tìm theo tên / mã / chứng từ</span>
                  <input
                    type="search"
                    value={debtSearch}
                    onChange={(event) => setDebtSearch(event.target.value)}
                    placeholder="Ví dụ: KH001, PN..., Minh..."
                  />
                </label>
                <label className="debt-field">
                  <span>Trạng thái</span>
                  <select value={debtStatusFilter} onChange={(event) => setDebtStatusFilter(event.target.value as 'all' | Debt['status'])}>
                    <option value="all">Tất cả</option>
                    <option value="open">Đang nợ</option>
                    <option value="settled">Đã tất toán</option>
                    <option value="cancelled">Đã hủy</option>
                  </select>
                </label>
              </div>
              <div className="debt-list">
                {visibleDebts.length === 0 ? <p className="debt-empty">Chưa có công nợ.</p> : null}
                {visibleDebts.map((debt) => {
                  const remaining = getDebtRemaining(debt);
                  const overdue = debt.dueDate && debt.dueDate < Date.now() && remaining > 0 && debt.status !== 'cancelled';
                  return (
                    <button
                      type="button"
                      key={debt.id}
                      className={`debt-list-item${selectedDebtId === debt.id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedDebtId(debt.id)}
                    >
                      <span className="debt-list-item__main">
                        <strong>{debtParty(debt)}</strong>
                        <small>{debt.code} · {debtSource(debt)} · Hạn {dateText(debt.dueDate)}</small>
                      </span>
                      <span className="debt-list-item__money">
                        <strong>{vnd(remaining)}</strong>
                        <small className={overdue ? 'is-overdue' : ''}>{overdue ? 'Quá hạn' : statusLabel(debt.status)}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </section>

          {selectedDebt ? (
            <section className="debt-detail-grid">
              <article className="debt-card">
                <div className="debt-card__heading">
                  <div>
                    <h2>{selectedDebt.code}</h2>
                    <p>{debtParty(selectedDebt)} · {statusLabel(selectedDebt.status)}</p>
                  </div>
                  {canManageAllDebtFinance && selectedDebt.paidAmount === 0 ? (
                    <button
                      className="button button--secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const confirmed = window.confirm(
                          'Xóa vĩnh viễn công nợ này và toàn bộ lịch sử thanh toán liên quan? Thao tác không thể hoàn tác.',
                        );
                        if (!confirmed) return;
                        void run(
                          () => cancelDebt(selectedDebt.id, currentUser),
                          'Đã xóa vĩnh viễn hồ sơ công nợ và lịch sử thanh toán liên quan.',
                        );
                      }}
                    >
                      {selectedDebt.status === 'cancelled' ? 'Xóa công nợ' : 'Hủy và xóa công nợ'}
                    </button>
                  ) : null}
                </div>

                <dl className="debt-detail-stats">
                  <div><dt>Giá trị gốc</dt><dd>{vnd(selectedDebt.originalAmount)}</dd></div>
                  <div><dt>Đã thanh toán</dt><dd>{vnd(selectedDebt.paidAmount)}</dd></div>
                  <div><dt>Còn nợ</dt><dd>{vnd(getDebtRemaining(selectedDebt))}</dd></div>
                  <div><dt>Hạn thanh toán</dt><dd>{dateText(selectedDebt.dueDate)}</dd></div>
                </dl>

                {selectedDebt.status !== 'cancelled' && getDebtRemaining(selectedDebt) > 0 ? (
                  <form className="debt-payment-form" onSubmit={handleDebtPayment}>
                    <h3>{selectedDebt.kind === 'receivable' ? 'Ghi khách trả tiền' : 'Ghi trả nhà cung cấp'}</h3>
                    <VndMoneyInput
                      className="debt-field"
                      label="Số tiền"
                      value={paymentAmount}
                      onChange={setPaymentAmount}
                      min={1}
                      required
                    />
                    <label className="debt-field">
                      <span>Phương thức</span>
                      <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                        {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                      </select>
                    </label>
                    <label className="debt-field debt-field--wide">
                      <span>Ghi chú</span>
                      <input value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} />
                    </label>
                    <button className="button button--primary" type="submit" disabled={busy}>Ghi thanh toán</button>
                  </form>
                ) : null}
              </article>

              <article className="debt-card">
                <div className="debt-card__heading">
                  <div>
                    <h2>Lịch sử thanh toán</h2>
                    <p>Không sửa/xóa giao dịch cũ; sai thì tạo hoàn tác.</p>
                  </div>
                </div>
                <div className="debt-history">
                  {selectedDebtPayments.length === 0 ? <p className="debt-empty">Chưa có thanh toán.</p> : null}
                  {selectedDebtPayments.map((payment) => {
                    const reversed = payment.eventType === 'payment' && reversedDebtPaymentIds.has(payment.id);
                    const canReverse = payment.eventType === 'payment'
                      && !reversed
                      && (canManageAllDebtFinance || payment.createdBy === currentUser.uid);
                    return (
                      <div className="debt-history-item" key={payment.id}>
                        <span>
                          <strong>{payment.eventType === 'reversal' ? 'Hoàn tác' : 'Thanh toán'} · {vnd(payment.amount)}</strong>
                          <small>{dateTimeText(payment.createdAt)} · {PAYMENT_METHODS.find((item) => item.value === payment.paymentMethod)?.label ?? payment.paymentMethod}</small>
                        </span>
                        <span className="debt-history-item__actions">
                          {reversed ? <small>Đã hoàn tác</small> : null}
                          {canReverse ? (
                            <button
                              type="button"
                              className="button button--secondary"
                              disabled={busy}
                              onClick={() => void run(
                                () => reverseDebtPayment(payment.id, currentUser),
                                'Đã hoàn tác lần thanh toán.',
                              )}
                            >
                              Hoàn tác
                            </button>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </article>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <section className="debt-summary-grid" aria-label="Tổng hợp vay">
            <article className="debt-summary-card">
              <span>Dư nợ gốc</span>
              <strong>{vnd(loanSummary.principalOutstanding)}</strong>
              <small>{loanSummary.activeCount} khoản vay đang hoạt động</small>
            </article>
            <article className="debt-summary-card">
              <span>Lãi còn theo lịch</span>
              <strong>{vnd(loanSummary.plannedInterestOutstanding)}</strong>
              <small>Theo lịch tạo lúc ghi khoản vay</small>
            </article>
            <article className="debt-summary-card debt-summary-card--danger">
              <span>Đến hạn chưa trả đủ</span>
              <strong>{vnd(loanSummary.overdueScheduledAmount)}</strong>
              <small>Tính theo lịch đến hôm nay</small>
            </article>
          </section>

          <section className="debt-workspace">
            <form className="debt-card debt-create-card" onSubmit={handleCreateLoan}>
              <div className="debt-card__heading">
                <div><h2>Thêm khoản vay</h2><p>Tách riêng gốc, lãi, kỳ hạn và lịch trả.</p></div>
              </div>
              <label className="debt-field"><span>Ngân hàng / người cho vay</span><input value={lenderName} onChange={(event) => setLenderName(event.target.value)} required /></label>
              <VndMoneyInput className="debt-field" label="Tiền gốc" value={loanPrincipal} onChange={setLoanPrincipal} min={1} required />
              <div className="debt-form-row">
                <label className="debt-field"><span>Lãi suất năm (%)</span><input type="number" min="0" max="100" step="0.01" value={loanRate} onChange={(event) => setLoanRate(event.target.value)} required /></label>
                <label className="debt-field"><span>Kỳ hạn (tháng)</span><input type="number" min="1" max="600" step="1" value={loanTerm} onChange={(event) => setLoanTerm(event.target.value)} required /></label>
              </div>
              <div className="debt-form-row">
                <label className="debt-field"><span>Ngày vay</span><input type="date" value={loanStartDate} onChange={(event) => setLoanStartDate(event.target.value)} required /></label>
                <label className="debt-field"><span>Ngày trả kỳ đầu</span><input type="date" value={loanFirstDueDate} onChange={(event) => setLoanFirstDueDate(event.target.value)} required /></label>
              </div>
              <label className="debt-field"><span>Ghi chú</span><textarea rows={2} value={loanNote} onChange={(event) => setLoanNote(event.target.value)} /></label>
              <button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Tạo khoản vay'}</button>
            </form>

            <section className="debt-card debt-list-card">
              <div className="debt-card__heading"><div><h2>Khoản vay</h2><p>{loans.length} hồ sơ</p></div></div>
              <div className="debt-list">
                {loans.length === 0 ? <p className="debt-empty">Chưa có khoản vay.</p> : null}
                {loans.map((loan) => (
                  <button
                    type="button"
                    key={loan.id}
                    className={`debt-list-item${selectedLoanId === loan.id ? ' is-selected' : ''}`}
                    onClick={() => setSelectedLoanId(loan.id)}
                  >
                    <span className="debt-list-item__main">
                      <strong>{loan.lenderName}</strong>
                      <small>{loan.code} · {loan.termMonths} tháng · {loan.annualInterestRatePercent}%/năm</small>
                    </span>
                    <span className="debt-list-item__money">
                      <strong>{vnd(Math.max(0, loan.principalAmount - loan.principalPaid))}</strong>
                      <small>{loanStatusLabel(loan.status)}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </section>

          {selectedLoan ? (
            <section className="debt-detail-grid">
              <article className="debt-card">
                <div className="debt-card__heading">
                  <div><h2>{selectedLoan.code}</h2><p>{selectedLoan.lenderName} · {loanStatusLabel(selectedLoan.status)}</p></div>
                  {selectedLoan.status !== 'cancelled' && selectedLoan.principalPaid === 0 && selectedLoan.interestPaid === 0 ? (
                    <button className="button button--secondary" type="button" disabled={busy} onClick={() => void run(
                      () => cancelLoan(selectedLoan.id, currentUser),
                      'Đã hủy khoản vay.',
                    )}>Hủy khoản vay</button>
                  ) : null}
                </div>

                <dl className="debt-detail-stats">
                  <div><dt>Gốc ban đầu</dt><dd>{vnd(selectedLoan.principalAmount)}</dd></div>
                  <div><dt>Gốc còn lại</dt><dd>{vnd(Math.max(0, selectedLoan.principalAmount - selectedLoan.principalPaid))}</dd></div>
                  <div><dt>Lãi kế hoạch</dt><dd>{vnd(selectedLoan.plannedInterestTotal)}</dd></div>
                  <div><dt>Lãi đã trả</dt><dd>{vnd(selectedLoan.interestPaid)}</dd></div>
                  <div><dt>Đến hạn chưa trả đủ</dt><dd>{vnd(getLoanScheduleDueAmount(selectedLoan))}</dd></div>
                </dl>

                {selectedLoan.status !== 'cancelled' && selectedLoan.status !== 'settled' ? (
                  <form className="debt-payment-form" onSubmit={handleLoanPayment}>
                    <h3>Ghi lần trả vay</h3>
                    <VndMoneyInput className="debt-field" label="Trả gốc" value={loanPaymentPrincipal} onChange={setLoanPaymentPrincipal} min={0} />
                    <VndMoneyInput className="debt-field" label="Trả lãi" value={loanPaymentInterest} onChange={setLoanPaymentInterest} min={0} />
                    <label className="debt-field"><span>Phương thức</span><select value={loanPaymentMethod} onChange={(event) => setLoanPaymentMethod(event.target.value as PaymentMethod)}>{PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></label>
                    <label className="debt-field debt-field--wide"><span>Ghi chú</span><input value={loanPaymentNote} onChange={(event) => setLoanPaymentNote(event.target.value)} /></label>
                    <button className="button button--primary" type="submit" disabled={busy}>Ghi trả vay</button>
                  </form>
                ) : null}
              </article>

              <article className="debt-card">
                <div className="debt-card__heading"><div><h2>Lịch trả dự kiến</h2><p>Gốc trả đều, lãi tính theo dư nợ còn lại tại lúc tạo lịch.</p></div></div>
                <div className="loan-schedule">
                  {Object.values(selectedLoan.installments ?? {}).map((installment) => (
                    <div className="loan-schedule__row" key={installment.id}>
                      <span><strong>Kỳ {installment.sequence}</strong><small>{dateText(installment.dueDate)}</small></span>
                      <span><small>Gốc</small><strong>{vnd(installment.principalDue)}</strong></span>
                      <span><small>Lãi</small><strong>{vnd(installment.interestDue)}</strong></span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="debt-card debt-card--full">
                <div className="debt-card__heading"><div><h2>Lịch sử trả vay</h2><p>Mọi lần sửa sai dùng hoàn tác, không xóa lịch sử.</p></div></div>
                <div className="debt-history">
                  {selectedLoanPayments.length === 0 ? <p className="debt-empty">Chưa có lần trả vay.</p> : null}
                  {selectedLoanPayments.map((payment) => {
                    const reversed = payment.eventType === 'payment' && reversedLoanPaymentIds.has(payment.id);
                    return (
                      <div className="debt-history-item" key={payment.id}>
                        <span>
                          <strong>{payment.eventType === 'reversal' ? 'Hoàn tác' : 'Trả vay'} · Gốc {vnd(payment.principalAmount)} · Lãi {vnd(payment.interestAmount)}</strong>
                          <small>{dateTimeText(payment.createdAt)}</small>
                        </span>
                        {payment.eventType === 'payment' && !reversed ? (
                          <button className="button button--secondary" type="button" disabled={busy} onClick={() => void run(
                            () => reverseLoanPayment(payment.id, currentUser),
                            'Đã hoàn tác lần trả vay.',
                          )}>Hoàn tác</button>
                        ) : reversed ? <small>Đã hoàn tác</small> : null}
                      </div>
                    );
                  })}
                </div>
              </article>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

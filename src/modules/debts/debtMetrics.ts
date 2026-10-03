import type { Debt, Loan, LoanInstallment } from '../../types/models';


function positiveIntegerMoney(value: unknown, label: string) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`${label} phải là số nguyên VND lớn hơn 0.`);
  return amount;
}

function addMonths(timestamp: number, offset: number) {
  const source = new Date(timestamp);
  const result = new Date(source.getFullYear(), source.getMonth() + offset, 1, 12, 0, 0, 0);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(source.getDate(), lastDay));
  return result.getTime();
}

export function buildLoanSchedule(
  principalAmount: number,
  annualInterestRatePercent: number,
  termMonths: number,
  firstDueDate: number,
): Record<string, LoanInstallment> {
  const principal = positiveIntegerMoney(principalAmount, 'Tiền gốc');
  const rate = Number(annualInterestRatePercent);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Lãi suất năm phải từ 0 đến 100%.');
  if (!Number.isInteger(termMonths) || termMonths <= 0 || termMonths > 600) {
    throw new Error('Kỳ hạn vay phải từ 1 đến 600 tháng.');
  }
  if (!Number.isFinite(firstDueDate) || firstDueDate <= 0) throw new Error('Ngày trả kỳ đầu không hợp lệ.');

  const basePrincipal = Math.floor(principal / termMonths);
  let remaining = principal;
  const schedule: Record<string, LoanInstallment> = {};

  for (let index = 0; index < termMonths; index += 1) {
    const principalDue = index === termMonths - 1 ? remaining : basePrincipal;
    const interestDue = Math.round(remaining * rate / 100 / 12);
    const id = `i${String(index + 1).padStart(3, '0')}`;
    schedule[id] = {
      id,
      sequence: index + 1,
      dueDate: addMonths(firstDueDate, index),
      principalDue,
      interestDue,
    };
    remaining -= principalDue;
  }

  return schedule;
}

export function getLoanPlannedInterest(schedule: Record<string, LoanInstallment>) {
  return Object.values(schedule).reduce(
    (sum, item) => sum + Math.max(0, Math.round(Number(item.interestDue) || 0)),
    0,
  );
}

export interface DebtAgingSummary {
  totalOutstanding: number;
  openCount: number;
  overdueAmount: number;
  overdueCount: number;
  dueSoonAmount: number;
  currentAmount: number;
  overdue1To30: number;
  overdue31To60: number;
  overdue61To90: number;
  overdueOver90: number;
}

export interface LoanSummary {
  principalOutstanding: number;
  plannedInterestOutstanding: number;
  activeCount: number;
  overdueScheduledAmount: number;
}

function startOfToday(now: number) {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysBetween(from: number, to: number) {
  return Math.floor((to - from) / 86_400_000);
}

export function debtRemaining(debt: Pick<Debt, 'originalAmount' | 'paidAmount'>) {
  return Math.max(0, Math.round(Number(debt.originalAmount) || 0) - Math.round(Number(debt.paidAmount) || 0));
}

export function buildDebtAgingSummary(
  debts: readonly Debt[],
  kind: Debt['kind'],
  now = Date.now(),
): DebtAgingSummary {
  const today = startOfToday(now);
  const result: DebtAgingSummary = {
    totalOutstanding: 0,
    openCount: 0,
    overdueAmount: 0,
    overdueCount: 0,
    dueSoonAmount: 0,
    currentAmount: 0,
    overdue1To30: 0,
    overdue31To60: 0,
    overdue61To90: 0,
    overdueOver90: 0,
  };

  for (const debt of debts) {
    if (debt.kind !== kind || debt.status === 'cancelled') continue;
    const remaining = debtRemaining(debt);
    if (remaining <= 0) continue;
    result.totalOutstanding += remaining;
    result.openCount += 1;

    if (!debt.dueDate) {
      result.currentAmount += remaining;
      continue;
    }

    const dueDay = startOfToday(debt.dueDate);
    if (dueDay < today) {
      const overdueDays = Math.max(1, daysBetween(dueDay, today));
      result.overdueAmount += remaining;
      result.overdueCount += 1;
      if (overdueDays <= 30) result.overdue1To30 += remaining;
      else if (overdueDays <= 60) result.overdue31To60 += remaining;
      else if (overdueDays <= 90) result.overdue61To90 += remaining;
      else result.overdueOver90 += remaining;
      continue;
    }

    const daysUntilDue = daysBetween(today, dueDay);
    if (daysUntilDue <= 7) result.dueSoonAmount += remaining;
    else result.currentAmount += remaining;
  }

  return result;
}

export function getLoanScheduleDueAmount(loan: Loan, now = Date.now()) {
  if (loan.status === 'cancelled') return 0;
  const today = startOfToday(now);
  const scheduledDue = Object.values(loan.installments ?? {})
    .filter((installment) => startOfToday(Number(installment.dueDate)) <= today)
    .reduce(
      (sum, installment) =>
        sum
        + Math.max(0, Math.round(Number(installment.principalDue) || 0))
        + Math.max(0, Math.round(Number(installment.interestDue) || 0)),
      0,
    );
  const paid = Math.max(0, Math.round(Number(loan.principalPaid) || 0))
    + Math.max(0, Math.round(Number(loan.interestPaid) || 0));
  return Math.max(0, scheduledDue - paid);
}

export function buildLoanSummary(loans: readonly Loan[], now = Date.now()): LoanSummary {
  return loans.reduce<LoanSummary>((summary, loan) => {
    if (loan.status === 'cancelled') return summary;
    const principalOutstanding = Math.max(
      0,
      Math.round(Number(loan.principalAmount) || 0) - Math.round(Number(loan.principalPaid) || 0),
    );
    const interestOutstanding = Math.max(
      0,
      Math.round(Number(loan.plannedInterestTotal) || 0) - Math.round(Number(loan.interestPaid) || 0),
    );
    return {
      principalOutstanding: summary.principalOutstanding + principalOutstanding,
      plannedInterestOutstanding: summary.plannedInterestOutstanding + interestOutstanding,
      activeCount: summary.activeCount + (loan.status === 'active' ? 1 : 0),
      overdueScheduledAmount: summary.overdueScheduledAmount + getLoanScheduleDueAmount(loan, now),
    };
  }, {
    principalOutstanding: 0,
    plannedInterestOutstanding: 0,
    activeCount: 0,
    overdueScheduledAmount: 0,
  });
}

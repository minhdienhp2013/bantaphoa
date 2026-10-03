export const TRANSACTION_HISTORY_RESET_CONFIRMATION_PHRASE = 'RESET GIAO DICH' as const;

export const TRANSACTION_HISTORY_RESET_DELETE_NODES = [
  'sales',
  'purchases',
  'stockOuts',
  'stockMovements',
  'stockOperations',
  'stocktakes',
] as const;

export const TRANSACTION_HISTORY_RESET_FINANCE_NODES = [
  'debts',
  'debtPayments',
  'loans',
  'loanPayments',
] as const;

export const TRANSACTION_HISTORY_RESET_RETAINED_NODES = [
  'products',
  'categories',
  'customers',
  'suppliers',
  'users',
  'expenses',
  'settings',
  'auditLogs',
] as const;

export function isTransactionHistoryResetConfirmation(value: string) {
  return value === TRANSACTION_HISTORY_RESET_CONFIRMATION_PHRASE;
}

export function buildTransactionHistoryResetDeleteNodes(includeFinance: boolean): readonly string[] {
  return includeFinance
    ? [...TRANSACTION_HISTORY_RESET_DELETE_NODES, ...TRANSACTION_HISTORY_RESET_FINANCE_NODES]
    : TRANSACTION_HISTORY_RESET_DELETE_NODES;
}

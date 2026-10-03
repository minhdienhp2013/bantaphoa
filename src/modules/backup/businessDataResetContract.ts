export const BUSINESS_DATA_RESET_CONFIRMATION_PHRASE = 'XOA TOAN BO DU LIEU' as const;

export const BUSINESS_DATA_RESET_DELETE_NODES = [
  'products',
  'sales',
  'purchases',
  'debts',
  'debtPayments',
  'loans',
  'loanPayments',
  'stockOuts',
  'stockMovements',
  'stockOperations',
  'stocktakes',
  'productDeletionLocks',
] as const;

export const BUSINESS_DATA_RESET_RETAINED_NODES = [
  'users',
  'categories',
  'customers',
  'suppliers',
  'expenses',
  'settings',
  'auditLogs',
] as const;

export const BUSINESS_DATA_RESET_LOCK_PATH = 'businessDataResetLock' as const;

export function isBusinessDataResetConfirmation(value: string) {
  return value === BUSINESS_DATA_RESET_CONFIRMATION_PHRASE;
}

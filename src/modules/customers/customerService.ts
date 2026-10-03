import { equalTo, get, onValue, orderByChild, push, query, ref, update, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import { invalidateReferenceCache } from '../../shared/data/referenceDataCache';
import type { AuditLog, Customer } from '../../types/models';

export interface CustomerInput {
  code?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
}

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export function normalizePhone(value?: string) {
  if (!value) return '';
  const compact = value.trim().replace(/[\s.()-]/g, '');
  return compact.startsWith('+')
    ? `+${compact.slice(1).replace(/\D/g, '')}`
    : compact.replace(/\D/g, '');
}

function normalizeCode(value?: string) {
  return value?.trim().toLocaleUpperCase('vi') ?? '';
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('vi');
}

function buildAuditLog(
  id: string,
  actorUid: string,
  action: string,
  customerId: string,
  summary: string,
  createdAt: number,
): AuditLog {
  return { id, actorUid, action, entityType: 'customer', entityId: customerId, summary, createdAt };
}

async function assertUniqueCode(code: string, excludeId?: string) {
  const database = requireDatabase();
  const snapshot = await get(query(ref(database, 'customers'), orderByChild('code'), equalTo(code)));
  if (!snapshot.exists()) return;

  const duplicate = Object.entries(snapshot.val() as Record<string, Customer>)
    .some(([key, customer]) => (customer.id || key) !== excludeId);

  if (duplicate) throw new Error(`Mã khách hàng “${code}” đã được sử dụng.`);
}

export function subscribeCustomers(
  onCustomers: (customers: Customer[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireDatabase();
  return onValue(
    ref(database, 'customers'),
    (snapshot) => {
      if (!snapshot.exists()) {
        onCustomers([]);
        return;
      }
      const raw = snapshot.val() as Record<string, Customer>;
      const customers = Object.entries(raw)
        .map(([key, customer]) => ({ ...customer, id: customer.id || key }))
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.name.localeCompare(b.name, 'vi');
        });
      onCustomers(customers);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải khách hàng.')),
  );
}

export function findCustomerOptions(customers: Customer[], search: string, limit = 20) {
  const needle = normalizeSearch(search);
  return customers
    .filter((customer) => customer.active)
    .filter((customer) => {
      if (!needle) return true;
      return [customer.code, customer.name, customer.phone ?? '', customer.email ?? '']
        .some((value) => normalizeSearch(value).includes(needle));
    })
    .slice(0, limit);
}

export async function createCustomer(input: CustomerInput, actorUid: string): Promise<Customer> {
  const database = requireDatabase();
  const customerKey = push(ref(database, 'customers')).key;
  const auditKey = push(ref(database, 'auditLogs')).key;
  if (!customerKey || !auditKey) throw new Error('Không thể tạo mã nội bộ cho khách hàng.');

  const code = normalizeCode(input.code) || `KH-${customerKey.slice(-6).toLocaleUpperCase('vi')}`;
  await assertUniqueCode(code);

  const now = Date.now();
  const phone = normalizePhone(input.phone);
  const customer: Customer = {
    id: customerKey,
    code,
    name: input.name.trim(),
    active: true,
    createdAt: now,
    updatedAt: now,
    ...(phone ? { phone } : {}),
    ...(cleanOptional(input.email) ? { email: cleanOptional(input.email) } : {}),
    ...(cleanOptional(input.address) ? { address: cleanOptional(input.address) } : {}),
    ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
  };

  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    'CUSTOMER_CREATED',
    customerKey,
    `Tạo khách hàng ${customer.code} - ${customer.name}`,
    now,
  );

  await update(ref(database), {
    [`customers/${customerKey}`]: customer,
    [`auditLogs/${auditKey}`]: auditLog,
  });
  invalidateReferenceCache('customers');
  return customer;
}

export async function updateCustomer(
  existing: Customer,
  input: CustomerInput,
  actorUid: string,
): Promise<Customer> {
  const database = requireDatabase();
  const auditKey = push(ref(database, 'auditLogs')).key;
  if (!auditKey) throw new Error('Không thể tạo nhật ký thay đổi khách hàng.');

  const code = normalizeCode(input.code) || existing.code;
  await assertUniqueCode(code, existing.id);

  const now = Date.now();
  const phone = normalizePhone(input.phone);
  const customer: Customer = {
    id: existing.id,
    code,
    name: input.name.trim(),
    active: existing.active,
    createdAt: existing.createdAt,
    updatedAt: now,
    ...(phone ? { phone } : {}),
    ...(cleanOptional(input.email) ? { email: cleanOptional(input.email) } : {}),
    ...(cleanOptional(input.address) ? { address: cleanOptional(input.address) } : {}),
    ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
  };

  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    'CUSTOMER_UPDATED',
    existing.id,
    `Sửa khách hàng ${customer.code} - ${customer.name}`,
    now,
  );

  await update(ref(database), {
    [`customers/${existing.id}`]: customer,
    [`auditLogs/${auditKey}`]: auditLog,
  });
  invalidateReferenceCache('customers');
  return customer;
}

export async function setCustomerActive(customer: Customer, active: boolean, actorUid: string) {
  const database = requireDatabase();
  const auditKey = push(ref(database, 'auditLogs')).key;
  if (!auditKey) throw new Error('Không thể tạo nhật ký thay đổi trạng thái khách hàng.');

  const now = Date.now();
  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    active ? 'CUSTOMER_REACTIVATED' : 'CUSTOMER_DEACTIVATED',
    customer.id,
    `${active ? 'Kích hoạt lại' : 'Ngừng sử dụng'} khách hàng ${customer.code} - ${customer.name}`,
    now,
  );

  await update(ref(database), {
    [`customers/${customer.id}/active`]: active,
    [`customers/${customer.id}/updatedAt`]: now,
    [`auditLogs/${auditKey}`]: auditLog,
  });
  invalidateReferenceCache('customers');
}

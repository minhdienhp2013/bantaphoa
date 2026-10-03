import { equalTo, get, onValue, orderByChild, push, query, ref, update, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import { invalidateReferenceCache } from '../../shared/data/referenceDataCache';
import type { AuditLog, Supplier } from '../../types/models';

export interface SupplierInput {
  code?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  taxCode?: string;
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

export function normalizeSupplierPhone(value?: string) {
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
  supplierId: string,
  summary: string,
  createdAt: number,
): AuditLog {
  return { id, actorUid, action, entityType: 'supplier', entityId: supplierId, summary, createdAt };
}

async function assertUniqueCode(code: string, excludeId?: string) {
  const database = requireDatabase();
  const snapshot = await get(query(ref(database, 'suppliers'), orderByChild('code'), equalTo(code)));
  if (!snapshot.exists()) return;

  const duplicate = Object.entries(snapshot.val() as Record<string, Supplier>)
    .some(([key, supplier]) => (supplier.id || key) !== excludeId);

  if (duplicate) throw new Error(`Mã nhà cung cấp “${code}” đã được sử dụng.`);
}

export function subscribeSuppliers(
  onSuppliers: (suppliers: Supplier[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireDatabase();
  return onValue(
    ref(database, 'suppliers'),
    (snapshot) => {
      if (!snapshot.exists()) {
        onSuppliers([]);
        return;
      }
      const raw = snapshot.val() as Record<string, Supplier>;
      const suppliers = Object.entries(raw)
        .map(([key, supplier]) => ({ ...supplier, id: supplier.id || key }))
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.name.localeCompare(b.name, 'vi');
        });
      onSuppliers(suppliers);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải nhà cung cấp.')),
  );
}

export function findSupplierOptions(suppliers: Supplier[], search: string, limit = 20) {
  const needle = normalizeSearch(search);
  return suppliers
    .filter((supplier) => supplier.active)
    .filter((supplier) => {
      if (!needle) return true;
      return [supplier.code, supplier.name, supplier.phone ?? '', supplier.email ?? '', supplier.taxCode ?? '']
        .some((value) => normalizeSearch(value).includes(needle));
    })
    .slice(0, limit);
}

export async function createSupplier(input: SupplierInput, actorUid: string): Promise<Supplier> {
  const database = requireDatabase();
  const supplierKey = push(ref(database, 'suppliers')).key;
  const auditKey = push(ref(database, 'auditLogs')).key;
  if (!supplierKey || !auditKey) throw new Error('Không thể tạo mã nội bộ cho nhà cung cấp.');

  const code = normalizeCode(input.code) || `NCC-${supplierKey.slice(-6).toLocaleUpperCase('vi')}`;
  await assertUniqueCode(code);

  const now = Date.now();
  const phone = normalizeSupplierPhone(input.phone);
  const supplier: Supplier = {
    id: supplierKey,
    code,
    name: input.name.trim(),
    active: true,
    createdAt: now,
    updatedAt: now,
    ...(phone ? { phone } : {}),
    ...(cleanOptional(input.email) ? { email: cleanOptional(input.email) } : {}),
    ...(cleanOptional(input.address) ? { address: cleanOptional(input.address) } : {}),
    ...(cleanOptional(input.taxCode) ? { taxCode: cleanOptional(input.taxCode) } : {}),
    ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
  };

  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    'SUPPLIER_CREATED',
    supplierKey,
    `Tạo nhà cung cấp ${supplier.code} - ${supplier.name}`,
    now,
  );

  await update(ref(database), {
    [`suppliers/${supplierKey}`]: supplier,
    [`auditLogs/${auditKey}`]: auditLog,
  });
  invalidateReferenceCache('suppliers');
  return supplier;
}

export async function updateSupplier(
  existing: Supplier,
  input: SupplierInput,
  actorUid: string,
): Promise<Supplier> {
  const database = requireDatabase();
  const auditKey = push(ref(database, 'auditLogs')).key;
  if (!auditKey) throw new Error('Không thể tạo nhật ký thay đổi nhà cung cấp.');

  const code = normalizeCode(input.code) || existing.code;
  await assertUniqueCode(code, existing.id);

  const now = Date.now();
  const phone = normalizeSupplierPhone(input.phone);
  const supplier: Supplier = {
    id: existing.id,
    code,
    name: input.name.trim(),
    active: existing.active,
    createdAt: existing.createdAt,
    updatedAt: now,
    ...(phone ? { phone } : {}),
    ...(cleanOptional(input.email) ? { email: cleanOptional(input.email) } : {}),
    ...(cleanOptional(input.address) ? { address: cleanOptional(input.address) } : {}),
    ...(cleanOptional(input.taxCode) ? { taxCode: cleanOptional(input.taxCode) } : {}),
    ...(cleanOptional(input.note) ? { note: cleanOptional(input.note) } : {}),
  };

  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    'SUPPLIER_UPDATED',
    existing.id,
    `Sửa nhà cung cấp ${supplier.code} - ${supplier.name}`,
    now,
  );

  await update(ref(database), {
    [`suppliers/${existing.id}`]: supplier,
    [`auditLogs/${auditKey}`]: auditLog,
  });
  invalidateReferenceCache('suppliers');
  return supplier;
}

export async function setSupplierActive(supplier: Supplier, active: boolean, actorUid: string) {
  const database = requireDatabase();
  const auditKey = push(ref(database, 'auditLogs')).key;
  if (!auditKey) throw new Error('Không thể tạo nhật ký thay đổi trạng thái nhà cung cấp.');

  const now = Date.now();
  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    active ? 'SUPPLIER_REACTIVATED' : 'SUPPLIER_DEACTIVATED',
    supplier.id,
    `${active ? 'Kích hoạt lại' : 'Ngừng sử dụng'} nhà cung cấp ${supplier.code} - ${supplier.name}`,
    now,
  );

  await update(ref(database), {
    [`suppliers/${supplier.id}/active`]: active,
    [`suppliers/${supplier.id}/updatedAt`]: now,
    [`auditLogs/${auditKey}`]: auditLog,
  });
  invalidateReferenceCache('suppliers');
}

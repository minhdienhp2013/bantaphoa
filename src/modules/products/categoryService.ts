import { get, onValue, push, ref, update, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import type { AuditLog, Category } from '../../types/models';

export interface CategoryInput {
  name: string;
  active: boolean;
}

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function normalizeCategoryName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeCategoryKey(value: string) {
  return normalizeCategoryName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLocaleLowerCase('vi');
}

async function assertUniqueCategoryName(name: string, excludeId?: string) {
  const snapshot = await get(ref(requireDatabase(), 'categories'));
  const raw = (snapshot.val() ?? {}) as Record<string, Category>;
  const key = normalizeCategoryKey(name);
  const duplicate = Object.entries(raw).some(([id, category]) => {
    const categoryId = category.id || id;
    return categoryId !== excludeId && normalizeCategoryKey(category.name || '') === key;
  });
  if (duplicate) throw new Error(`Danh mục “${name}” đã tồn tại.`);
}

function buildAuditLog(
  id: string,
  actorUid: string,
  action: string,
  categoryId: string,
  summary: string,
  createdAt: number,
): AuditLog {
  return { id, actorUid, action, entityType: 'category', entityId: categoryId, summary, createdAt };
}

export function subscribeCategories(
  onData: (categories: Category[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'categories'),
    (snapshot) => {
      const raw = (snapshot.val() ?? {}) as Record<string, Category>;
      const categories = Object.entries(raw)
        .map(([id, category]) => ({ ...category, id: category.id || id }))
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.name.localeCompare(b.name, 'vi');
        });
      onData(categories);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải danh mục hàng hóa.')),
  );
}

export async function createCategory(input: CategoryInput, actorUid: string): Promise<Category> {
  const name = normalizeCategoryName(input.name);
  if (!name) throw new Error('Tên danh mục là bắt buộc.');
  await assertUniqueCategoryName(name);

  const database = requireDatabase();
  const id = push(ref(database, 'categories')).key;
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!id || !auditId) throw new Error('Không thể tạo mã danh mục.');

  const now = Date.now();
  const category: Category = { id, name, active: input.active, createdAt: now, updatedAt: now };
  const audit = buildAuditLog(auditId, actorUid, 'CATEGORY_CREATED', id, `Tạo danh mục ${name}`, now);
  await update(ref(database), {
    [`categories/${id}`]: category,
    [`auditLogs/${auditId}`]: audit,
  });
  return category;
}

export async function updateCategory(category: Category, input: CategoryInput, actorUid: string): Promise<Category> {
  const name = normalizeCategoryName(input.name);
  if (!name) throw new Error('Tên danh mục là bắt buộc.');
  await assertUniqueCategoryName(name, category.id);

  const database = requireDatabase();
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký danh mục.');

  const now = Date.now();
  const next: Category = { ...category, name, active: input.active, updatedAt: now };
  const audit = buildAuditLog(
    auditId,
    actorUid,
    'CATEGORY_UPDATED',
    category.id,
    `Sửa danh mục ${category.name} → ${name}`,
    now,
  );
  await update(ref(database), {
    [`categories/${category.id}/name`]: name,
    [`categories/${category.id}/active`]: input.active,
    [`categories/${category.id}/updatedAt`]: now,
    [`auditLogs/${auditId}`]: audit,
  });
  return next;
}

import { push, ref, update } from 'firebase/database';
import { db } from '../../firebase/client';
import { invalidateReferenceCache } from '../../shared/data/referenceDataCache';
import type { AuditLog, Product } from '../../types/models';
import type { ProductInput } from './productService';

const IMPORT_BATCH_SIZE = 200;

function requireDatabase() {
  if (!db) {
    throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  }
  return db;
}

function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function buildProduct(id: string, input: ProductInput, now: number): Product {
  return {
    id,
    sku: input.sku.trim(),
    name: input.name.trim(),
    costPrice: Math.round(input.costPrice),
    salePrice: Math.round(input.salePrice),
    stockQuantity: 0,
    stockVersion: 0,
    active: input.active,
    createdAt: now,
    updatedAt: now,
    ...(cleanOptional(input.barcode) ? { barcode: cleanOptional(input.barcode) } : {}),
    ...(cleanOptional(input.qrCode) ? { qrCode: cleanOptional(input.qrCode) } : {}),
    ...(cleanOptional(input.categoryId) ? { categoryId: cleanOptional(input.categoryId) } : {}),
    ...(Array.isArray(input.aliases) && input.aliases.length > 0 ? { aliases: [...input.aliases] } : {}),
    ...(cleanOptional(input.unit) ? { unit: cleanOptional(input.unit) } : {}),
    ...(typeof input.minStock === 'number' ? { minStock: input.minStock } : {}),
  };
}

export async function importProductsFromExcel(
  inputs: ProductInput[],
  actorUid: string,
): Promise<number> {
  const database = requireDatabase();
  let imported = 0;

  for (let offset = 0; offset < inputs.length; offset += IMPORT_BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + IMPORT_BATCH_SIZE);
    const updates: Record<string, Product | AuditLog> = {};
    const now = Date.now();

    for (const input of batch) {
      const productKey = push(ref(database, 'products')).key;
      if (!productKey) {
        throw new Error('Không thể tạo mã nội bộ cho sản phẩm import.');
      }
      updates[`products/${productKey}`] = buildProduct(productKey, input, now);
    }

    const auditKey = push(ref(database, 'auditLogs')).key;
    if (!auditKey) {
      throw new Error('Không thể tạo nhật ký import Excel.');
    }

    const auditLog: AuditLog = {
      id: auditKey,
      actorUid,
      action: 'PRODUCTS_EXCEL_IMPORTED',
      entityType: 'product_import',
      summary: `Import ${batch.length} sản phẩm từ Excel`,
      createdAt: now,
    };
    updates[`auditLogs/${auditKey}`] = auditLog;

    await update(ref(database), updates);
    invalidateReferenceCache('products');
    imported += batch.length;
  }

  return imported;
}
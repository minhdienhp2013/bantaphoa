import { normalizeSearchCode } from '../../shared/search/searchNormalization';
import {
  PURCHASE_DRAFT_VERSION,
  type PurchaseDraft,
  type PurchaseDraftLine,
} from './purchaseDraft';
import type { PurchaseExcelImportRow } from './purchaseExcelImport';
import type { PurchaseExcelCreateProgress } from './purchaseExcelImportWorkflow';

function productKey(row: PurchaseExcelImportRow) {
  return normalizeSearchCode(row.effectiveSku);
}

export function buildPurchaseDraftFromExcel(input: {
  rows: readonly PurchaseExcelImportRow[];
  selectedNewRowNumbers: ReadonlySet<number>;
  progress: PurchaseExcelCreateProgress;
  supplierId?: string;
  supplierName?: string;
}): PurchaseDraft {
  if (input.rows.some((row) => row.status === 'REVIEW' || row.status === 'ERROR')) {
    throw new Error('Còn dòng Cần kiểm tra/Lỗi. Hãy sửa file trước khi đưa vào phiếu nhập.');
  }

  const merged = new Map<string, PurchaseDraftLine>();
  for (const row of input.rows) {
    if (row.status !== 'MATCHED' && row.status !== 'NEW') continue;
    if (row.status === 'NEW' && !input.selectedNewRowNumbers.has(row.rowNumber)) continue;
    if (typeof row.quantity !== 'number' || row.quantity <= 0 || typeof row.unitCost !== 'number' || row.unitCost < 0) {
      throw new Error(`Dòng ${row.rowNumber} không có số lượng/giá nhập hợp lệ.`);
    }

    let productId = row.matchedProductId;
    if (row.status === 'NEW') {
      const key = productKey(row);
      productId = input.progress.createdProductsBySku[key]?.id;
      if (!productId) throw new Error(`Hàng mới dòng ${row.rowNumber} chưa được tạo thành công.`);
    }
    if (!productId) throw new Error(`Không xác định được Product cho dòng ${row.rowNumber}.`);

    const mergeKey = `${productId}\u0000${row.unitCost}`;
    const current = merged.get(mergeKey);
    if (current) current.quantity += row.quantity;
    else merged.set(mergeKey, { productId, quantity: row.quantity, unitCost: row.unitCost });
  }

  const lines = [...merged.values()];
  if (lines.length === 0) throw new Error('Không có dòng hợp lệ nào được chọn để đưa vào phiếu nhập.');

  return {
    version: PURCHASE_DRAFT_VERSION,
    supplierId: input.supplierId ?? '',
    supplierName: input.supplierName ?? '',
    note: '',
    lines,
  };
}

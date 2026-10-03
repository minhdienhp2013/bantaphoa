import type { Product, StocktakeItem } from '../../types/models';
import { roundStockQuantity } from '../inventory/stockOperationCas';

export type StocktakeApplyMode = 'replace' | 'add';

export interface StocktakeApplyChange {
  productId: string;
  quantityDelta: number;
  expectedQuantityBefore: number;
}


export function getStocktakeApplyModeLabel(mode: StocktakeApplyMode) {
  return mode === 'replace' ? 'Thay thế số lượng tồn' : 'Cộng dồn số lượng kiểm kê';
}

export function buildStocktakeApplyChanges(
  items: readonly StocktakeItem[],
  products: readonly Product[],
  mode: StocktakeApplyMode,
): StocktakeApplyChange[] {
  const productById = new Map(products.map((product) => [product.id, product]));

  return items.flatMap((item) => {
    const product = productById.get(item.productId);
    if (!product) throw new Error(`Không tìm thấy sản phẩm ${item.productId}.`);

    const currentQuantity = roundStockQuantity(Number(product.stockQuantity) || 0);
    const actualQuantity = roundStockQuantity(Number(item.actualQuantity));

    if (!Number.isFinite(actualQuantity) || actualQuantity < 0) {
      throw new Error(`Số lượng kiểm kê của ${product.sku} - ${product.name} không hợp lệ.`);
    }

    const quantityDelta = mode === 'replace'
      ? roundStockQuantity(actualQuantity - currentQuantity)
      : actualQuantity;

    if (quantityDelta === 0) return [];

    return [{
      productId: item.productId,
      quantityDelta,
      expectedQuantityBefore: currentQuantity,
    }];
  });
}

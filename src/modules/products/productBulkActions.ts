import type { Product } from '../../types/models';

export interface BulkDeactivateFailure {
  productId: string;
  message: string;
}

export interface BulkDeactivateResult {
  selected: number;
  targeted: number;
  deactivated: number;
  skippedInactive: number;
  failures: BulkDeactivateFailure[];
}

export async function deactivateSelectedProducts(
  selectedProducts: readonly Product[],
  deactivate: (product: Product) => Promise<void>,
): Promise<BulkDeactivateResult> {
  const activeProducts = selectedProducts.filter((product) => product.active);
  const failures: BulkDeactivateFailure[] = [];
  let deactivated = 0;

  for (const product of activeProducts) {
    try {
      await deactivate(product);
      deactivated += 1;
    } catch (error) {
      failures.push({
        productId: product.id,
        message: error instanceof Error ? error.message : 'Không thể cập nhật sản phẩm.',
      });
    }
  }

  return {
    selected: selectedProducts.length,
    targeted: activeProducts.length,
    deactivated,
    skippedInactive: selectedProducts.length - activeProducts.length,
    failures,
  };
}

import type { Category, Product } from '../../types/models';
import {
  matchesPreparedSearchFields,
  prepareSharedSearchQuery,
} from '../../shared/search/searchMatching';

export type GoodsActiveFilter = 'all' | 'active' | 'inactive';
export type GoodsStockFilter = 'all' | 'in-stock' | 'low' | 'out';
export type GoodsCategoryFilter = 'all' | 'uncategorized' | string;
export type GoodsStockStatus = 'inactive' | 'out' | 'low' | 'in-stock';

export function getGoodsStockStatus(product: Product): GoodsStockStatus {
  if (!product.active) return 'inactive';
  if (Number(product.stockQuantity) <= 0) return 'out';
  if (Number(product.stockQuantity) === 1) return 'low';
  return 'in-stock';
}

export function getGoodsStatusLabel(product: Product) {
  const status = getGoodsStockStatus(product);
  if (status === 'inactive') return 'Ngừng KD';
  if (status === 'out') return 'Hết hàng';
  if (status === 'low') return 'Sắp hết';
  return 'Còn hàng';
}

export function filterGoodsProducts(
  products: Product[],
  query: string,
  activeFilter: GoodsActiveFilter,
  stockFilter: GoodsStockFilter,
  categoryFilter: GoodsCategoryFilter = 'all',
  categories: readonly Category[] = [],
) {
  const preparedQuery = prepareSharedSearchQuery(query);

  return products.filter((product) => {
    if (activeFilter === 'active' && !product.active) return false;
    if (activeFilter === 'inactive' && product.active) return false;

    const stockStatus = getGoodsStockStatus(product);
    if (stockFilter !== 'all' && stockStatus !== stockFilter) return false;
    if (categoryFilter === 'uncategorized' && product.categoryId) return false;
    if (categoryFilter !== 'all' && categoryFilter !== 'uncategorized' && product.categoryId !== categoryFilter) return false;

    const categoryName = product.categoryId ? categories.find((category) => category.id === product.categoryId)?.name : undefined;
    return matchesPreparedSearchFields({
      text: [product.name, ...(product.aliases ?? []), categoryName],
      codes: [product.sku, product.barcode, product.qrCode],
    }, preparedQuery);
  });
}

export function computeGoodsStats(products: Product[]) {
  const active = products.filter((product) => product.active).length;
  const inactive = products.length - active;
  const out = products.filter(
    (product) => product.active && Number(product.stockQuantity) <= 0,
  ).length;
  const low = products.filter(
    (product) => product.active && Number(product.stockQuantity) === 1,
  ).length;

  return { total: products.length, active, inactive, low, out };
}

export function formatGoodsMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatGoodsQuantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}
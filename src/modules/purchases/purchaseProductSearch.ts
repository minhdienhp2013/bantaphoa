import type { Product } from '../../types/models';
import {
  searchProducts,
  type ProductSearchMatchKind,
  type ProductSearchResult,
  type SearchAliases,
} from '../../shared/search/productSearch';

export type PurchaseProductMatchKind = ProductSearchMatchKind;
export type PurchaseProductSearchResult = ProductSearchResult;

export function searchPurchaseProducts(
  products: readonly Product[],
  query: string,
  aliases?: SearchAliases,
  limit = 10,
): PurchaseProductSearchResult[] {
  return searchProducts(
    products.filter((product) => product.active),
    query,
    { aliases, limit },
  );
}

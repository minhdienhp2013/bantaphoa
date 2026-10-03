import { searchProducts, type ProductSearchMatchKind } from '../../shared/search/productSearch';
import type { Category, Product } from '../../types/models';
import { parseSalesChatQuery, type SalesChatIntent } from './salesChatParser';

export interface SalesChatCandidate {
  product: Product;
  matchKind: ProductSearchMatchKind;
}

export interface SalesChatResult {
  query: string;
  message: string;
  intent: SalesChatIntent;
  candidates: SalesChatCandidate[];
  fuzzySuggestion: boolean;
}

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)} ₫`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

export function answerSalesChatProduct(product: Product, intent: SalesChatIntent) {
  const stock = Number(product.stockQuantity) || 0;
  const unit = product.unit?.trim() || 'sản phẩm';

  if (intent === 'stockQuantity') {
    return stock > 0
      ? `${product.name} còn ${formatQuantity(stock)} ${unit}.`
      : `${product.name} hiện đã hết hàng.`;
  }
  if (intent === 'availability') {
    return stock > 0
      ? `${product.name} hiện còn hàng (${formatQuantity(stock)} ${unit}).`
      : `${product.name} hiện đã hết hàng.`;
  }
  if (intent === 'price') {
    return `${product.name} — Giá bán: ${formatMoney(Number(product.salePrice) || 0)}`;
  }

  return `${product.name} — Giá ${formatMoney(Number(product.salePrice) || 0)} · ${stock > 0 ? `Tồn ${formatQuantity(stock)} ${unit}` : 'Hết hàng'}.`;
}

export function runSalesChat(products: readonly Product[], query: string, categories: readonly Category[] = []): SalesChatResult {
  const parsed = parseSalesChatQuery(query);
  if (!parsed.productQuery) {
    return {
      query: query.trim(),
      message: 'Hãy nhập tên hoặc mã sản phẩm cần hỏi.',
      intent: parsed.intent,
      candidates: [],
      fuzzySuggestion: false,
    };
  }

  const activeProducts = products.filter((product) => product.active === true);
  const eligibleProducts = parsed.intent === 'listInStock'
    ? activeProducts.filter((product) => Number(product.stockQuantity) > 0)
    : activeProducts;
  const matches = searchProducts(eligibleProducts, parsed.productQuery, {
    limit: 12,
    categories,
    ...(parsed.salePrice ? { salePrice: parsed.salePrice } : {}),
  });
  const candidates = matches.map(({ product, kind }) => ({ product, matchKind: kind }));
  const fuzzySuggestion = matches.some(({ kind }) => kind === 'fuzzy-name' || kind === 'fuzzy-alias');

  if (matches.length === 0) {
    return {
      query: query.trim(),
      message: 'Không tìm thấy sản phẩm phù hợp.',
      intent: parsed.intent,
      candidates: [],
      fuzzySuggestion: false,
    };
  }

  if (matches.length === 1 && !fuzzySuggestion) {
    return {
      query: query.trim(),
      message: answerSalesChatProduct(matches[0].product, parsed.intent),
      intent: parsed.intent,
      candidates: [],
      fuzzySuggestion: false,
    };
  }

  return {
    query: query.trim(),
    message: fuzzySuggestion
      ? `Tìm thấy ${matches.length} gợi ý gần. Hãy chọn sản phẩm cần xem.`
      : `Tìm thấy ${matches.length} sản phẩm phù hợp. Hãy chọn sản phẩm cần xem.`,
    intent: parsed.intent,
    candidates,
    fuzzySuggestion,
  };
}
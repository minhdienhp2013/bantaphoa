const DEFAULT_PROXY_URL = (import.meta.env?.VITE_SALES_AI_PROXY_URL ?? '').trim();
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_QUERY_LENGTH = 500;

export interface MarketPriceSource {
  title: string;
  url: string;
  price: number;
}

export interface MarketPriceComparison {
  productName: string;
  localPrice: number;
  marketMin: number | null;
  marketMax: number | null;
  marketMedian: number | null;
  sampleCount: number;
  deltaAmount: number | null;
  deltaPercent: number | null;
  position: 'below' | 'near' | 'above' | 'unknown';
  sources: MarketPriceSource[];
}

export type MarketPriceFailure =
  | 'unconfigured'
  | 'unauthorized'
  | 'payment-required'
  | 'rate-limited'
  | 'search-unavailable'
  | 'server-error'
  | 'http-error'
  | 'timeout'
  | 'offline'
  | 'invalid-response';

export type MarketPriceResult =
  | { ok: true; comparison: MarketPriceComparison }
  | { ok: false; reason: MarketPriceFailure };

interface MarketPriceRequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  getIdToken?: () => Promise<string | null>;
}

function mapHttpFailure(status: number): MarketPriceFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'payment-required';
  if (status === 429) return 'rate-limited';
  if (status === 424) return 'search-unavailable';
  if (status >= 500) return 'server-error';
  return 'http-error';
}

function finiteMoney(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0;
}

function nullableMoney(value: unknown): value is number | null {
  return value === null || finiteMoney(value);
}

function parseMarketPriceComparison(value: unknown): MarketPriceComparison | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.productName !== 'string' || !raw.productName.trim() || raw.productName.length > 200) return null;
  if (!finiteMoney(raw.localPrice)) return null;
  const marketMin = raw.marketMin;
  const marketMax = raw.marketMax;
  const marketMedian = raw.marketMedian;
  const sampleCount = raw.sampleCount;
  const deltaAmount = raw.deltaAmount;
  const deltaPercent = raw.deltaPercent;

  if (!nullableMoney(marketMin) || !nullableMoney(marketMax) || !nullableMoney(marketMedian)) return null;
  if (typeof sampleCount !== 'number' || !Number.isInteger(sampleCount) || sampleCount < 0 || sampleCount > 20) return null;
  if (!nullableMoney(deltaAmount)) return null;
  if (
    deltaPercent !== null
    && (typeof deltaPercent !== 'number' || !Number.isFinite(deltaPercent))
  ) return null;

  const positions = new Set(['below', 'near', 'above', 'unknown']);
  if (typeof raw.position !== 'string' || !positions.has(raw.position)) return null;
  if (!Array.isArray(raw.sources) || raw.sources.length > 10) return null;

  const sources: MarketPriceSource[] = [];
  for (const source of raw.sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const item = source as Record<string, unknown>;
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300) return null;
    if (typeof item.url !== 'string' || !/^https?:\/\//iu.test(item.url) || item.url.length > 2000) return null;
    if (!finiteMoney(item.price)) return null;
    sources.push({
      title: item.title.trim(),
      url: item.url,
      price: item.price,
    });
  }

  return {
    productName: raw.productName.trim(),
    localPrice: raw.localPrice,
    marketMin,
    marketMax,
    marketMedian,
    sampleCount,
    deltaAmount,
    deltaPercent,
    position: raw.position as MarketPriceComparison['position'],
    sources,
  };
}

export async function requestMarketPriceComparison(
  query: string,
  product: { name: string; salePrice: number },
  options: MarketPriceRequestOptions = {},
): Promise<MarketPriceResult> {
  const cleanedQuery = query.replace(/\s+/gu, ' ').trim();
  const productName = product.name.replace(/\s+/gu, ' ').trim();
  const localPrice = Math.round(Number(product.salePrice));

  if (
    !cleanedQuery
    || cleanedQuery.length > MAX_QUERY_LENGTH
    || !productName
    || productName.length > 200
    || !Number.isFinite(localPrice)
    || localPrice < 0
  ) {
    return { ok: false, reason: 'invalid-response' };
  }

  const baseEndpoint = (options.endpoint ?? DEFAULT_PROXY_URL).trim().replace(/\/+$/u, '');
  if (!baseEndpoint) return { ok: false, reason: 'unconfigured' };
  const endpoint = `${baseEndpoint}/market-price`;

  let idToken: string | null = null;
  try {
    idToken = options.getIdToken ? await options.getIdToken() : null;
  } catch {
    return { ok: false, reason: 'unauthorized' };
  }
  if (!idToken) return { ok: false, reason: 'unauthorized' };

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.set('Authorization', `Bearer ${idToken}`);

    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        query: cleanedQuery,
        product: {
          name: productName,
          salePrice: localPrice,
        },
      }),
    });

    if (!response.ok) return { ok: false, reason: mapHttpFailure(response.status) };

    const payload = await response.json() as { comparison?: unknown };
    const comparison = parseMarketPriceComparison(payload.comparison);
    return comparison
      ? { ok: true, comparison }
      : { ok: false, reason: 'invalid-response' };
  } catch (error) {
    if (
      (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
      || (error instanceof Error && error.name === 'AbortError')
    ) {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'offline' };
  } finally {
    clearTimeout(timeoutId);
  }
}

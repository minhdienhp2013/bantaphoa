import { parseDeepSeekQuickAskHints, type DeepSeekQuickAskHints } from './deepSeekQuickAskSchema';

const DEFAULT_PROXY_URL = (import.meta.env?.VITE_SALES_AI_PROXY_URL ?? '').trim();
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_QUERY_LENGTH = 500;

export type DeepSeekQuickAskFailure =
  | 'unconfigured'
  | 'unauthorized'
  | 'payment-required'
  | 'rate-limited'
  | 'server-error'
  | 'http-error'
  | 'timeout'
  | 'offline'
  | 'invalid-response';

export type DeepSeekQuickAskResult =
  | { ok: true; hints: DeepSeekQuickAskHints }
  | { ok: false; reason: DeepSeekQuickAskFailure };

interface DeepSeekQuickAskRequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  getIdToken?: () => Promise<string | null>;
}

function mapHttpFailure(status: number): DeepSeekQuickAskFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'payment-required';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server-error';
  return 'http-error';
}

export async function requestDeepSeekQuickAsk(
  query: string,
  options: DeepSeekQuickAskRequestOptions = {},
): Promise<DeepSeekQuickAskResult> {
  const cleanedQuery = query.replace(/\s+/gu, ' ').trim();
  if (!cleanedQuery || cleanedQuery.length > MAX_QUERY_LENGTH) {
    return { ok: false, reason: 'invalid-response' };
  }

  const endpoint = (options.endpoint ?? DEFAULT_PROXY_URL).trim();
  if (!endpoint) return { ok: false, reason: 'unconfigured' };

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
      body: JSON.stringify({ query: cleanedQuery }),
    });

    if (!response.ok) return { ok: false, reason: mapHttpFailure(response.status) };

    const payload = await response.json() as { result?: unknown };
    const hints = parseDeepSeekQuickAskHints(payload.result);
    return hints
      ? { ok: true, hints }
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

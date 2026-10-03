const DEFAULT_PROXY_URL = (import.meta.env?.VITE_SALES_AI_PROXY_URL ?? '').trim();
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_QUERY_LENGTH = 1_000;
const MAX_HISTORY_ITEMS = 6;
const MAX_HISTORY_TEXT_LENGTH = 1_200;

export interface BusinessAssistantHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface BusinessAssistantSource {
  id: number;
  title: string;
  url: string;
  domain: string;
  published?: string;
  snippet?: string;
}

export interface BusinessAssistantAnswer {
  answer: string;
  usedTools: string[];
  dataScopes: string[];
  internetUsed: boolean;
  sources: BusinessAssistantSource[];
  asOf: number;
}

export type BusinessAssistantFailure =
  | 'unconfigured'
  | 'unauthorized'
  | 'forbidden'
  | 'payment-required'
  | 'rate-limited'
  | 'server-error'
  | 'http-error'
  | 'worker-outdated'
  | 'business-data-unavailable'
  | 'invalid-request'
  | 'timeout'
  | 'offline'
  | 'invalid-response';

export type BusinessAssistantResult =
  | { ok: true; result: BusinessAssistantAnswer }
  | { ok: false; reason: BusinessAssistantFailure };

interface RequestBusinessAssistantOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
  getIdToken?: () => Promise<string | null>;
}

function mapHttpFailure(status: number, errorCode = ''): BusinessAssistantFailure {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 402) return 'payment-required';
  if (status === 404) return 'worker-outdated';
  if (status === 429) return 'rate-limited';
  if (status === 424 && errorCode === 'business-data-unavailable') return 'business-data-unavailable';
  if (status === 400 && errorCode === 'invalid-request') return 'invalid-request';
  if (status >= 500) return 'server-error';
  return 'http-error';
}

function cleanHistory(history: readonly BusinessAssistantHistoryItem[]) {
  return history
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => ({
      role: item.role,
      content: item.content.replace(/\s+/gu, ' ').trim().slice(0, MAX_HISTORY_TEXT_LENGTH),
    }))
    .filter((item) => item.content);
}

function parseAnswer(value: unknown): BusinessAssistantAnswer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.answer !== 'string' || !raw.answer.trim() || raw.answer.length > 20_000) return null;
  if (!Array.isArray(raw.usedTools) || !raw.usedTools.every((item) => typeof item === 'string')) return null;
  if (!Array.isArray(raw.dataScopes) || !raw.dataScopes.every((item) => typeof item === 'string')) return null;
  if (typeof raw.internetUsed !== 'boolean') return null;

  // Compatibility with the Phase 1 Worker, which returned no `sources` field
  // for internal-only answers. This prevents a Pages/Worker deployment skew
  // from discarding an otherwise valid DeepSeek answer.
  const rawSources = typeof raw.sources === 'undefined' && raw.internetUsed === false
    ? []
    : raw.sources;
  if (!Array.isArray(rawSources)) return null;

  const sources: BusinessAssistantSource[] = [];
  for (const source of rawSources.slice(0, 12)) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const item = source as Record<string, unknown>;
    if (
      typeof item.id !== 'number'
      || !Number.isInteger(item.id)
      || item.id <= 0
      || typeof item.title !== 'string'
      || !item.title.trim()
      || typeof item.url !== 'string'
      || !/^https?:\/\//iu.test(item.url)
      || typeof item.domain !== 'string'
    ) return null;

    sources.push({
      id: item.id,
      title: item.title.trim().slice(0, 300),
      url: item.url,
      domain: item.domain.trim().slice(0, 160),
      ...(typeof item.published === 'string' && item.published.trim()
        ? { published: item.published.trim().slice(0, 100) }
        : {}),
      ...(typeof item.snippet === 'string' && item.snippet.trim()
        ? { snippet: item.snippet.trim().slice(0, 900) }
        : {}),
    });
  }

  if (raw.internetUsed && sources.length === 0) return null;
  if (!raw.internetUsed && sources.length > 0) return null;
  if (typeof raw.asOf !== 'number' || !Number.isFinite(raw.asOf)) return null;
  return {
    answer: raw.answer.trim(),
    usedTools: raw.usedTools.slice(0, 10),
    dataScopes: raw.dataScopes.slice(0, 10),
    internetUsed: raw.internetUsed,
    sources,
    asOf: raw.asOf,
  };
}

export async function requestBusinessAssistant(
  query: string,
  history: readonly BusinessAssistantHistoryItem[],
  options: RequestBusinessAssistantOptions = {},
): Promise<BusinessAssistantResult> {
  const cleanedQuery = query.replace(/\s+/gu, ' ').trim();
  if (!cleanedQuery || cleanedQuery.length > MAX_QUERY_LENGTH) {
    return { ok: false, reason: 'invalid-response' };
  }

  const baseEndpoint = (options.endpoint ?? DEFAULT_PROXY_URL).trim().replace(/\/+$/u, '');
  if (!baseEndpoint) return { ok: false, reason: 'unconfigured' };
  const endpoint = `${baseEndpoint}/business-assistant`;

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
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        query: cleanedQuery,
        history: cleanHistory(history),
      }),
    });

    if (!response.ok) {
      let errorCode = '';
      try {
        const errorPayload = await response.json() as { error?: unknown };
        if (typeof errorPayload.error === 'string') errorCode = errorPayload.error;
      } catch {
        // Older Worker versions may return a non-JSON 404/405 body.
      }
      return { ok: false, reason: mapHttpFailure(response.status, errorCode) };
    }
    const payload = await response.json() as { result?: unknown };
    const result = parseAnswer(payload.result);
    return result
      ? { ok: true, result }
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

export function businessAssistantFailureMessage(reason: BusinessAssistantFailure) {
  switch (reason) {
    case 'unconfigured':
      return 'Trợ lý AI chưa được cấu hình địa chỉ Worker.';
    case 'unauthorized':
      return 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.';
    case 'forbidden':
      return 'Trợ lý kinh doanh hiện chỉ dành cho Chủ cửa hàng.';
    case 'payment-required':
      return 'Tài khoản DeepSeek hiện không đủ số dư.';
    case 'rate-limited':
      return 'Đang có quá nhiều yêu cầu AI. Vui lòng thử lại sau ít phút.';
    case 'timeout':
      return 'DeepSeek phản hồi quá lâu. Vui lòng thử lại.';
    case 'offline':
      return 'Không thể kết nối tới trợ lý AI.';
    case 'server-error':
      return 'Dịch vụ trợ lý AI đang tạm thời không sẵn sàng.';
    case 'worker-outdated':
      return 'Cloudflare Worker AI chưa được cập nhật tính năng Trợ lý kinh doanh. Cần deploy Worker mới rồi thử lại.';
    case 'business-data-unavailable':
      return 'Trợ lý AI đã kết nối nhưng không đọc được dữ liệu kinh doanh cần thiết từ Firebase.';
    case 'invalid-request':
      return 'Câu hỏi gửi tới Trợ lý AI không hợp lệ. Vui lòng nhập lại câu hỏi.';
    case 'http-error':
      return 'Cloudflare Worker đã từ chối yêu cầu Trợ lý AI. Cần kiểm tra phiên bản Worker đang chạy.';
    case 'invalid-response':
      return 'DeepSeek đã phản hồi nhưng dữ liệu trả về không đúng định dạng mà Trợ lý yêu cầu.';
    default:
      return 'Không thể xử lý câu hỏi này. Vui lòng thử lại.';
  }
}

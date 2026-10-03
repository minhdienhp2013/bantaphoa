import { parseFrogQuickAskHints, type FrogQuickAskHints } from './localFrogSchema';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'frog-sales';
const DEFAULT_TIMEOUT_MS = 12500;
const DEFAULT_KEEP_ALIVE = '30m';

export type LocalFrogFailure =
  | 'offline'
  | 'timeout'
  | 'http-error'
  | 'invalid-response';

export type LocalFrogResult =
  | { ok: true; hints: FrogQuickAskHints }
  | { ok: false; reason: LocalFrogFailure };

interface LocalFrogRequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  endpoint?: string;
}

function buildPrompt(query: string) {
  return [
    'Bạn là bộ phân tích câu hỏi bán hàng tiếng Việt.',
    'Chỉ trả JSON đúng schema, không trả lời giá/tồn kho và không bịa dữ liệu sản phẩm.',
    'Schema:',
    '{"intent":"SEARCH_PRODUCT|CHECK_PRICE|CHECK_STOCK|ADD_TO_CART|OTHER","productQuery":"string","sizeHint":"string|null","colorHint":"string|null","quantity":"number|null"}',
    'Quy tắc:',
    '- BẮT BUỘC trả đủ 5 field: intent, productQuery, sizeHint, colorHint, quantity.',
    '- Nếu không có sizeHint, colorHint hoặc quantity thì phải trả null; không được bỏ field.',
    '- Giữ nguyên tên thường gọi, SKU và từ viết tắt; không tự sửa chính tả tên sản phẩm.',
    '- productQuery chỉ chứa phần tên/mã sản phẩm cần tìm; không nhét kích thước, màu sắc hoặc từ hỏi vào nếu đã tách thành hint.',
    '- Có thể chuẩn hóa cách nói kích thước, ví dụ "mét sáu" thành "1m6", nhưng chỉ đặt trong sizeHint.',
    '- Không tạo productId, giá, tồn kho hoặc availability.',
    '- quantity chỉ dùng khi người dùng yêu cầu số lượng cụ thể để thêm vào hóa đơn.',
    'Ví dụ:',
    'Câu hỏi: "đệm đối san mét sáu còn không"',
    'Trả: {"intent":"CHECK_STOCK","productQuery":"đệm đối san","sizeHint":"1m6","colorHint":null,"quantity":null}',
    `Câu hỏi: ${JSON.stringify(query)}`,
  ].join('\n');
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function requestLocalFrog(
  query: string,
  options: LocalFrogRequestOptions = {},
): Promise<LocalFrogResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${options.endpoint ?? DEFAULT_OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        prompt: buildPrompt(query),
        stream: false,
        format: 'json',
        keep_alive: DEFAULT_KEEP_ALIVE,
        options: { temperature: 0 },
      }),
    });

    if (!response.ok) return { ok: false, reason: 'http-error' };

    const payload = await response.json() as { response?: unknown };
    if (typeof payload.response !== 'string') return { ok: false, reason: 'invalid-response' };

    const hints = parseFrogQuickAskHints(safeJsonParse(payload.response));
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

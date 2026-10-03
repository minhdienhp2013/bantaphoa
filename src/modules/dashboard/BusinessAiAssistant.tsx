import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import {
  businessAssistantFailureMessage,
  requestBusinessAssistant,
  type BusinessAssistantHistoryItem,
  type BusinessAssistantSource,
} from './businessAssistantClient';

interface BusinessAiAssistantProps {
  open: boolean;
  onClose: () => void;
}

interface ChatMessage extends BusinessAssistantHistoryItem {
  id: string;
  meta?: {
    scopes: string[];
    tools: string[];
    internetUsed: boolean;
    sources: BusinessAssistantSource[];
    asOf: number;
  };
}

const SUGGESTIONS = [
  'Tình hình kinh doanh tháng này thế nào?',
  'Mặt hàng nào bán tốt nhất 30 ngày qua?',
  'Mặt hàng nào đang bán chậm nhưng còn tồn?',
  'Tôi nên ưu tiên nhập thêm hàng gì?',
  'Tóm tắt chi phí và lợi nhuận tháng này.',
  'Tình hình công nợ và khoản vay hiện tại thế nào?',
  'Tìm trên Internet xu hướng thị trường hiện tại và so sánh với dữ liệu cửa hàng.',
];

function makeMessage(role: ChatMessage['role'], content: string, meta?: ChatMessage['meta']): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    ...(meta ? { meta } : {}),
  };
}

function formatDateTime(timestamp: number) {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(timestamp);
  } catch {
    return '';
  }
}

export default function BusinessAiAssistant({ open, onClose }: BusinessAiAssistantProps) {
  const { appUser, firebaseUser } = useAuth();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => inputRef.current?.focus());

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open]);

  if (!open || appUser?.role !== 'owner') return null;

  async function sendQuestion(question = draft) {
    const query = question.replace(/\s+/gu, ' ').trim();
    if (!query || sending || !firebaseUser) return;

    const userMessage = makeMessage('user', query);
    const history = messages
      .slice(-6)
      .map(({ role, content }) => ({ role, content }));

    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setSending(true);
    setError('');

    const result = await requestBusinessAssistant(query, history, {
      getIdToken: () => firebaseUser.getIdToken(),
    });

    if (result.ok) {
      setMessages((current) => [
        ...current,
        makeMessage('assistant', result.result.answer, {
          scopes: result.result.dataScopes,
          tools: result.result.usedTools,
          internetUsed: result.result.internetUsed,
          sources: result.result.sources,
          asOf: result.result.asOf,
        }),
      ]);
    } else {
      setError(businessAssistantFailureMessage(result.reason));
    }
    setSending(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendQuestion();
    }
  }

  return (
    <div className="business-ai-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !sending) onClose();
    }}>
      <div
        ref={dialogRef}
        className="business-ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="business-ai-title"
      >
        <header className="business-ai-header">
          <div>
            <p className="dashboard-kicker">DEEPSEEK • DỮ LIỆU CỬA HÀNG</p>
            <h2 id="business-ai-title">Trợ lý kinh doanh AI</h2>
            <p>Chỉ đọc và phân tích. Không được tự sửa giá, tồn kho, đơn hàng hay dữ liệu tài chính.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="business-ai-close"
            onClick={onClose}
            aria-label="Đóng Trợ lý kinh doanh AI"
          >
            ×
          </button>
        </header>

        <div ref={scrollRef} className="business-ai-thread" aria-live="polite">
          {messages.length === 0 ? (
            <div className="business-ai-welcome">
              <strong>Tôi có thể phân tích dữ liệu kinh doanh thật trong phần mềm.</strong>
              <p>
                Mỗi câu hỏi chỉ lấy các phần dữ liệu cần thiết để giảm token. Khi câu hỏi cần thông tin thị trường
                hiện tại, trợ lý có thể tìm Internet và hiển thị nguồn để bạn kiểm tra.
              </p>
              <div className="business-ai-suggestions" aria-label="Câu hỏi gợi ý">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    disabled={sending}
                    onClick={() => void sendQuestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <article
              key={message.id}
              className={`business-ai-message business-ai-message--${message.role}`}
            >
              <div className="business-ai-message__label">
                {message.role === 'user' ? 'Bạn' : 'Trợ lý AI'}
              </div>
              <div className="business-ai-message__content">{message.content}</div>
              {message.role === 'assistant' && message.meta ? (
                <>
                  <div className="business-ai-message__meta">
                    <span>Dữ liệu: {message.meta.scopes.length ? message.meta.scopes.join(' · ') : 'Không có dữ liệu nội bộ'}</span>
                    <span>Cập nhật: {formatDateTime(message.meta.asOf)}</span>
                    <span>
                      Internet: {message.meta.internetUsed
                        ? `${message.meta.sources.length} nguồn`
                        : 'không sử dụng'}
                    </span>
                  </div>
                  {message.meta.sources.length ? (
                    <div className="business-ai-sources" aria-label="Nguồn Internet đã sử dụng">
                      <strong>Nguồn Internet</strong>
                      <ol>
                        {message.meta.sources.map((source) => (
                          <li key={`${source.id}:${source.url}`}>
                            <a href={source.url} target="_blank" rel="noopener noreferrer">
                              <span>[Nguồn {source.id}] {source.title}</span>
                              <small>
                                {source.domain || 'Website'}
                                {source.published ? ` · ${source.published}` : ''}
                              </small>
                            </a>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                </>
              ) : null}
            </article>
          ))}

          {sending ? (
            <article className="business-ai-message business-ai-message--assistant">
              <div className="business-ai-message__label">Trợ lý AI</div>
              <div className="business-ai-thinking" role="status">
                Đang chọn dữ liệu cần thiết, tìm nguồn nếu cần và phân tích…
              </div>
            </article>
          ) : null}
        </div>

        {error ? (
          <div className="business-ai-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError('')}>Đóng</button>
          </div>
        ) : null}

        <footer className="business-ai-composer">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 1000))}
            onKeyDown={handleComposerKeyDown}
            placeholder="Hỏi về doanh thu, lợi nhuận, tồn kho, đơn hàng, nhập hàng, công nợ…"
            rows={2}
            disabled={sending}
            aria-label="Nhập câu hỏi cho Trợ lý kinh doanh AI"
          />
          <button
            type="button"
            className="business-ai-send"
            disabled={sending || !draft.trim()}
            onClick={() => void sendQuestion()}
          >
            {sending ? 'Đang phân tích…' : 'Gửi'}
          </button>
          <small>
            Số liệu nội bộ phải lấy từ ứng dụng. Thông tin Internet phải có nguồn; nếu không đủ dữ liệu, AI phải nói rõ thay vì tự đoán.
          </small>
        </footer>
      </div>
    </div>
  );
}

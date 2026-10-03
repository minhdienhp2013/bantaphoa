import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '../../shared/ui/dialog';
import {
  createApprovedSalesAiLearningComponentManual,
  getSalesAiLearningMetricsForOwner,
  listSalesAiLearningComponentsForOwner,
  listSalesAiLearningMappingsForOwner,
  promoteSalesAiLearningAlias,
  resetSalesAiLearningComponent,
  resetSalesAiLearningMapping,
  setSalesAiLearningComponentStatus,
  setSalesAiLearningMappingStatus,
  updateSalesAiLearningPromotedAlias,
  type SalesAiLearningComponentMapping,
  type SalesAiLearningMetrics,
  type SalesAiLearningOwnerMapping,
} from '../sales/salesAiLearningService';

interface SalesAiLearningPanelProps {
  actorUid: string;
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function formatMs(value: number | null) {
  if (value === null) return '—';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function withUiTimeout<T>(promise: Promise<T>, timeoutMs = 10000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Firebase không phản hồi sau 10 giây. Hãy kiểm tra mạng rồi thử lại.'));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export default function SalesAiLearningPanel({ actorUid }: SalesAiLearningPanelProps) {
  const [mappings, setMappings] = useState<SalesAiLearningOwnerMapping[]>([]);
  const [components, setComponents] = useState<SalesAiLearningComponentMapping[]>([]);
  const [metrics, setMetrics] = useState<SalesAiLearningMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [promotedAliasesOpen, setPromotedAliasesOpen] = useState(false);
  const [editingAliasKey, setEditingAliasKey] = useState('');
  const [aliasDraft, setAliasDraft] = useState('');
  const [manualPhoneticSource, setManualPhoneticSource] = useState('');
  const [manualPhoneticTarget, setManualPhoneticTarget] = useState('');
  const [manualPhoneticError, setManualPhoneticError] = useState('');
  const [manualPhoneticMessage, setManualPhoneticMessage] = useState('');

  const reloadLists = useCallback(async () => {
    const [nextMappings, nextComponents] = await Promise.all([
      listSalesAiLearningMappingsForOwner(),
      listSalesAiLearningComponentsForOwner(),
    ]);
    setMappings(nextMappings);
    setComponents(nextComponents);
  }, []);

  const reloadMetrics = useCallback(async () => {
    const nextMetrics = await getSalesAiLearningMetricsForOwner(30);
    setMetrics(nextMetrics);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([
        reloadLists(),
        reloadMetrics(),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu Sales AI Learning.');
    } finally {
      setLoading(false);
    }
  }, [reloadLists, reloadMetrics]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runAction(
    key: string,
    action: () => Promise<void>,
    success: string,
    onActionError?: (message: string) => void,
  ) {
    if (busyKey) return false;
    setBusyKey(key);
    setError('');
    setMessage('');

    try {
      await withUiTimeout(action());
      setMessage(success);

      // The write has already succeeded. Never keep the action button spinning
      // while secondary reads refresh the screen.
      setBusyKey('');

      void withUiTimeout(reloadLists(), 8000).catch((cause) => {
        setError(cause instanceof Error
          ? `Đã lưu nhưng chưa tải lại danh sách: ${cause.message}`
          : 'Đã lưu nhưng chưa tải lại được danh sách.');
      });

      void withUiTimeout(reloadMetrics(), 8000).catch(() => {
        // Metrics are secondary and must not affect a successful owner action.
      });

      return true;
    } catch (cause) {
      const errorMessage = cause instanceof Error ? cause.message : 'Không thể cập nhật Sales AI Learning.';
      setError(errorMessage);
      onActionError?.(errorMessage);
      return false;
    } finally {
      setBusyKey('');
    }
  }

  const promotedMappings = mappings.filter((mapping) => Boolean(mapping.aliasPromotedAt));
  const activeMappings = mappings.filter((mapping) => !mapping.aliasPromotedAt);

  function renderMappingRow(mapping: SalesAiLearningOwnerMapping, promoted = false) {
    const currentAlias = mapping.promotedAlias || mapping.exampleQuery;
    const editingAlias = promoted && editingAliasKey === mapping.key;

    return (
      <article key={mapping.key} className="settings-ai-learning-row">
        <div>
          <strong>“{mapping.exampleQuery}”</strong>
          <span>Signature: {mapping.normalizedSignature}</span>
          <span>
            Target: {mapping.topProductName || mapping.topProductId || 'chưa rõ'} ·
            confidence {Math.round(mapping.topConfidence * 100)}% ·
            {mapping.productCount} Product
          </span>
          <span>Trạng thái: {mapping.status}</span>
          {promoted && mapping.aliasPromotedAt ? (
            <>
              <span>Alias hiện tại: “{currentAlias}”</span>
              <span>
                Đã chuyển vào alias lúc {new Intl.DateTimeFormat('vi-VN', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(mapping.aliasPromotedAt)}
              </span>
            </>
          ) : null}
        </div>
        <div className="settings-ai-learning-actions">
          {mapping.topProductId ? (
            <button
              type="button"
              disabled={Boolean(busyKey)}
              onClick={() => void runAction(
                `approve:${mapping.key}`,
                () => setSalesAiLearningMappingStatus(mapping.key, 'approved', actorUid, mapping.topProductId),
                'Đã duyệt mapping.',
              )}
            >
              Duyệt
            </button>
          ) : null}
          <button
            type="button"
            disabled={Boolean(busyKey)}
            onClick={() => void runAction(
              `disable:${mapping.key}`,
              () => setSalesAiLearningMappingStatus(mapping.key, 'disabled', actorUid),
              'Đã tắt mapping.',
            )}
          >
            Disable
          </button>
          {mapping.status === 'approved' && mapping.approvedProductId ? (
            <button
              type="button"
              disabled={Boolean(busyKey) || Boolean(mapping.aliasPromotedAt)}
              onClick={() => void runAction(
                `alias:${mapping.key}`,
                () => promoteSalesAiLearningAlias(mapping.key, actorUid),
                'Đã thêm cách gọi vào Product.aliases.',
              )}
            >
              {mapping.aliasPromotedAt ? 'Đã thành alias' : 'Thêm vào alias'}
            </button>
          ) : null}
          {promoted ? (
            <button
              type="button"
              disabled={Boolean(busyKey)}
              onClick={() => {
                setEditingAliasKey(mapping.key);
                setAliasDraft(currentAlias);
              }}
            >
              Sửa alias
            </button>
          ) : null}
          <button
            type="button"
            disabled={Boolean(busyKey)}
            onClick={() => {
              if (!window.confirm(promoted
                ? 'Reset evidence của mapping này? Alias đã thêm vào Product vẫn được giữ lại.'
                : 'Reset toàn bộ evidence của mapping này?')) return;
              void runAction(
                `reset:${mapping.key}`,
                () => resetSalesAiLearningMapping(mapping.key),
                'Đã reset mapping.',
              );
            }}
          >
            Reset
          </button>
        </div>

        {editingAlias ? (
          <div className="settings-ai-alias-editor" role="group" aria-label={`Sửa alias cho ${mapping.topProductName || mapping.topProductId || 'Product'}`}>
            <label>
              Alias
              <input
                value={aliasDraft}
                onChange={(event) => setAliasDraft(event.target.value)}
                disabled={Boolean(busyKey)}
                autoFocus
              />
            </label>
            <div>
              <button
                type="button"
                disabled={Boolean(busyKey)}
                onClick={() => {
                  setEditingAliasKey('');
                  setAliasDraft('');
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={Boolean(busyKey) || !aliasDraft.trim()}
                onClick={() => {
                  void runAction(
                    `edit-alias:${mapping.key}`,
                    () => updateSalesAiLearningPromotedAlias(mapping.key, aliasDraft, actorUid),
                    'Đã cập nhật alias.',
                  ).then((updated) => {
                    if (!updated) return;
                    setEditingAliasKey('');
                    setAliasDraft('');
                  });
                }}
              >
                Lưu alias
              </button>
            </div>
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <section className="settings-card settings-ai-learning" aria-labelledby="sales-ai-learning-heading">
      <div className="settings-card__heading">
        <div>
          <p className="eyebrow">SALES AI LEARNING</p>
          <h2 id="sales-ai-learning-heading">Cách gọi hàng đã học</h2>
          <p className="muted">
            Learning chỉ hỗ trợ nhận diện Product. Giá bán và tồn kho luôn đọc từ Product hiện tại.
            Một lần bấm không tự trở thành alias vĩnh viễn.
          </p>
        </div>
        <button type="button" className="button" disabled={loading} onClick={() => void reload()}>
          {loading ? 'Đang tải…' : 'Làm mới'}
        </button>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="settings-success" role="status">{message}</p> : null}

      {metrics ? (
        <div className="settings-ai-metrics" aria-label="Chỉ số Sales AI 30 ngày">
          <div><span>Quick Ask</span><strong>{metrics.totalQuickAsk}</strong></div>
          <div><span>Top-1</span><strong>{formatPercent(metrics.top1Accuracy)}</strong></div>
          <div><span>Top-3</span><strong>{formatPercent(metrics.top3Accuracy)}</strong></div>
          <div><span>DeepSeek call</span><strong>{formatPercent(metrics.deepSeekCallRate)}</strong></div>
          <div><span>Phonetic local</span><strong>{formatPercent(metrics.phoneticResolverHitRate)}</strong></div>
          <div><span>Learned hit</span><strong>{formatPercent(metrics.learnedMappingHitRate)}</strong></div>
          <div><span>Manual search</span><strong>{formatPercent(metrics.manualSearchRate)}</strong></div>
          <div><span>Ambiguous</span><strong>{formatPercent(metrics.ambiguousQueryRate)}</strong></div>
          <div><span>Thời gian tìm</span><strong>{formatMs(metrics.averageTimeToProductMs)}</strong></div>
        </div>
      ) : null}

      <div className="settings-ai-learning__section">
        <div className="settings-ai-learning__section-heading">
          <div>
            <h3>Query / Product mappings</h3>
            <p className="muted">
              Duyệt chỉ khi cách gọi và Product đích đúng. Mapping đã chuyển thành alias được ẩn khỏi danh sách này.
            </p>
          </div>
          {!loading && promotedMappings.length > 0 ? (
            <button
              type="button"
              className="button button--secondary settings-ai-promoted-button"
              onClick={() => setPromotedAliasesOpen(true)}
            >
              Đã chuyển vào Alias ({promotedMappings.length})
            </button>
          ) : null}
        </div>
        {loading ? <p className="muted">Đang tải mapping…</p> : activeMappings.length === 0 ? (
          <p className="muted">
            {promotedMappings.length > 0
              ? 'Không còn mapping chờ xử lý. Mapping đã chuyển vào alias nằm trong nút phía trên.'
              : 'Chưa có mapping đủ dữ liệu.'}
          </p>
        ) : (
          <div className="settings-ai-learning-list">
            {activeMappings.slice(0, 20).map((mapping) => renderMappingRow(mapping))}
          </div>
        )}
      </div>

      <Dialog
        open={promotedAliasesOpen}
        title={`Đã chuyển vào Alias (${promotedMappings.length})`}
        onClose={() => {
          setPromotedAliasesOpen(false);
          setEditingAliasKey('');
          setAliasDraft('');
        }}
        savingLock={Boolean(busyKey)}
      >
        <div className="settings-ai-promoted-dialog">
          <p className="muted">
            Đây là các Query / Product mapping đã được chuyển thành Product.aliases nên mặc định không còn xuất hiện trong danh sách chính.
            Bạn vẫn có thể xem trạng thái, sửa trực tiếp alias, duyệt lại, disable hoặc reset mapping tại đây.
          </p>
          {promotedMappings.length === 0 ? (
            <p className="muted">Chưa có mapping nào đã chuyển vào alias.</p>
          ) : (
            <div className="settings-ai-learning-list settings-ai-promoted-list">
              {promotedMappings.map((mapping) => renderMappingRow(mapping, true))}
            </div>
          )}
        </div>
      </Dialog>

      <div className="settings-ai-learning__section">
        <h3>Phonetic component mappings</h3>
        <p className="muted">
          Ví dụ một cụm Speech-to-Text gần âm với token thật trong catalog. Mapping thủ công được Owner thêm sẽ được duyệt ngay và resolver có thể dùng ngay.
        </p>

        <form
          className="settings-ai-phonetic-manual"
          onSubmit={(event) => {
            event.preventDefault();
            const source = manualPhoneticSource.trim();
            const target = manualPhoneticTarget.trim();
            if (!source || !target || busyKey) return;

            setManualPhoneticError('');
            setManualPhoneticMessage('');

            void runAction(
              'component-manual',
              () => createApprovedSalesAiLearningComponentManual(source, target, actorUid),
              'Đã thêm và duyệt phonetic mapping thủ công.',
              setManualPhoneticError,
            ).then((created) => {
              if (!created) return;
              setManualPhoneticSource('');
              setManualPhoneticTarget('');
              setManualPhoneticMessage(`Đã thêm và duyệt: ${source} → ${target}`);
            });
          }}
        >
          <div className="settings-ai-phonetic-manual__heading">
            <strong>Thêm thủ công</strong>
            <span>Nhập đúng cặp máy nghe sai → từ/mã đúng trong catalog.</span>
          </div>

          <label>
            Máy thường nghe sai
            <input
              value={manualPhoneticSource}
              onChange={(event) => setManualPhoneticSource(event.target.value)}
              placeholder="Ví dụ: test ca 5 lăm"
              disabled={Boolean(busyKey)}
              autoComplete="off"
            />
          </label>

          <span className="settings-ai-phonetic-arrow" aria-hidden="true">→</span>

          <label>
            Từ / mã đúng
            <input
              value={manualPhoneticTarget}
              onChange={(event) => setManualPhoneticTarget(event.target.value)}
              placeholder="Ví dụ: k55"
              disabled={Boolean(busyKey)}
              autoComplete="off"
            />
          </label>

          <button
            type="submit"
            className="button button--primary"
            disabled={Boolean(busyKey) || !manualPhoneticSource.trim() || !manualPhoneticTarget.trim()}
          >
            {busyKey === 'component-manual' ? 'Đang thêm…' : 'Thêm & duyệt'}
          </button>
        </form>
        {manualPhoneticError ? (
          <p className="form-error settings-ai-phonetic-feedback" role="alert">
            {manualPhoneticError}
          </p>
        ) : null}
        {manualPhoneticMessage ? (
          <p className="settings-success settings-ai-phonetic-feedback" role="status">
            {manualPhoneticMessage}
          </p>
        ) : null}
        {loading ? <p className="muted">Đang tải phonetic mapping…</p> : components.length === 0 ? (
          <p className="muted">Chưa có component mapping.</p>
        ) : (
          <div className="settings-ai-learning-list">
            {components.slice(0, 20).map((component) => (
              <article key={component.id} className="settings-ai-learning-row">
                <div>
                  <strong>{component.source} → {component.target}</strong>
                  <span>
                    positive {component.positiveCount} · strong {component.strongPositiveCount} ·
                    negative {component.negativeCount} · correction {component.correctionCount}
                  </span>
                  <span>Trạng thái: {component.status}</span>
                </div>
                <div className="settings-ai-learning-actions">
                  <button
                    type="button"
                    disabled={Boolean(busyKey)}
                    onClick={() => void runAction(
                      `component-approve:${component.id}`,
                      () => setSalesAiLearningComponentStatus(component.id, 'approved', actorUid),
                      'Đã duyệt cách đọc gần âm.',
                    )}
                  >
                    Duyệt
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyKey)}
                    onClick={() => void runAction(
                      `component-disable:${component.id}`,
                      () => setSalesAiLearningComponentStatus(component.id, 'disabled', actorUid),
                      'Đã disable cách đọc gần âm.',
                    )}
                  >
                    Disable
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyKey)}
                    onClick={() => {
                      if (!window.confirm('Xóa toàn bộ evidence của component mapping này?')) return;
                      void runAction(
                        `component-reset:${component.id}`,
                        () => resetSalesAiLearningComponent(component.id),
                        'Đã reset component mapping.',
                      );
                    }}
                  >
                    Reset
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

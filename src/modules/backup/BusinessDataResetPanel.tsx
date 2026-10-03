import { useEffect, useRef, useState } from 'react';
import {
  BUSINESS_DATA_RESET_CONFIRMATION_PHRASE,
  BUSINESS_DATA_RESET_DELETE_NODES,
  BUSINESS_DATA_RESET_RETAINED_NODES,
  isBusinessDataResetConfirmation,
} from './businessDataResetContract';
import { resetBusinessData } from './businessDataResetService';
import { downloadBackupJson } from './backupService';

interface BusinessDataResetPanelProps {
  actorUid: string;
}

const FINAL_WARNING =
  'Thao tác này sẽ xóa vĩnh viễn toàn bộ hàng hóa và lịch sử giao dịch.\n\n' +
  'Không thể hoàn tác bằng giao diện hiện tại.\n\n' +
  'Hệ thống sẽ tạo file backup trước khi xóa, nhưng chức năng phục hồi tự động từ file backup hiện chưa được hỗ trợ.\n\n' +
  'Bạn có chắc chắn muốn tiếp tục?';

export default function BusinessDataResetPanel({ actorUid }: BusinessDataResetPanelProps) {
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const runningRef = useRef(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [backupCreated, setBackupCreated] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [focusSuccess, setFocusSuccess] = useState(false);

  const phraseMatches = isBusinessDataResetConfirmation(confirmation);

  useEffect(() => {
    if (!focusSuccess || !success) return;
    successRef.current?.focus();
    setFocusSuccess(false);
  }, [focusSuccess, success]);

  async function handleReset() {
    if (busy || runningRef.current || !phraseMatches) return;
    const confirmed = window.confirm(FINAL_WARNING);
    if (!confirmed) {
      requestAnimationFrame(() => resetButtonRef.current?.focus());
      return;
    }

    runningRef.current = true;
    setBusy(true);
    setBackupCreated(false);
    setError('');
    setSuccess('');
    let completed = false;

    try {
      await resetBusinessData(actorUid, (backup) => {
        downloadBackupJson(backup);
        setBackupCreated(true);
      });
      setConfirmation('');
      setSuccess('Đã xóa toàn bộ dữ liệu hàng hóa và giao dịch.');
      setFocusSuccess(true);
      completed = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reset dữ liệu thất bại. Không báo thành công.');
    } finally {
      runningRef.current = false;
      setBusy(false);
      if (!completed) {
        requestAnimationFrame(() => resetButtonRef.current?.focus());
      }
    }
  }

  return (
    <section className="danger-zone" aria-labelledby="business-reset-heading">
      <div className="danger-zone__heading">
        <div>
          <p className="eyebrow">KHU VỰC NGUY HIỂM</p>
          <h2 id="business-reset-heading">Xóa toàn bộ dữ liệu hàng hóa & giao dịch</h2>
          <p>
            Đây là <strong>hard reset</strong>. Hệ thống sẽ bắt buộc tạo backup JSON trước khi bắt đầu
            destructive reset.
          </p>
        </div>
      </div>

      <div className="danger-zone__grid">
        <div>
          <h3>Dữ liệu sẽ bị xóa</h3>
          <ul>
            {BUSINESS_DATA_RESET_DELETE_NODES.map((node) => <li key={node}>/{node}</li>)}
          </ul>
        </div>
        <div>
          <h3>Dữ liệu được giữ nguyên</h3>
          <ul>
            {BUSINESS_DATA_RESET_RETAINED_NODES.map((node) => <li key={node}>/{node}</li>)}
          </ul>
        </div>
      </div>

      <div className="danger-zone__confirmation">
        <label htmlFor="business-reset-confirmation">
          Nhập chính xác <strong>{BUSINESS_DATA_RESET_CONFIRMATION_PHRASE}</strong> để mở khóa nút reset
        </label>
        <input
          id="business-reset-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <button
          ref={resetButtonRef}
          className="button danger-zone__button"
          type="button"
          aria-disabled={busy || !phraseMatches}
          aria-busy={busy}
          onClick={() => void handleReset()}
        >
          {busy ? 'Đang backup và reset…' : 'Xóa toàn bộ dữ liệu hàng hóa & giao dịch'}
        </button>
      </div>

      {backupCreated ? (
        <p className="form-success" role="status">Đã tạo bản sao lưu trước khi xóa.</p>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {success ? (
        <p ref={successRef} className="form-success" role="status" tabIndex={-1}>{success}</p>
      ) : null}

      <p className="danger-zone__note">
        Backup được tải xuống máy dưới dạng JSON. Chức năng restore write hiện vẫn bị khóa an toàn;
        màn này không hứa rằng file backup có thể được restore tự động từ trình duyệt.
      </p>
    </section>
  );
}

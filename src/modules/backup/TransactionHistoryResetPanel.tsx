import { useEffect, useRef, useState } from 'react';
import { downloadBackupJson } from './backupService';
import {
  TRANSACTION_HISTORY_RESET_CONFIRMATION_PHRASE,
  TRANSACTION_HISTORY_RESET_DELETE_NODES,
  TRANSACTION_HISTORY_RESET_FINANCE_NODES,
  TRANSACTION_HISTORY_RESET_RETAINED_NODES,
  isTransactionHistoryResetConfirmation,
} from './transactionHistoryResetContract';
import { resetTransactionHistory } from './transactionHistoryResetService';

interface TransactionHistoryResetPanelProps {
  actorUid: string;
}

function finalWarning(includeFinance: boolean) {
  const financeText = includeFinance
    ? '\n\nĐÃ BẬT lựa chọn xóa cả công nợ, lịch sử thanh toán công nợ và khoản vay.'
    : '\n\nCông nợ và khoản vay sẽ được GIỮ NGUYÊN.';
  return (
    'Thao tác này sẽ xóa vĩnh viễn lịch sử bán hàng, dịch vụ, nhập hàng, xuất kho, kiểm kê và nhật ký biến động kho.' +
    financeText +
    '\n\nSản phẩm, ảnh, giá, SKU/barcode/QR, nhóm hàng, khách hàng, nhà cung cấp và SỐ LƯỢNG TỒN HIỆN TẠI sẽ được giữ nguyên.' +
    '\n\nHệ thống bắt buộc tạo backup JSON trước khi xóa. Restore tự động từ file backup hiện vẫn chưa được hỗ trợ.' +
    '\n\nBạn có chắc chắn muốn tiếp tục?'
  );
}

export default function TransactionHistoryResetPanel({ actorUid }: TransactionHistoryResetPanelProps) {
  const resetButtonRef = useRef<HTMLButtonElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const runningRef = useRef(false);
  const [confirmation, setConfirmation] = useState('');
  const [includeFinance, setIncludeFinance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backupCreated, setBackupCreated] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [focusSuccess, setFocusSuccess] = useState(false);

  const phraseMatches = isTransactionHistoryResetConfirmation(confirmation);

  useEffect(() => {
    if (!focusSuccess || !success) return;
    successRef.current?.focus();
    setFocusSuccess(false);
  }, [focusSuccess, success]);

  async function handleReset() {
    if (busy || runningRef.current || !phraseMatches) return;
    const confirmed = window.confirm(finalWarning(includeFinance));
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
      const result = await resetTransactionHistory(
        actorUid,
        { includeFinance },
        (backup) => {
          downloadBackupJson(backup);
          setBackupCreated(true);
        },
      );
      setConfirmation('');
      setSuccess(
        result.includeFinance
          ? 'Đã reset lịch sử giao dịch và công nợ/khoản vay. Sản phẩm, ảnh và tồn hiện tại được giữ nguyên.'
          : 'Đã reset lịch sử giao dịch. Sản phẩm, ảnh, tồn hiện tại, công nợ và khoản vay được giữ nguyên.',
      );
      setFocusSuccess(true);
      completed = true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reset lịch sử giao dịch thất bại. Không báo thành công.');
    } finally {
      runningRef.current = false;
      setBusy(false);
      if (!completed) {
        requestAnimationFrame(() => resetButtonRef.current?.focus());
      }
    }
  }

  return (
    <section className="danger-zone transaction-reset-zone" aria-labelledby="transaction-reset-heading">
      <div className="danger-zone__heading">
        <div>
          <p className="eyebrow">BẮT ĐẦU KỲ DỮ LIỆU MỚI</p>
          <h2 id="transaction-reset-heading">Reset lịch sử giao dịch — giữ sản phẩm & tồn kho</h2>
          <p>
            Dùng khi muốn làm nhẹ dữ liệu sau nhiều năm. Danh mục hàng hóa và số lượng tồn hiện tại
            không bị xóa; ảnh sản phẩm vẫn giữ nguyên.
          </p>
        </div>
      </div>

      <div className="danger-zone__grid">
        <div>
          <h3>Mặc định sẽ xóa</h3>
          <ul>
            {TRANSACTION_HISTORY_RESET_DELETE_NODES.map((node) => <li key={node}>/{node}</li>)}
          </ul>
        </div>
        <div>
          <h3>Luôn giữ nguyên</h3>
          <ul>
            {TRANSACTION_HISTORY_RESET_RETAINED_NODES.map((node) => <li key={node}>/{node}</li>)}
          </ul>
          <p className="muted"><strong>/products</strong> giữ cả metadata ảnh và tồn hiện tại.</p>
        </div>
      </div>

      <label className="transaction-reset-finance-option">
        <input
          type="checkbox"
          checked={includeFinance}
          onChange={(event) => setIncludeFinance(event.target.checked)}
          disabled={busy}
        />
        <span>
          <strong>Xóa cả công nợ & khoản vay</strong>
          <small>
            Nếu bật, hệ thống xóa thêm {TRANSACTION_HISTORY_RESET_FINANCE_NODES.map((node) => `/${node}`).join(', ')}.
            Mặc định tùy chọn này tắt.
          </small>
        </span>
      </label>

      <div className="danger-zone__confirmation">
        <label htmlFor="transaction-reset-confirmation">
          Nhập chính xác <strong>{TRANSACTION_HISTORY_RESET_CONFIRMATION_PHRASE}</strong> để mở khóa nút reset
        </label>
        <input
          id="transaction-reset-confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <button
          ref={resetButtonRef}
          className="button danger-zone__button transaction-reset-button"
          type="button"
          aria-disabled={busy || !phraseMatches}
          aria-busy={busy}
          onClick={() => void handleReset()}
        >
          {busy ? 'Đang backup và reset giao dịch…' : 'Reset giao dịch — giữ sản phẩm & tồn kho'}
        </button>
      </div>

      {backupCreated ? <p className="form-success" role="status">Đã tạo bản sao lưu trước khi reset.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {success ? (
        <p ref={successRef} className="form-success" role="status" tabIndex={-1}>{success}</p>
      ) : null}

      <p className="danger-zone__note">
        Sau reset, stockQuantity và stockVersion hiện tại của sản phẩm được giữ nguyên. Lịch sử stockMovements/
        stockOperations cũ bị xóa, nhưng nghiệp vụ kho mới vẫn tiếp tục từ tồn và stockVersion hiện tại.
      </p>
    </section>
  );
}

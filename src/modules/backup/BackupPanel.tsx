import { useState } from 'react';
import type { BackupEnvelope } from '../../types/models';
import {
  createBackupEnvelope,
  downloadBackupJson,
  exportBusinessDataExcel,
  parseAndValidateBackup,
  previewRestore,
  restoreBackup,
  type RestoreMode,
  type RestorePreview,
} from './backupService';

interface BackupPanelProps { actorUid: string; }

function formatDate(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'medium' }).format(value);
}

export default function BackupPanel({ actorUid }: BackupPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [envelope, setEnvelope] = useState<BackupEnvelope | null>(null);
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');

  const run = async (task: () => Promise<void>) => {
    setBusy(true); setError(''); setSuccess('');
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Thao tác backup/restore thất bại.'); }
    finally { setBusy(false); }
  };

  const handleBackupJson = () => run(async () => {
    const backup = await createBackupEnvelope();
    downloadBackupJson(backup);
    setSuccess('Đã tạo file backup JSON schemaVersion 1. File không chứa mật khẩu/Auth secret/private key.');
  });

  const handleBusinessExcel = () => run(async () => {
    const backup = await createBackupEnvelope();
    exportBusinessDataExcel(backup);
    setSuccess('Đã xuất Excel dữ liệu chính. Các giá trị số được giữ ở dạng numeric cell.');
  });

  const handleFile = async (file?: File) => {
    setError(''); setSuccess(''); setPreview(null); setConfirmed(false); setConfirmationText('');
    if (!file) { setEnvelope(null); setFileName(''); return; }
    try {
      const parsed = parseAndValidateBackup(await file.text());
      setEnvelope(parsed); setFileName(file.name);
      setSuccess(`Đã đọc và validate ${file.name}. Chưa ghi dữ liệu nào.`);
    } catch (cause) {
      setEnvelope(null); setFileName(file.name);
      setError(cause instanceof Error ? cause.message : 'Không thể đọc file backup.');
    }
  };

  const handlePreview = () => run(async () => {
    if (!envelope) throw new Error('Hãy chọn file backup hợp lệ trước.');
    const next = await previewRestore(envelope, mode);
    setPreview(next);
    setSuccess('Đã tạo preview. Chưa ghi, xóa hoặc thay đổi dữ liệu nào.');
  });

  const handleRestore = () => run(async () => {
    if (!envelope || !preview) throw new Error('Cần preview trước khi restore.');
    if (!confirmed) throw new Error('Bạn chưa xác nhận rõ ràng thao tác restore.');
    await restoreBackup(envelope, mode, actorUid, confirmationText);
  });

  const restoreBlocked = Boolean(preview?.blockers.length);

  return (
    <section className="report-card backup-panel" aria-labelledby="backup-heading">
      <div className="report-section-heading">
        <div>
          <p className="eyebrow">BACK-001 / BACK-002 / BACK-003</p>
          <h2 id="backup-heading">Backup & khôi phục</h2>
          <p className="muted">Backup chạy phía trình duyệt, không bao gồm Auth password, credential hoặc private key.</p>
        </div>
      </div>

      <div className="report-actions">
        <button className="button button--primary report-touch" type="button" disabled={busy} onClick={() => void handleBackupJson()}>Tải backup JSON</button>
        <button className="button button--secondary report-touch" type="button" disabled={busy} onClick={() => void handleBusinessExcel()}>Xuất Excel dữ liệu chính</button>
      </div>

      <div className="backup-divider" />
      <h3>Khôi phục từ file</h3>
      <label className="report-field">
        File JSON backup
        <input type="file" accept="application/json,.json" disabled={busy} onChange={(event) => void handleFile(event.target.files?.[0])} />
      </label>
      {envelope ? (
        <p className="backup-meta"><strong>{fileName}</strong> · schemaVersion {envelope.schemaVersion} · xuất lúc {formatDate(envelope.exportedAt)}</p>
      ) : null}

      <div className="backup-mode-grid" role="radiogroup" aria-label="Chế độ restore">
        <label><input type="radio" name="restore-mode" value="merge" checked={mode === 'merge'} onChange={() => { setMode('merge'); setPreview(null); }} /> Merge — thêm/cập nhật, không silent delete</label>
        <label><input type="radio" name="restore-mode" value="replace" checked={mode === 'replace'} onChange={() => { setMode('replace'); setPreview(null); }} /> Replace — preview mọi dữ liệu dự kiến xóa trước</label>
      </div>

      <button className="button button--secondary report-touch" type="button" disabled={busy || !envelope} onClick={() => void handlePreview()}>Preview restore</button>

      {preview ? (
        <div className="backup-preview">
          <div className="backup-target">
            <strong>Đích đang cấu hình</strong>
            <span>Project: {preview.targetProjectId}</span>
            <span>Database: {preview.targetDatabaseUrl}</span>
          </div>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>Node</th><th>Backup</th><th>Hiện tại</th><th>Thêm</th><th>Sửa</th><th>Dự kiến xóa</th></tr></thead>
              <tbody>{preview.nodes.map((node) => (
                <tr key={node.key}><td>{node.key}</td><td>{node.backupCount}</td><td>{node.currentCount}</td><td>{node.inserts}</td><td>{node.updates}</td><td>{node.deletes}</td></tr>
              ))}</tbody>
            </table>
          </div>

          {preview.blockers.length ? (
            <div className="report-warning" role="alert">
              <strong>Restore đang bị chặn an toàn bởi Security Rules hiện tại.</strong>
              <ul>{preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
          ) : null}

          <div className="backup-confirm">
            <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Tôi đã kiểm tra project/database đích và preview merge/replace.</label>
            <label className="report-field">Nhập <strong>KHOI PHUC</strong> để xác nhận
              <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} autoComplete="off" />
            </label>
            <button className="button button--primary report-touch" type="button" disabled={busy || restoreBlocked || !confirmed || confirmationText !== 'KHOI PHUC'} onClick={() => void handleRestore()}>
              Ghi restore
            </button>
            {restoreBlocked ? <p className="muted">Nút ghi bị khóa; không có partial restore hoặc silent delete nào được thực hiện.</p> : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {success ? <p className="form-success" role="status">{success}</p> : null}
    </section>
  );
}

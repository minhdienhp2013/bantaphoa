import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useAuth } from '../../auth/AuthContext';
import type { Category, Product } from '../../types/models';
import { parseProductExcel, type ExcelProductImportResult } from './excelImport';
import {
  getExcelStockPreview,
  summarizeProductExcelImport,
  type ProductExcelDuplicateMode,
} from './productExcelImportPlan';
import {
  createEmptyProductExcelImportProgress,
  runProductExcelImport,
  type ProductExcelImportProgress,
  type ProductExcelImportRunResult,
} from './productExcelImportWorkflow';

interface ProductExcelImportPanelProps {
  products: Product[];
  categories: readonly Category[];
  actorUid: string;
  onClose: () => void;
}

function createImportSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDelta(delta: number) {
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

export default function ProductExcelImportPanel({
  products,
  categories,
  actorUid,
  onClose,
}: ProductExcelImportPanelProps) {
  const { appUser } = useAuth();
  const isOwner = appUser?.role === 'owner';
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ExcelProductImportResult | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<ProductExcelDuplicateMode>('skip');
  const [updateStock, setUpdateStock] = useState(false);
  const [sessionId, setSessionId] = useState(createImportSessionId);
  const [progress, setProgress] = useState<ProductExcelImportProgress>(createEmptyProductExcelImportProgress);
  const [optionsLocked, setOptionsLocked] = useState(false);
  const [runResult, setRunResult] = useState<ProductExcelImportRunResult | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const summary = useMemo(() => {
    if (!preview) {
      return {
        newCount: 0,
        duplicateCount: 0,
        conflictCount: 0,
        errorCount: 0,
        updateCount: 0,
        stockAdjustmentCount: 0,
        skippedCount: 0,
      };
    }
    return summarizeProductExcelImport(preview.rows, products, duplicateMode, updateStock);
  }, [preview, products, duplicateMode, updateStock]);

  function resetImportSession() {
    setDuplicateMode('skip');
    setUpdateStock(false);
    setSessionId(createImportSessionId());
    setProgress(createEmptyProductExcelImportProgress());
    setOptionsLocked(false);
    setRunResult(null);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setPreview(null);
    setError(null);
    setSuccess(null);
    resetImportSession();
    setReading(true);

    try {
      const result = await parseProductExcel(file, products, categories);
      if (result.sourceFormat === 'PRODUCT_EXCEL_V2') {
        setDuplicateMode('update');
      }
      setPreview(result);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'Không thể đọc file Excel.');
    } finally {
      setReading(false);
    }
  }

  async function handleImport() {
    if (!preview || importing || !appUser) return;

    if (updateStock && !isOwner) {
      setError('Chỉ chủ cửa hàng được cập nhật tồn kho từ file Excel.');
      return;
    }
    if (updateStock && !preview.stockColumnDetected) {
      setError('File không có cột Tồn kho.');
      return;
    }

    const errorCount = summary.errorCount + summary.conflictCount;
    const hasAction =
      summary.newCount > 0 ||
      summary.updateCount > 0 ||
      (updateStock && summary.stockAdjustmentCount > 0);
    if (!hasAction) {
      setError('Không có thay đổi hợp lệ nào để thực hiện với lựa chọn hiện tại.');
      return;
    }

    const lines = [
      `Tạo mới: ${summary.newCount}`,
      `Cập nhật hàng trùng: ${summary.updateCount}`,
      `Điều chỉnh tồn kho: ${summary.stockAdjustmentCount}`,
      `Bỏ qua: ${summary.skippedCount}`,
      `Lỗi/conflict: ${errorCount}`,
    ];
    if (updateStock && summary.stockAdjustmentCount > 0) {
      lines.push('', 'Tồn kho sẽ được điều chỉnh theo số lượng trong file Excel và sẽ tạo lịch sử kho.');
    }

    const confirmed = window.confirm(lines.join('\n'));
    if (!confirmed) return;

    setImporting(true);
    setOptionsLocked(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await runProductExcelImport({
        rows: preview.rows,
        actorUid,
        actorRole: appUser.role,
        duplicateMode,
        updateStock,
        stockColumnDetected: preview.stockColumnDetected,
        sessionId,
        progress,
      });
      setProgress(result.progress);
      setRunResult(result);

      const resultText = [
        `Product tạo mới thành công: ${result.created}`,
        `Product cập nhật thành công: ${result.updated}`,
        `Stock adjustment thành công: ${result.stockAdjusted}`,
        `Tồn kho không đổi: ${result.stockUnchanged}`,
        `Hàng trùng bỏ qua metadata: ${result.skippedDuplicates}`,
      ].join(' · ');

      if (result.failures.length > 0) {
        setError(`${resultText}. Còn ${result.failures.length} thao tác thất bại; có thể thử lại cùng phiên import.`);
      } else {
        setSuccess(resultText);
        setPreview(null);
        setFileName('');
        setOptionsLocked(false);
        setProgress(createEmptyProductExcelImportProgress());
        setDuplicateMode('skip');
        setUpdateStock(false);
        setSessionId(createImportSessionId());
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Không thể import sản phẩm.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="product-editor excel-import-panel" aria-label="Import sản phẩm bằng Excel">
      <div className="section-heading">
        <div>
          <h2>Import sản phẩm bằng Excel</h2>
          <p>
            Hỗ trợ tạo mới, bỏ qua hoặc cập nhật hàng trùng. Tồn kho chỉ thay đổi khi OWNER chủ động bật tùy chọn riêng.
          </p>
        </div>
        <button className="button button--secondary" type="button" onClick={onClose} disabled={importing}>
          Đóng
        </button>
      </div>

      <div className="excel-import-help">
        <strong>Cột hỗ trợ:</strong>
        <span>Mã hàng/SKU, Tên sản phẩm, Tên gọi khác, Danh mục, Barcode, QR, Đơn vị, Giá vốn, Giá bán, Tồn tối thiểu, Tồn kho, Trạng thái.</span>
        <span>Các cột khác trong file được phép tồn tại và sẽ được bỏ qua.</span>
      </div>

      <label className="excel-file-picker">
        <span>Chọn file Excel (.xlsx hoặc .xls)</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          onChange={handleFileChange}
          disabled={reading || importing}
        />
      </label>

      {reading && <p className="muted">Đang đọc và kiểm tra file...</p>}
      {fileName && !reading && <p className="muted">File: <strong>{fileName}</strong></p>}
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}

      {runResult?.failures.length ? (
        <div className="excel-import-help" role="status">
          <strong>Chi tiết thao tác thất bại</strong>
          {runResult.failures.slice(0, 20).map((failure) => (
            <span key={`${failure.rowNumber}-${failure.stage}`}>
              Dòng {failure.rowNumber} · {failure.stage}: {failure.message}
            </span>
          ))}
          {runResult.failures.length > 20 ? <span>... và {runResult.failures.length - 20} lỗi khác.</span> : null}
        </div>
      ) : null}

      {preview && (
        <>
          <fieldset className="excel-import-options" disabled={importing || optionsLocked}>
            <legend>Xử lý hàng trùng</legend>
            <label>
              <input
                type="radio"
                name="duplicate-mode"
                checked={duplicateMode === 'skip'}
                onChange={() => setDuplicateMode('skip')}
              />
              Bỏ qua hàng trùng
            </label>
            <label>
              <input
                type="radio"
                name="duplicate-mode"
                checked={duplicateMode === 'update'}
                onChange={() => setDuplicateMode('update')}
              />
              Cập nhật hàng trùng
            </label>
          </fieldset>

          {isOwner ? (
            <label className="excel-stock-option">
              <input
                type="checkbox"
                checked={updateStock}
                onChange={(event) => setUpdateStock(event.target.checked)}
                disabled={importing || optionsLocked}
              />
              <span>
                <strong>Cập nhật tồn kho theo file Excel</strong>
                <small>Tồn kho trong Excel được hiểu là tồn mục tiêu; mọi chênh lệch đi qua lịch sử kho/CAS.</small>
              </span>
            </label>
          ) : null}

          {updateStock && !preview.stockColumnDetected ? (
            <p className="form-warning">File không có cột Tồn kho.</p>
          ) : null}

          <div className="import-summary">
            <div><span>Sản phẩm mới</span><strong>{summary.newCount}</strong></div>
            <div><span>Đã có trong hệ thống</span><strong>{summary.duplicateCount}</strong></div>
            <div><span>Hàng lỗi</span><strong>{summary.errorCount}</strong></div>
            <div><span>Hàng conflict</span><strong>{summary.conflictCount}</strong></div>
            <div><span>Product sẽ cập nhật</span><strong>{summary.updateCount}</strong></div>
            <div><span>Tồn kho sẽ điều chỉnh</span><strong>{summary.stockAdjustmentCount}</strong></div>
          </div>

          <p className="muted">
            Sheet: <strong>{preview.sheetName}</strong> · Đã nhận {preview.detectedHeaders.length} cột.
            {preview.sourceFormat === 'PRODUCT_EXCEL_V2' ? ' · File do phần mềm xuất: sản phẩm đã có là bình thường và được chọn Cập nhật mặc định.' : ''}
          </p>

          {preview.stockColumnDetected && !updateStock ? (
            <p className="form-warning">
              File có cột Tồn kho nhưng tùy chọn cập nhật tồn đang TẮT. Tồn kho chỉ được dùng làm snapshot tham khảo và không thay đổi hệ thống.
            </p>
          ) : null}

          <div className="product-table-wrap import-preview-table-wrap">
            <table className="product-table import-preview-table">
              <thead>
                <tr>
                  <th>Dòng</th>
                  <th>SKU</th>
                  <th>Tên sản phẩm</th>
                  <th>Danh mục</th>
                  <th>Giá bán</th>
                  <th>Xử lý</th>
                  {updateStock ? <th>Tồn hiện tại → Excel</th> : null}
                  <th>Kết quả kiểm tra</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((row) => {
                  const stock = updateStock ? getExcelStockPreview(row, products) : null;
                  const typeLabel = row.status === 'ready'
                    ? 'Sẽ tạo mới'
                    : row.status === 'duplicate'
                      ? (duplicateMode === 'update' ? 'Đã có · sẽ cập nhật' : 'Đã có · sẽ bỏ qua')
                      : row.status === 'conflict'
                        ? 'Cần xử lý'
                        : 'Lỗi';
                  return (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td>{row.input?.sku || '—'}</td>
                      <td>{row.input?.name || '—'}</td>
                      <td>{row.categoryName || 'Chưa phân loại'}</td>
                      <td className="number-cell">{row.input ? row.input.salePrice.toLocaleString('vi-VN') : '—'}</td>
                      <td>{typeLabel}</td>
                      {updateStock ? (
                        <td className="number-cell">
                          {stock ? `${stock.current} → ${stock.target} (${formatDelta(stock.delta)})` : '—'}
                        </td>
                      ) : null}
                      <td>
                        <span className={`import-status import-status--${row.status}`}>
                          {row.status === 'duplicate'
                            ? `Đã có trong hệ thống — ${duplicateMode === 'update' ? 'sẽ cập nhật dữ liệu từ Excel' : 'sẽ bỏ qua, không phải lỗi'}`
                            : row.message}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {preview.rows.length > 100 && (
            <p className="muted">Đang hiển thị 100 dòng đầu trong tổng số {preview.rows.length} dòng.</p>
          )}

          <div className="form-actions">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              Chọn file khác
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={handleImport}
              disabled={importing || (updateStock && !preview.stockColumnDetected)}
            >
              {importing ? 'Đang xử lý...' : optionsLocked ? 'Thử lại phần chưa hoàn tất' : 'Xác nhận import'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
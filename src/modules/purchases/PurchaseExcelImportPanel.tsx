import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { Product, Supplier } from '../../types/models';
import type { PurchaseDraft } from './purchaseDraft';
import {
  parsePurchaseExcelFile,
  type PurchaseExcelImportResult,
  type PurchaseExcelImportRow,
} from './purchaseExcelImport';
import { buildPurchaseDraftFromExcel } from './purchaseExcelImportDraft';
import { downloadPurchaseExcelTemplate } from './purchaseExcelImportTemplate';
import {
  createConfirmedPurchaseExcelProducts,
  createEmptyPurchaseExcelProgress,
  type PurchaseExcelCreateFailure,
  type PurchaseExcelCreateProgress,
} from './purchaseExcelImportWorkflow';

interface PurchaseExcelImportPanelProps {
  products: readonly Product[];
  suppliers: readonly Supplier[];
  actorUid: string;
  onClose: () => void;
  onReady: (draft: PurchaseDraft, createdProducts: Product[]) => void;
}

function statusLabel(status: PurchaseExcelImportRow['status']) {
  if (status === 'MATCHED') return 'Đã khớp';
  if (status === 'NEW') return 'Hàng mới';
  if (status === 'REVIEW') return 'Cần kiểm tra';
  return 'Lỗi';
}

function formatNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('vi-VN', { maximumFractionDigits: 3 })
    : '—';
}

export default function PurchaseExcelImportPanel({
  products,
  suppliers,
  actorUid,
  onClose,
  onReady,
}: PurchaseExcelImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<PurchaseExcelImportResult | null>(null);
  const [selectedNewRows, setSelectedNewRows] = useState<Set<number>>(() => new Set());
  const [progress, setProgress] = useState<PurchaseExcelCreateProgress>(createEmptyPurchaseExcelProgress);
  const [failures, setFailures] = useState<PurchaseExcelCreateFailure[]>([]);
  const [reading, setReading] = useState(false);
  const [creatingProducts, setCreatingProducts] = useState(false);
  const [productsConfirmed, setProductsConfirmed] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.active), [suppliers]);
  const blockingCount = (preview?.summary.review ?? 0) + (preview?.summary.error ?? 0);
  const selectedNewCount = useMemo(
    () => preview?.rows.filter((row) => row.status === 'NEW' && selectedNewRows.has(row.rowNumber)).length ?? 0,
    [preview, selectedNewRows],
  );
  const matchedCount = preview?.summary.matched ?? 0;
  const canPrepareDraft = Boolean(preview && blockingCount === 0 && (matchedCount > 0 || selectedNewCount > 0));

  function resetForFile() {
    setSelectedNewRows(new Set());
    setProgress(createEmptyPurchaseExcelProgress());
    setFailures([]);
    setProductsConfirmed(false);
    setError(null);
    setNotice(null);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    resetForFile();
    setReading(true);
    try {
      const result = await parsePurchaseExcelFile(file, products);
      setPreview(result);
      setSelectedNewRows(new Set(
        result.rows.filter((row) => row.status === 'NEW').map((row) => row.rowNumber),
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể phân tích file Excel.');
    } finally {
      setReading(false);
    }
  }

  function toggleNewRow(rowNumber: number) {
    if (productsConfirmed || creatingProducts) return;
    setSelectedNewRows((current) => {
      const next = new Set(current);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  function toggleAllNewRows() {
    if (!preview || productsConfirmed || creatingProducts) return;
    const all = preview.rows.filter((row) => row.status === 'NEW').map((row) => row.rowNumber);
    setSelectedNewRows((current) => current.size === all.length ? new Set() : new Set(all));
  }

  function handleSupplierChange(nextId: string) {
    const supplier = activeSuppliers.find((item) => item.id === nextId);
    setSupplierId(nextId);
    if (supplier) setSupplierName(supplier.name);
  }

  async function confirmNewProducts() {
    if (!preview || creatingProducts) return;
    setError(null);
    setNotice(null);
    if (blockingCount > 0) {
      setError('Còn dòng Cần kiểm tra/Lỗi. Hãy sửa file rồi phân tích lại trước khi tiếp tục.');
      return;
    }
    if (matchedCount === 0 && selectedNewCount === 0) {
      setError('Không có dòng nào được chọn để đưa vào phiếu nhập.');
      return;
    }

    const confirmed = window.confirm([
      `Đã khớp: ${matchedCount}`,
      `Hàng mới sẽ tạo: ${selectedNewCount}`,
      `Hàng mới bỏ qua: ${preview.summary.newCount - selectedNewCount}`,
      '',
      'Product mới được tạo với tồn kho 0. Import KHÔNG hoàn tất phiếu và KHÔNG cộng tồn.',
      'Tiếp tục xác nhận hàng mới?',
    ].join('\n'));
    if (!confirmed) return;

    if (selectedNewCount === 0) {
      setProductsConfirmed(true);
      setFailures([]);
      setNotice('Đã xác nhận. Không có Product mới cần tạo.');
      return;
    }

    setCreatingProducts(true);
    try {
      const result = await createConfirmedPurchaseExcelProducts({
        rows: preview.rows,
        selectedNewRowNumbers: selectedNewRows,
        actorUid,
        currentProducts: products,
        progress,
      });
      setProgress(result.progress);
      setFailures(result.failures);
      if (result.failures.length > 0) {
        setError(`Đã tạo một phần Product mới. Còn ${result.failures.length} nhóm thất bại; có thể thử lại mà không tạo lại Product đã thành công.`);
        setProductsConfirmed(false);
      } else {
        setProductsConfirmed(true);
        setNotice(`Đã xác nhận ${selectedNewCount} dòng hàng mới. Product mới đã được tạo với tồn 0.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo Product mới từ Excel.');
      setProductsConfirmed(false);
    } finally {
      setCreatingProducts(false);
    }
  }

  function moveToPurchase() {
    if (!preview || !productsConfirmed) return;
    setError(null);
    try {
      const draft = buildPurchaseDraftFromExcel({
        rows: preview.rows,
        selectedNewRowNumbers: selectedNewRows,
        progress,
        supplierId,
        supplierName,
      });
      onReady(draft, Object.values(progress.createdProductsBySku));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể dựng phiếu nhập từ preview.');
    }
  }

  return (
    <>
      <div className="purchase-modal-backdrop" aria-hidden="true" />
      <section className="purchase-import-panel purchase-modal-surface purchase-import-modal" aria-labelledby="purchase-import-title">
        <button
          className="purchase-modal-close"
          type="button"
          onClick={onClose}
          disabled={creatingProducts}
          aria-label="Đóng cửa sổ nhập Excel"
        >
          ×
        </button>
        <div className="purchase-import-heading">
        <div>
          <p className="eyebrow">PURCHASE EXCEL</p>
          <h2 id="purchase-import-title">Nhập hàng từ Excel</h2>
          <p className="muted">Phân tích và đối chiếu trước. Chỉ nút “Hoàn tất nhập hàng” trong editor mới làm thay đổi tồn kho.</p>
        </div>
      </div>

      <div className="purchase-import-start">
        <button className="button button--secondary purchase-touch" type="button" onClick={downloadPurchaseExcelTemplate} disabled={creatingProducts}>Tải file mẫu</button>
        <label className="purchase-import-file purchase-touch">
          <span>Chọn file Excel</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(event) => void handleFileChange(event)}
            disabled={reading || creatingProducts}
          />
        </label>
        {fileName ? <span className="purchase-import-filename">{fileName}</span> : null}
      </div>

      {reading ? <p className="muted" role="status">Đang phân tích và đối chiếu Product...</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice ? <p className="purchase-success" role="status">{notice}</p> : null}

      {failures.length > 0 ? (
        <div className="purchase-import-failures" role="status">
          <strong>Product tạo thất bại</strong>
          {failures.map((failure) => (
            <span key={`${failure.sku}-${failure.rowNumbers.join('-')}`}>
              Dòng {failure.rowNumbers.join(', ')} · {failure.sku}: {failure.message}
            </span>
          ))}
        </div>
      ) : null}

      {preview ? (
        <>
          <div className="purchase-import-summary" aria-label="Tóm tắt phân tích Excel">
            <div><span>Tổng dòng</span><strong>{preview.summary.total}</strong></div>
            <div><span>Đã khớp</span><strong>{preview.summary.matched}</strong></div>
            <div><span>Hàng mới</span><strong>{preview.summary.newCount}</strong></div>
            <div><span>Cần kiểm tra</span><strong>{preview.summary.review}</strong></div>
            <div><span>Lỗi</span><strong>{preview.summary.error}</strong></div>
          </div>

          <div className="purchase-import-new-controls">
            <div>
              <strong>Xác nhận hàng mới</strong>
              <span>Đang chọn {selectedNewCount}/{preview.summary.newCount} dòng NEW. Bỏ chọn nghĩa là không tạo và không đưa dòng đó vào phiếu.</span>
            </div>
            {preview.summary.newCount > 0 ? (
              <button className="button button--secondary purchase-touch" type="button" onClick={toggleAllNewRows} disabled={productsConfirmed || creatingProducts}>
                {selectedNewCount === preview.summary.newCount ? 'Bỏ chọn tất cả hàng mới' : 'Chọn tất cả hàng mới'}
              </button>
            ) : null}
          </div>

          <div className="purchase-import-table-wrap" tabIndex={0} aria-label="Preview dòng nhập Excel">
            <table className="purchase-import-table">
              <thead>
                <tr>
                  <th>Chọn</th>
                  <th>Dòng</th>
                  <th>Trạng thái</th>
                  <th>Tên hàng</th>
                  <th>Mã hàng</th>
                  <th>Mã vạch / QR</th>
                  <th>Số lượng</th>
                  <th>Giá nhập</th>
                  <th>Kết quả đối chiếu</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.rowNumber} className={`purchase-import-row purchase-import-row--${row.status.toLowerCase()}`}>
                    <td>
                      {row.status === 'NEW' ? (
                        <label className="purchase-import-checkbox-hit">
                          <input
                            type="checkbox"
                            aria-label={`Chọn hàng mới dòng ${row.rowNumber}`}
                            checked={selectedNewRows.has(row.rowNumber)}
                            onChange={() => toggleNewRow(row.rowNumber)}
                            disabled={productsConfirmed || creatingProducts}
                          />
                        </label>
                      ) : <span aria-hidden="true">—</span>}
                    </td>
                    <td>{row.rowNumber}</td>
                    <td><span className={`purchase-import-status purchase-import-status--${row.status.toLowerCase()}`}>{statusLabel(row.status)}</span></td>
                    <td>{row.name || '—'}</td>
                    <td className="purchase-import-identifier">{row.effectiveSku || row.sourceSku || '—'}</td>
                    <td className="purchase-import-identifier">
                      {row.sourceBarcode || '—'}{row.sourceQrCode ? <><br /><small>QR: {row.sourceQrCode}</small></> : null}
                    </td>
                    <td className="purchase-import-number">{formatNumber(row.quantity)}</td>
                    <td className="purchase-import-number">{formatNumber(row.unitCost)}</td>
                    <td>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {blockingCount > 0 ? (
            <p className="purchase-editor-warning" role="alert">
              Có {blockingCount} dòng Cần kiểm tra/Lỗi. Import bị chặn để tránh ghép nhầm Product hoặc mất identifier.
            </p>
          ) : null}

          <div className="purchase-import-supplier-grid">
            <label>Nhà cung cấp
              <select value={supplierId} onChange={(event) => handleSupplierChange(event.target.value)} disabled={creatingProducts}>
                <option value="">— Chưa chọn danh mục —</option>
                {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} - {supplier.name}</option>)}
              </select>
            </label>
            <label>Tên NCC trên phiếu
              <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Tên nhà cung cấp" disabled={creatingProducts} />
            </label>
          </div>

          <div className="purchase-import-actions">
            <button className="button button--secondary purchase-touch" type="button" onClick={() => fileInputRef.current?.click()} disabled={reading || creatingProducts}>Chọn file khác</button>
            <button className="button button--secondary purchase-touch" type="button" onClick={() => void confirmNewProducts()} disabled={!canPrepareDraft || creatingProducts || productsConfirmed}>
              {creatingProducts ? 'Đang tạo Product...' : failures.length > 0 ? 'Thử lại hàng mới chưa tạo' : 'Xác nhận hàng mới'}
            </button>
            <button className="button button--primary purchase-touch" type="button" onClick={moveToPurchase} disabled={!productsConfirmed || creatingProducts}>
              Đưa vào phiếu nhập
            </button>
          </div>
        </>
      ) : null}
      </section>
    </>
  );
}

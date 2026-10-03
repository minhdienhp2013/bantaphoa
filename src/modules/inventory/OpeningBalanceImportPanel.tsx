import { useMemo, useState, type ChangeEvent } from 'react';
import type { Product } from '../../types/models';
import { applyOpeningBalances } from './inventoryService';
import { parseOpeningBalanceExcel, type OpeningBalanceExcelResult } from './openingBalanceExcel';

interface Props {
  products: Product[];
  actorUid: string;
}

export default function OpeningBalanceImportPanel({ products, actorUid }: Props) {
  const [result, setResult] = useState<OpeningBalanceExcelResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const readyRows = useMemo(() => result?.rows.filter((row) => row.status === 'ready') ?? [], [result]);
  const errorCount = useMemo(() => result?.rows.filter((row) => row.status === 'error').length ?? 0, [result]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    try {
      setResult(await parseOpeningBalanceExcel(file, products));
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : 'Không thể đọc file Excel.');
    }
  }

  async function handleApply() {
    if (!result || errorCount > 0 || readyRows.length === 0) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const count = await applyOpeningBalances(
        readyRows.map((row) => ({
          productId: row.productId as string,
          quantity: row.quantity as number,
          ...(typeof row.unitCost === 'number' ? { unitCost: row.unitCost } : {}),
        })),
        actorUid,
      );
      setSuccess(`Đã ghi tồn đầu kỳ và tạo OPENING_BALANCE cho ${count} sản phẩm.`);
      setResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể ghi tồn đầu kỳ.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="inv-card inv-opening-balance-card">
      <div className="inv-card__header">
        <div>
          <p className="eyebrow">INV-003</p>
          <h2>Tồn đầu kỳ từ Excel</h2>
          <p className="muted">File cần có cột Mã hàng/SKU và Tồn kho. Chỉ áp dụng cho sản phẩm đang có tồn bằng 0.</p>
        </div>
        <label className="inv-file-button">
          Chọn file Excel
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        </label>
      </div>

      {error && <p className="form-error">{error}</p>}
      {success && <p className="inv-success">{success}</p>}

      {result && (
        <>
          <div className="inv-inline-summary">
            <strong>Sheet: {result.sheetName}</strong>
            <span>{readyRows.length} dòng sẵn sàng</span>
            <span>{errorCount} dòng lỗi</span>
          </div>
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead><tr><th>Dòng</th><th>SKU</th><th>Sản phẩm</th><th>Tồn đầu kỳ</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {result.rows.slice(0, 200).map((row) => (
                  <tr key={`${row.rowNumber}-${row.sku}`}>
                    <td>{row.rowNumber}</td><td>{row.sku || '—'}</td><td>{row.productName || '—'}</td>
                    <td>{row.quantity ?? '—'}</td><td>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.rows.length > 200 && <p className="muted">Chỉ hiển thị 200 dòng đầu để màn hình nhẹ hơn.</p>}
          <button className="button button--primary" type="button" disabled={busy || errorCount > 0 || readyRows.length === 0} onClick={handleApply}>
            {busy ? 'Đang ghi tồn...' : `Ghi tồn đầu kỳ (${readyRows.length})`}
          </button>
        </>
      )}
    </section>
  );
}

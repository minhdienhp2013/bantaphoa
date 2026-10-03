import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import type { StockMovement, StockMovementType } from '../../types/models';
import BackupPanel from '../backup/BackupPanel';
import { exportReportExcel } from './reportExcel';
import {
  buildCustomRange,
  buildPresetRange,
  getProductSaleSnapshotCost,
  loadReport,
  loadReportMovements,
  type ReportBundle,
  type ReportPreset,
  type ReportRange,
} from './reportService';
import './reports.css';
import './reportsBrand.css';
import './reportsDesktopMobilePolish.css';

const PRESETS: { id: Exclude<ReportPreset, 'custom'>; label: string }[] = [
  { id: 'today', label: 'Hôm nay' },
  { id: 'yesterday', label: 'Hôm qua' },
  { id: 'week', label: 'Tuần' },
  { id: 'month', label: 'Tháng' },
  { id: 'quarter', label: 'Quý' },
  { id: 'year', label: 'Năm' },
];
const MOVEMENT_TYPES: StockMovementType[] = [
  'OPENING_BALANCE', 'PURCHASE', 'PURCHASE_RETURN', 'SALE', 'SALE_RETURN', 'STOCK_OUT',
  'STOCK_OUT_REVERSAL', 'STOCKTAKE_ADJUSTMENT', 'MANUAL_ADJUSTMENT',
];

function vnd(value: number) {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)} ₫`;
}
function number(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}
function dateTime(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}
function paymentMethodLabel(value: string | undefined) {
  if (value === 'cash') return 'Tiền mặt';
  if (value === 'bank_transfer') return 'Chuyển khoản';
  if (value === 'other') return 'Khác';
  return 'Chưa ghi nhận';
}
function inputDate(value: Date) {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, '0');
  const d = String(value.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function productSaleItemsLabel(items: readonly { name: string; quantity: number }[], limit = 3) {
  const usable = items.filter((item) => item.name.trim());
  if (!usable.length) return '—';
  const visible = usable.slice(0, limit).map((item) => `${item.name} ×${number(item.quantity)}`);
  const remaining = usable.length - visible.length;
  return `${visible.join('; ')}${remaining > 0 ? `; +${remaining} mặt hàng` : ''}`;
}

export default function ReportsPage() {
  const { appUser } = useAuth();
  const [preset, setPreset] = useState<ReportPreset>('today');
  const [range, setRange] = useState<ReportRange>(() => buildPresetRange('today'));
  const [customFrom, setCustomFrom] = useState(() => inputDate(new Date()));
  const [customTo, setCustomTo] = useState(() => inputDate(new Date()));
  const [data, setData] = useState<ReportBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [movementType, setMovementType] = useState<StockMovementType | 'all'>('all');
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [movementsOpen, setMovementsOpen] = useState(false);
  const [movementRows, setMovementRows] = useState<StockMovement[]>([]);
  const [movementRangeKey, setMovementRangeKey] = useState('');
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState('');
  const [exporting, setExporting] = useState(false);
  const movementRequestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError('');
    setMovementsOpen(false);
    setMovementRows([]);
    setMovementRangeKey('');
    setMovementError('');
    setMovementLoading(false);
    movementRequestRef.current += 1;
    void loadReport(range, {
      includeDebtFinance: appUser?.role === 'owner',
      includeUserDirectory: appUser?.role === 'owner',
      includeMovements: false,
      ...(appUser ? { currentUser: { uid: appUser.uid, displayName: appUser.displayName } } : {}),
    })
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          setData(null);
          setError(cause instanceof Error ? cause.message : 'Không thể tải báo cáo.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [appUser?.displayName, appUser?.role, appUser?.uid, range]);

  const selectPreset = (next: Exclude<ReportPreset, 'custom'>) => {
    setPreset(next);
    setRange(buildPresetRange(next));
  };

  const applyCustom = () => {
    try {
      const nextRange = buildCustomRange(customFrom, customTo);
      setError('');
      setPreset('custom');
      setRange(nextRange);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Khoảng ngày không hợp lệ.');
    }
  };

  const currentMovementRangeKey = `${range.from}:${range.to}`;

  const filteredMovements = useMemo(
    () => movementRows.filter((item) => movementType === 'all' || item.type === movementType),
    [movementRows, movementType],
  );

  async function loadMovements(targetRange = range) {
    const requestId = movementRequestRef.current + 1;
    movementRequestRef.current = requestId;
    setMovementLoading(true);
    setMovementError('');
    try {
      const rows = await loadReportMovements(targetRange);
      if (movementRequestRef.current !== requestId) return null;
      setMovementRows(rows);
      setMovementRangeKey(`${targetRange.from}:${targetRange.to}`);
      return rows;
    } catch (cause) {
      if (movementRequestRef.current === requestId) {
        setMovementRows([]);
        setMovementRangeKey('');
        setMovementError(cause instanceof Error ? cause.message : 'Không thể tải biến động kho.');
      }
      return null;
    } finally {
      if (movementRequestRef.current === requestId) setMovementLoading(false);
    }
  }

  async function toggleMovements() {
    if (movementsOpen) {
      setMovementsOpen(false);
      return;
    }
    setMovementsOpen(true);
    if (movementRangeKey !== currentMovementRangeKey) {
      await loadMovements(range);
    }
  }

  async function handleExportExcel() {
    if (!data || exporting) return;
    setExporting(true);
    setError('');
    try {
      let movements = movementRows;
      if (movementRangeKey !== currentMovementRangeKey) {
        const loaded = await loadMovements(range);
        if (!loaded) throw new Error('Không thể tải biến động kho để xuất Excel.');
        movements = loaded;
      }
      exportReportExcel({ ...data, movements });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xuất báo cáo Excel.');
    } finally {
      setExporting(false);
    }
  }

  if (!appUser) return null;

  return (
    <div className="reports-shell">
      <header className="report-page-header">
        <div>
          <p className="eyebrow">REP-001 → REP-008</p>
          <h1>Đơn hàng và báo cáo</h1>
          <p className="muted">Doanh thu và giá vốn đọc từ dữ liệu đã lưu của từng đơn bán hàng.</p>
        </div>
        <button className="button button--secondary report-touch" type="button" disabled={!data || loading || exporting} aria-busy={exporting} onClick={() => void handleExportExcel()}>{exporting ? 'Đang chuẩn bị Excel…' : 'Xuất Excel theo khoảng đang xem'}</button>
      </header>

      <section className="report-card report-filters" aria-label="Bộ lọc thời gian">
        <div className="report-preset-row">
          {PRESETS.map((item) => <button key={item.id} className={`report-chip${preset === item.id ? ' report-chip--active' : ''}`} type="button" onClick={() => selectPreset(item.id)}>{item.label}</button>)}
          <span className={`report-chip report-chip--static${preset === 'custom' ? ' report-chip--active' : ''}`}>Tùy chọn</span>
        </div>
        <div className="report-custom-range">
          <label className="report-field">Từ ngày<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
          <label className="report-field">Đến ngày<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
          <button className="button button--secondary report-touch" type="button" onClick={applyCustom}>Áp dụng khoảng ngày</button>
        </div>
        <strong className="report-range-label">Đang xem: {range.label}</strong>
      </section>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {loading ? <div className="report-loading">Đang tổng hợp dữ liệu…</div> : null}

      {data && !loading ? (
        <>
          <section className="report-summary-grid" aria-label="Tổng quan báo cáo">
            <article className="report-stat"><span>Tổng doanh thu</span><strong>{vnd(data.summary.totalRevenue)}</strong><small>{data.summary.completedSales} giao dịch completed</small></article>
            <article className="report-stat"><span>Doanh thu hàng hóa</span><strong>{vnd(data.summary.productRevenue)}</strong><small>Product Sale completed</small></article>
            <article className="report-stat"><span>Giá vốn hàng hóa</span><strong>{vnd(data.summary.productCostOfGoods)}</strong><small>Snapshot Product Sale</small></article>
            <article className="report-stat"><span>Lợi nhuận gộp thực hàng hóa</span><strong>{vnd(data.summary.productActualGrossProfit)}</strong><small>Doanh thu hàng hóa − giá vốn</small></article>
            <article className="report-stat"><span>Chi phí hợp lệ</span><strong>{vnd(data.summary.expenseTotal)}</strong><small>Expense status completed</small></article>
            {appUser.role === 'owner' ? <article className="report-stat"><span>Lãi vay đã trả</span><strong>{vnd(data.summary.loanInterestExpense)}</strong><small>Chi phí tài chính ròng trong kỳ; không gồm trả gốc</small></article> : null}
            <article className="report-stat"><span>Lợi nhuận gộp</span><strong>{vnd(data.summary.grossProfit)}</strong><small>Doanh thu − giá vốn</small></article>
            <article className="report-stat report-stat--emphasis"><span>Lợi nhuận ròng</span><strong>{vnd(data.summary.netProfit)}</strong><small>Lợi nhuận gộp − chi phí − lãi vay đã trả</small></article>
            <article className="report-stat"><span>Nhập hàng</span><strong>{vnd(data.summary.purchaseTotal)}</strong><small>Phiếu nhập completed trong kỳ</small></article>
          </section>

          {data.warnings.length ? <div className="report-warning" role="status"><strong>Cảnh báo dữ liệu legacy</strong><ul>{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}

          <section className="report-card report-orders-section">
            <div className="report-section-heading"><div><p className="eyebrow">REP-001 → REP-004</p><h2>Bán hàng</h2></div></div>
            <div className="report-table-wrap">
              <table className="report-table report-sales-table">
                <thead><tr><th>Thời gian</th><th>Loại giao dịch</th><th>Mặt hàng đã bán</th><th>Mã</th><th>Khách hàng</th><th>Người khởi tạo</th><th>Thanh toán</th><th>Ghi chú</th><th>Doanh thu</th><th>Giá vốn hàng hóa</th><th>LN thực hàng hóa</th></tr></thead>
                <tbody>{data.sales.length ? data.sales.map((sale) => {

                    const cost = getProductSaleSnapshotCost(sale);
                    const itemSummary = productSaleItemsLabel(sale.items);
                    const itemTitle = productSaleItemsLabel(sale.items, sale.items.length);
                    return <tr key={sale.id}><td>{dateTime(sale.createdAt)}</td><td>Hàng hóa</td><td className="report-note-cell" title={itemTitle}>{itemSummary}</td><td>{sale.code}</td><td>{sale.customerName || 'Khách lẻ'}</td><td className="report-creator-cell">{sale.creatorName}</td><td>{paymentMethodLabel(sale.paymentMethod)}</td><td className="report-note-cell">{sale.note || '—'}</td><td>{vnd(sale.total)}</td><td>{vnd(cost)}</td><td>{vnd(sale.total - cost)}</td></tr>;

                }) : <tr><td colSpan={11} className="report-empty-cell">Không có giao dịch completed trong kỳ.</td></tr>}</tbody>
              </table>
            </div>

            <div className="report-orders-mobile-list" aria-label="Danh sách đơn hàng trên điện thoại">
              {data.sales.length ? data.sales.map((sale) => {

                  const cost = getProductSaleSnapshotCost(sale);
                  return (
                    <article className="report-order-card" key={`mobile-${sale.id}`}>
                      <div className="report-order-card__head">
                        <div>
                          <strong>{sale.code}</strong>
                          <span>{dateTime(sale.createdAt)}</span>
                        </div>
                        <span className="report-order-kind report-order-kind--product">Hàng hóa</span>
                      </div>
                      <div className="report-order-card__identity">
                        <span>{sale.customerName || 'Khách lẻ'}</span>
                        <small>{sale.creatorName} · {paymentMethodLabel(sale.paymentMethod)}</small>
                      </div>
                      <p className="report-order-card__items">{productSaleItemsLabel(sale.items, 4)}</p>
                      <dl className="report-order-card__money">
                        <div><dt>Doanh thu</dt><dd>{vnd(sale.total)}</dd></div>
                        <div><dt>Giá vốn</dt><dd>{vnd(cost)}</dd></div>
                        <div><dt>Lợi nhuận</dt><dd>{vnd(sale.total - cost)}</dd></div>
                      </dl>
                      {sale.note ? <p className="report-order-card__note">{sale.note}</p> : null}
                    </article>
                  );

              }) : <div className="report-mobile-empty">Không có giao dịch completed trong kỳ.</div>}
            </div>
          </section>

          {appUser.role === 'owner' && data.debtFinance ? (
            <section className="report-card report-finance-section">
              <div className="report-section-heading">
                <div>
                  <p className="eyebrow">FIN-001</p>
                  <h2>Công nợ & khoản vay</h2>
                  <p className="muted">Số dư công nợ là snapshot hiện tại; dòng tiền thu/trả bên dưới chỉ tính các event trong khoảng báo cáo.</p>
                </div>
              </div>
              <div className="report-inline-stats">
                <span>Phải thu hiện tại: <strong>{vnd(data.debtFinance.receivable.totalOutstanding)}</strong></span>
                <span>Phải thu quá hạn: <strong>{vnd(data.debtFinance.receivable.overdueAmount)}</strong></span>
                <span>Phải trả hiện tại: <strong>{vnd(data.debtFinance.payable.totalOutstanding)}</strong></span>
                <span>Phải trả quá hạn: <strong>{vnd(data.debtFinance.payable.overdueAmount)}</strong></span>
                <span>Dư nợ gốc vay: <strong>{vnd(data.debtFinance.loans.principalOutstanding)}</strong></span>
                <span>Lãi kế hoạch còn lại: <strong>{vnd(data.debtFinance.loans.plannedInterestOutstanding)}</strong></span>
              </div>
              <div className="report-two-column">
                <article className="report-card">
                  <div className="report-section-heading"><div><h3>Dòng tiền công nợ trong kỳ</h3></div></div>
                  <dl className="report-inline-stats">
                    <div>Thu công nợ khách (ròng): <strong>{vnd(data.debtFinance.receivableCollectedNet)}</strong></div>
                    <div>Trả công nợ NCC (ròng): <strong>{vnd(data.debtFinance.payablePaidNet)}</strong></div>
                  </dl>
                </article>
                <article className="report-card">
                  <div className="report-section-heading"><div><h3>Khoản vay trong kỳ</h3></div></div>
                  <dl className="report-inline-stats">
                    <div>Trả gốc vay (ròng): <strong>{vnd(data.debtFinance.loanPrincipalPaidNet)}</strong> <small>không tính chi phí</small></div>
                    <div>Trả lãi vay (ròng): <strong>{vnd(data.debtFinance.loanInterestPaidNet)}</strong> <small>chi phí tài chính</small></div>
                  </dl>
                </article>
              </div>
            </section>
          ) : null}

          <section className="report-card report-collapsible report-inventory-section">
            <div className="report-section-heading report-collapsible-heading">
              <div><p className="eyebrow">REP-005</p><h2>Tồn kho hiện tại</h2></div>
              <button
                className="button button--secondary report-touch report-collapse-toggle"
                type="button"
                aria-expanded={inventoryOpen}
                aria-controls="report-inventory-details"
                onClick={() => setInventoryOpen((value) => !value)}
              >
                {inventoryOpen ? 'Thu gọn' : 'Xem chi tiết'}
              </button>
            </div>
            {inventoryOpen ? (
              <div id="report-inventory-details" className="report-collapsible-content">
                <p className="muted">Giá trị tồn là ước tính hiện tại = stockQuantity × Product.costPrice hiện tại; không dùng con số này để tính lại COGS lịch sử.</p>
                <div className="report-inline-stats"><span>Tổng lượng: <strong>{number(data.summary.inventoryQuantity)}</strong></span><span>Giá trị: <strong>{vnd(data.summary.inventoryValue)}</strong></span><span>Sắp hết: <strong>{data.summary.lowStockCount}</strong></span><span>Hết: <strong>{data.summary.outOfStockCount}</strong></span></div>
                <div className="report-table-wrap"><table className="report-table"><thead><tr><th>SKU</th><th>Sản phẩm</th><th>Tồn</th><th>Min</th><th>Trạng thái</th><th>Giá vốn hiện tại</th><th>Giá trị tồn</th></tr></thead>
                  <tbody>{data.inventory.length ? data.inventory.map((item) => <tr key={item.productId}><td>{item.sku}</td><td>{item.name}</td><td>{number(item.stockQuantity)} {item.unit || ''}</td><td>{item.minStock == null ? '—' : number(item.minStock)}</td><td><span className={`stock-status stock-status--${item.status}`}>{item.status === 'out' ? 'Hết hàng' : item.status === 'low' ? 'Sắp hết' : 'Bình thường'}</span></td><td>{vnd(item.currentUnitCost)}</td><td>{vnd(item.currentInventoryValue)}</td></tr>) : <tr><td colSpan={7} className="report-empty-cell">Chưa có sản phẩm.</td></tr>}</tbody></table></div>
              </div>
            ) : null}
          </section>

          <section className="report-card report-collapsible report-movements-section">
            <div className="report-section-heading report-collapsible-heading">
              <div><p className="eyebrow">REP-006</p><h2>Nhập / xuất / stock movements</h2></div>
              <button
                className="button button--secondary report-touch report-collapse-toggle"
                type="button"
                aria-expanded={movementsOpen}
                aria-controls="report-movements-details"
                onClick={() => void toggleMovements()}
              >
                {movementsOpen ? 'Thu gọn' : 'Xem chi tiết'}
              </button>
            </div>
            {movementsOpen ? (
              <div id="report-movements-details" className="report-collapsible-content">
                <div className="report-collapsible-toolbar">
                  <p className="muted">Nhập hàng: {vnd(data.summary.purchaseTotal)} · Xuất không doanh thu theo snapshot giá vốn: {vnd(data.summary.stockOutValue)}</p>
                  <label className="report-field report-filter-field">Nghiệp vụ<select value={movementType} onChange={(event) => setMovementType(event.target.value as StockMovementType | 'all')}><option value="all">Tất cả</option>{MOVEMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
                </div>
                {movementLoading ? <div className="report-loading">Đang tải biến động kho theo khoảng đang xem…</div> : null}
                {movementError ? <p className="form-error" role="alert">{movementError}</p> : null}
                {!movementLoading && !movementError ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Thời gian</th><th>Nghiệp vụ</th><th>Product ID</th><th>Delta</th><th>Trước</th><th>Sau</th><th>Tham chiếu</th></tr></thead>
                  <tbody>{filteredMovements.length ? filteredMovements.map((item) => <tr key={item.id}><td>{dateTime(item.createdAt)}</td><td>{item.type}</td><td>{item.productId}</td><td>{number(item.quantityDelta)}</td><td>{number(item.quantityBefore)}</td><td>{number(item.quantityAfter)}</td><td>{item.referenceId || '—'}</td></tr>) : <tr><td colSpan={7} className="report-empty-cell">Không có movement phù hợp bộ lọc.</td></tr>}</tbody></table></div> : null}
              </div>
            ) : null}
          </section>

          <section className="report-two-column report-partners-grid">
            <article className="report-card">
              <div className="report-section-heading"><div><p className="eyebrow">REP-007</p><h2>Khách hàng</h2></div></div>
              <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Khách hàng</th><th>Giao dịch</th><th>Tổng doanh thu</th><th>DT hàng hóa</th><th>Giá vốn hàng hóa</th><th>LN thực hàng hóa</th><th>Lợi nhuận gộp</th></tr></thead><tbody>{data.customers.length ? data.customers.map((item) => <tr key={item.customerId}><td>{item.customerName}</td><td>{item.orderCount}</td><td>{vnd(item.totalRevenue)}</td><td>{vnd(item.productRevenue)}</td><td>{vnd(item.productCostOfGoods)}</td><td>{vnd(item.productActualGrossProfit)}</td><td>{vnd(item.grossProfit)}</td></tr>) : <tr><td colSpan={7} className="report-empty-cell">Chưa có dữ liệu.</td></tr>}</tbody></table></div>
            </article>
            <article className="report-card"><div className="report-section-heading"><div><p className="eyebrow">REP-007</p><h2>Nhà cung cấp</h2></div></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Nhà cung cấp</th><th>Phiếu nhập</th><th>Giá trị nhập</th></tr></thead><tbody>{data.suppliers.length ? data.suppliers.map((item) => <tr key={item.supplierId}><td>{item.supplierName}</td><td>{item.purchaseCount}</td><td>{vnd(item.purchaseTotal)}</td></tr>) : <tr><td colSpan={3} className="report-empty-cell">Chưa có dữ liệu.</td></tr>}</tbody></table></div></article>
          </section>

          <div className="report-note">Giao dịch cancelled/refunded không được tính vào tài chính. Giá vốn dùng dữ liệu đã lưu lúc bán; thay đổi giá sản phẩm không làm đổi lịch sử.</div>
          <BackupPanel actorUid={appUser.uid} />
        </>
      ) : null}
    </div>
  );
}

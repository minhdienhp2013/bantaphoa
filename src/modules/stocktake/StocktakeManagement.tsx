import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppUser, Product, Stocktake } from '../../types/models';
import {
  exportStocktakeListToExcel,
  exportStocktakeToExcel,
} from './stocktakeExport';
import {
  filterStocktakes,
  getLocalDayBoundary,
  getStocktakeActionCapabilities,
  getStocktakeStatusLabel,
  getStocktakeTotals,
  resolveCreatorDisplay,
  type StocktakeStatusFilter,
} from './stocktakeManagementViewModel';
import StocktakeDetail from './StocktakeDetail';
import type { StocktakeApplyMode } from './stocktakeApplyPlan';
import './stocktakeManagement.css';

interface StocktakeManagementProps {
  stocktakes: readonly Stocktake[];
  products: readonly Product[];
  appUser: AppUser | null;
  loading: boolean;
  busy: boolean;
  selectedStocktakeId: string | null;
  onSelectStocktake: (stocktakeId: string | null) => void;
  onEdit: (stocktake: Stocktake) => void;
  onContinueScan: (stocktake: Stocktake) => void;
  onApply: (stocktake: Stocktake, mode: StocktakeApplyMode) => void;
  onCancel: (stocktake: Stocktake) => void;
}

function dateTime(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function formatDifference(value: number) {
  if (value > 0) return `+${formatQuantity(value)}`;
  return formatQuantity(value);
}

export default function StocktakeManagement({
  stocktakes,
  products,
  appUser,
  loading,
  busy,
  selectedStocktakeId,
  onSelectStocktake,
  onEdit,
  onContinueScan,
  onApply,
  onCancel,
}: StocktakeManagementProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StocktakeStatusFilter>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const detailWasOpenRef = useRef(false);

  const fromBoundary = getLocalDayBoundary(fromDate, 'start');
  const toBoundary = getLocalDayBoundary(toDate, 'end');
  const invalidDateRange = fromBoundary !== null && toBoundary !== null && fromBoundary > toBoundary;

  const filteredStocktakes = useMemo(
    () => filterStocktakes(stocktakes, { query, status, fromDate, toDate }),
    [stocktakes, query, status, fromDate, toDate],
  );

  const selectedStocktake = useMemo(
    () => selectedStocktakeId
      ? stocktakes.find((stocktake) => stocktake.id === selectedStocktakeId) ?? null
      : null,
    [selectedStocktakeId, stocktakes],
  );

  useEffect(() => {
    if (selectedStocktake) {
      detailWasOpenRef.current = true;
      return;
    }
    if (!detailWasOpenRef.current) return;

    detailWasOpenRef.current = false;
    const opener = detailOpenerRef.current;
    detailOpenerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [selectedStocktake]);

  function openDetail(stocktakeId: string) {
    const activeElement = document.activeElement;
    detailOpenerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    onSelectStocktake(stocktakeId);
  }

  function closeDetail() {
    onSelectStocktake(null);
  }

  function clearFilters() {
    setQuery('');
    setStatus('all');
    setFromDate('');
    setToDate('');
    setNotice(null);
  }

  function handleExport(stocktake: Stocktake) {
    setNotice(null);
    try {
      exportStocktakeToExcel(
        stocktake,
        products,
        resolveCreatorDisplay(stocktake.createdBy, appUser),
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Không thể xuất Excel phiếu kiểm kê.');
    }
  }

  function handleExportList() {
    setNotice(null);
    if (invalidDateRange) {
      setNotice('Từ ngày không được sau Đến ngày.');
      return;
    }
    if (filteredStocktakes.length === 0) {
      setNotice('Không có phiếu kiểm kê phù hợp bộ lọc để xuất.');
      return;
    }
    try {
      exportStocktakeListToExcel(filteredStocktakes);
      setNotice(`Đã chuẩn bị file Excel cho ${filteredStocktakes.length} phiếu đang hiển thị.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Không thể xuất danh sách phiếu kiểm kê.');
    }
  }

  return (
    <section className="inv-card stk-management" aria-label="Quản lý phiếu kiểm kê">
      <div className="stk-management-heading">
        <div>
          <p className="eyebrow">STK-004</p>
          <h2>Quản lý phiếu</h2>
          <p className="muted">Tìm, xem chi tiết và xuất dữ liệu lịch sử từ snapshot của từng phiếu kiểm kê.</p>
        </div>
        <button
          className="button button--secondary stk-management-touch"
          type="button"
          disabled={loading || busy}
          onClick={handleExportList}
        >
          Xuất danh sách
        </button>
      </div>

      <div className="stk-management-filters" aria-label="Bộ lọc phiếu kiểm kê">
        <label>
          Tìm phiếu
          <input
            type="search"
            placeholder="Mã phiếu hoặc ghi chú..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Trạng thái
          <select value={status} onChange={(event) => setStatus(event.target.value as StocktakeStatusFilter)}>
            <option value="all">Tất cả</option>
            <option value="draft">Nháp</option>
            <option value="completed">Đã chốt</option>
            <option value="cancelled">Đã hủy</option>
          </select>
        </label>
        <label>
          Từ ngày
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>
        <label>
          Đến ngày
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </label>
        <button className="button button--secondary stk-management-touch" type="button" onClick={clearFilters}>
          Xóa lọc
        </button>
      </div>

      {invalidDateRange ? <p className="form-error" role="alert">Từ ngày không được sau Đến ngày.</p> : null}
      {notice ? <p className="stk-management-notice" role="status">{notice}</p> : null}

      {loading ? (
        <div className="stk-management-empty">Đang tải phiếu kiểm kê...</div>
      ) : filteredStocktakes.length === 0 ? (
        <div className="stk-management-empty">
          <strong>{stocktakes.length === 0 ? 'Chưa có phiếu kiểm kê.' : 'Không có phiếu phù hợp bộ lọc.'}</strong>
          <span>{stocktakes.length === 0 ? 'Tạo phiếu mới ở khu “Kiểm kê mới”.' : 'Thử xóa hoặc thay đổi bộ lọc hiện tại.'}</span>
        </div>
      ) : (
        <>
          <div className="stk-management-table-wrap">
            <table className="stk-management-table">
              <thead>
                <tr>
                  <th>STT</th>
                  <th>Mã phiếu</th>
                  <th>Ngày tạo</th>
                  <th>Trạng thái</th>
                  <th>Số mặt hàng</th>
                  <th>Tổng tồn hệ thống</th>
                  <th>Tổng thực tế</th>
                  <th>Tổng chênh lệch</th>
                  <th>Người tạo</th>
                  <th>Ghi chú</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filteredStocktakes.map((stocktake, index) => {
                  const totals = getStocktakeTotals(stocktake);
                  const actions = getStocktakeActionCapabilities(stocktake.status);
                  return (
                    <tr key={stocktake.id}>
                      <td>{index + 1}</td>
                      <td><button className="stk-document-code" type="button" onClick={() => openDetail(stocktake.id)}>{stocktake.code}</button></td>
                      <td>{dateTime(stocktake.createdAt)}</td>
                      <td><span className={`stk-status stk-status--${stocktake.status}`}>{getStocktakeStatusLabel(stocktake.status)}</span></td>
                      <td className="stk-number">{totals.itemCount}</td>
                      <td className="stk-number">{formatQuantity(totals.systemQuantity)}</td>
                      <td className="stk-number">{formatQuantity(totals.actualQuantity)}</td>
                      <td className="stk-number"><strong>{formatDifference(totals.difference)}</strong></td>
                      <td>{resolveCreatorDisplay(stocktake.createdBy, appUser)}</td>
                      <td className="stk-management-note-cell">{stocktake.note || '—'}</td>
                      <td>
                        <div className="stk-management-row-actions">
                          <button type="button" onClick={() => openDetail(stocktake.id)}>Xem</button>
                          {actions.edit ? <button type="button" disabled={busy} onClick={() => onEdit(stocktake)}>Sửa</button> : null}
                          {actions.continueScan ? <button type="button" disabled={busy} onClick={() => onContinueScan(stocktake)}>Tiếp tục quét</button> : null}
                          <button type="button" disabled={busy} onClick={() => handleExport(stocktake)}>Xuất chi tiết</button>
                          {actions.complete ? <button type="button" disabled={busy} onClick={() => openDetail(stocktake.id)}>Áp dụng tồn kho</button> : null}
                          {actions.cancel ? <button type="button" disabled={busy} onClick={() => onCancel(stocktake)}>Hủy</button> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="stk-management-mobile-list">
            {filteredStocktakes.map((stocktake) => {
              const totals = getStocktakeTotals(stocktake);
              const actions = getStocktakeActionCapabilities(stocktake.status);
              return (
                <article className="stk-management-card" key={`${stocktake.id}-card`}>
                  <div className="stk-management-card__heading">
                    <button className="stk-document-code" type="button" onClick={() => openDetail(stocktake.id)}>{stocktake.code}</button>
                    <span className={`stk-status stk-status--${stocktake.status}`}>{getStocktakeStatusLabel(stocktake.status)}</span>
                  </div>
                  <div className="stk-management-card__meta">
                    <span>{dateTime(stocktake.createdAt)}</span>
                    <span>{totals.itemCount} mặt hàng</span>
                    <span>Chênh lệch <strong>{formatDifference(totals.difference)}</strong></span>
                  </div>
                  {stocktake.note ? <p>{stocktake.note}</p> : null}
                  <div className="stk-management-card__actions">
                    <button className="button button--secondary stk-management-touch" type="button" onClick={() => openDetail(stocktake.id)}>Xem</button>
                    {actions.edit ? <button className="button button--secondary stk-management-touch" type="button" disabled={busy} onClick={() => onEdit(stocktake)}>Sửa</button> : null}
                    {actions.continueScan ? <button className="button button--secondary stk-management-touch" type="button" disabled={busy} onClick={() => onContinueScan(stocktake)}>Tiếp tục quét</button> : null}
                    <button className="button button--secondary stk-management-touch" type="button" disabled={busy} onClick={() => handleExport(stocktake)}>Xuất chi tiết</button>
                    {actions.complete ? <button className="button button--primary stk-management-touch" type="button" disabled={busy} onClick={() => openDetail(stocktake.id)}>Áp dụng tồn kho</button> : null}
                    {actions.cancel ? <button className="button button--secondary stk-management-touch" type="button" disabled={busy} onClick={() => onCancel(stocktake)}>Hủy</button> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {selectedStocktake ? (
        <StocktakeDetail
          stocktake={selectedStocktake}
          products={products}
          appUser={appUser}
          busy={busy}
          onClose={closeDetail}
          onEdit={onEdit}
          onContinueScan={onContinueScan}
          onExport={handleExport}
          onApply={onApply}
          onCancel={onCancel}
        />
      ) : null}
    </section>
  );
}

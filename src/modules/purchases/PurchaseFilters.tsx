import type { Supplier } from '../../types/models';
import type { PurchaseStatusFilter } from './purchaseManagementViewModel';

interface PurchaseFiltersProps {
  open: boolean;
  status: PurchaseStatusFilter;
  supplierId: string;
  fromDate: string;
  toDate: string;
  onlyMine: boolean;
  suppliers: readonly Supplier[];
  onStatusChange: (value: PurchaseStatusFilter) => void;
  onSupplierChange: (value: string) => void;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onOnlyMineChange: (value: boolean) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function PurchaseFilters({
  open,
  status,
  supplierId,
  fromDate,
  toDate,
  onlyMine,
  suppliers,
  onStatusChange,
  onSupplierChange,
  onFromDateChange,
  onToDateChange,
  onOnlyMineChange,
  onClear,
  onClose,
}: PurchaseFiltersProps) {
  const hasFilter = status !== 'all' || supplierId || fromDate || toDate || onlyMine;

  return (
    <>
      {open ? <button className="purchase-filter-backdrop" type="button" aria-label="Đóng bộ lọc" onClick={onClose} /> : null}
      <aside
        id="purchase-filters"
        className={`purchase-filters${open ? ' is-open' : ''}`}
        aria-label="Bộ lọc phiếu nhập"
        aria-hidden={!open ? undefined : false}
      >
        <div className="purchase-filter-heading">
          <strong>Bộ lọc</strong>
          <span>{hasFilter ? 'Đang áp dụng' : 'Tất cả'}</span>
          <button className="purchase-filter-close" type="button" onClick={onClose} aria-label="Đóng bộ lọc">×</button>
        </div>

        <fieldset>
          <legend>Trạng thái</legend>
          <label><input type="radio" name="purchase-status" checked={status === 'all'} onChange={() => onStatusChange('all')} /> Tất cả</label>
          <label><input type="radio" name="purchase-status" checked={status === 'completed'} onChange={() => onStatusChange('completed')} /> Đã nhập hàng</label>
          <label><input type="radio" name="purchase-status" checked={status === 'cancelled'} onChange={() => onStatusChange('cancelled')} /> Đã hủy</label>
        </fieldset>

        <div className="purchase-filter-section">
          <strong>Thời gian</strong>
          <label>Từ ngày<input type="date" value={fromDate} onChange={(event) => onFromDateChange(event.target.value)} /></label>
          <label>Đến ngày<input type="date" value={toDate} onChange={(event) => onToDateChange(event.target.value)} /></label>
        </div>

        <div className="purchase-filter-section">
          <label>Nhà cung cấp
            <select value={supplierId} onChange={(event) => onSupplierChange(event.target.value)}>
              <option value="">Tất cả nhà cung cấp</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.code} - {supplier.name}{supplier.active ? '' : ' (ngừng sử dụng)'}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="purchase-filter-check"><input type="checkbox" checked={onlyMine} onChange={(event) => onOnlyMineChange(event.target.checked)} /> Chỉ phiếu của tôi</label>

        <div className="purchase-filter-footer">
          <button className="button button--secondary purchase-touch purchase-filter-clear" type="button" onClick={onClear} disabled={!hasFilter}>Đặt lại</button>
          <button className="button button--primary purchase-touch purchase-filter-done" type="button" onClick={onClose}>Xong</button>
        </div>
      </aside>
    </>
  );
}

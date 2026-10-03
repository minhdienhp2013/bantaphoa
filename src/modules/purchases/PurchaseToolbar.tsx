interface PurchaseToolbarProps {
  query: string;
  filtersOpen: boolean;
  activeFilterCount: number;
  importDisabled: boolean;
  exportDisabled: boolean;
  onQueryChange: (value: string) => void;
  onToggleFilters: () => void;
  onImport: () => void;
  onCreate: () => void;
  onExport: () => void;
}

export default function PurchaseToolbar({
  query,
  filtersOpen,
  activeFilterCount,
  importDisabled,
  exportDisabled,
  onQueryChange,
  onToggleFilters,
  onImport,
  onCreate,
  onExport,
}: PurchaseToolbarProps) {
  return (
    <section className="purchase-toolbar" aria-label="Công cụ phiếu nhập">
      <div className="purchase-search">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          aria-label="Tìm phiếu nhập"
          placeholder="Tìm theo mã phiếu, nhà cung cấp, mã NCC..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </div>
      <div className="purchase-toolbar-actions">
        <button
          className={`button button--secondary purchase-touch purchase-filter-toggle${filtersOpen ? ' is-active' : ''}`}
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="purchase-filters"
          onClick={onToggleFilters}
        >
          Bộ lọc{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </button>
        <button className="button button--secondary purchase-touch" type="button" disabled={importDisabled} onClick={onImport}>Nhập Excel</button>
        <button className="button button--primary purchase-touch" type="button" onClick={onCreate}>+ Nhập hàng</button>
        <button className="button button--secondary purchase-touch" type="button" disabled={exportDisabled} onClick={onExport}>Xuất Excel</button>
      </div>
    </section>
  );
}

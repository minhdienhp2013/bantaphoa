import type { FormEvent } from 'react';

interface GoodsToolbarProps {
  query: string;
  importOpen: boolean;
  filtersOpen: boolean;
  showExportExcel: boolean;
  exportDisabled?: boolean;
  onQueryChange: (value: string) => void;
  onSubmitSearch: () => void;
  onClearSearch: () => void;
  onOpenScanner: () => void;
  onToggleImport: () => void;
  onToggleFilters: () => void;
  onExportExcel: () => void;
  onOpenPrinting: () => void;
  onCreate: () => void;
}

export default function GoodsToolbar({
  query,
  importOpen,
  filtersOpen,
  showExportExcel,
  exportDisabled = false,
  onQueryChange,
  onSubmitSearch,
  onClearSearch,
  onOpenScanner,
  onToggleImport,
  onToggleFilters,
  onExportExcel,
  onOpenPrinting,
  onCreate,
}: GoodsToolbarProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitSearch();
  }

  return (
    <section className="goods-toolbar" aria-label="Công cụ hàng hóa">
      <form className="goods-search" onSubmit={submit}>
        <input
          type="search"
          aria-label="Tìm hàng hóa"
          placeholder="Tìm theo tên, mã hàng, barcode hoặc QR..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query ? (
          <button className="goods-search-clear" type="button" onClick={onClearSearch} aria-label="Xóa từ khóa tìm kiếm">
            ×
          </button>
        ) : null}
      </form>

      <div className="goods-toolbar-actions">
        <button className="button button--secondary goods-touch" type="button" onClick={onOpenScanner}>Quét mã</button>
        <button className={`button button--secondary goods-touch${filtersOpen ? ' is-active' : ''}`} type="button" onClick={onToggleFilters}>Bộ lọc</button>
        <button className={`button button--secondary goods-touch${importOpen ? ' is-active' : ''}`} type="button" onClick={onToggleImport}>Import Excel</button>
        {showExportExcel ? (
          <button className="button button--secondary goods-touch" type="button" onClick={onExportExcel} disabled={exportDisabled}>Xuất Excel</button>
        ) : null}
        <button className="button button--secondary goods-touch" type="button" onClick={onOpenPrinting}>In tem</button>
        <button className="button button--primary goods-touch goods-add-button" type="button" onClick={onCreate}>+ Thêm sản phẩm</button>
      </div>
    </section>
  );
}

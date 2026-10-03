import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { primeScanSuccessFeedback } from '../../shared/audio/scanSuccessFeedback';
import type { Category, Product } from '../../types/models';
import { adjustProductStock } from '../inventory/inventoryService';
import { findProductByScannedCode } from '../qr/productLookup';
import ProductExcelImportPanel from './ProductExcelImportPanel';
import CategoryManager from './CategoryManager';
import GoodsBulkActionBar from './GoodsBulkActionBar';
import GoodsFilters from './GoodsFilters';
import GoodsKpiBar from './GoodsKpiBar';
import GoodsResponsiveList from './GoodsResponsiveList';
import GoodsTable from './GoodsTable';
import GoodsToolbar from './GoodsToolbar';
import ProductDetail from './ProductDetail';
import ProductEditorForm, { type ProductStockAdjustmentDraft } from './ProductEditorForm';
import ProductScanDialog from './ProductScanDialog';
import { deactivateSelectedProducts } from './productBulkActions';
import { exportProductsToExcel } from './productExcelExport';
import { productToFormState } from './productFormModel';
import type { ProductPermanentDeleteBlocker } from './productPermanentDelete';
import {
  computeGoodsStats,
  filterGoodsProducts,
  type GoodsActiveFilter,
  type GoodsCategoryFilter,
  type GoodsStockFilter,
} from './goodsViewModel';
import { subscribeCategories } from './categoryService';
import {
  createProduct,
  deleteProductsPermanently,
  preflightPermanentProductDeletion,
  setProductActive,
  subscribeProducts,
  updateProduct,
  type ProductInput,
} from './productService';

export default function ProductsPage() {
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const permanentDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<GoodsActiveFilter>('all');
  const [stockFilter, setStockFilter] = useState<GoodsStockFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<GoodsCategoryFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [detailProductId, setDetailProductId] = useState<string | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null);
  const [bulkDeactivating, setBulkDeactivating] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteBlockers, setDeleteBlockers] = useState<ProductPermanentDeleteBlocker[]>([]);
  const [focusStatusAfterDelete, setFocusStatusAfterDelete] = useState(false);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);

    try {
      return subscribeProducts(
        (nextProducts) => {
          setProducts(nextProducts);
          setLoading(false);
        },
        (error) => {
          setLoadError(error.message || 'Không thể tải danh sách hàng hóa.');
          setLoading(false);
        },
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không thể kết nối cơ sở dữ liệu.');
      setLoading(false);
      return undefined;
    }
  }, []);

  useEffect(() => {
    setCategoryError(null);
    try {
      return subscribeCategories(setCategories, (error) => setCategoryError(error.message));
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : 'Không thể tải danh mục hàng hóa.');
      return undefined;
    }
  }, []);

  useEffect(() => {
    const productIds = new Set(products.map((product) => product.id));
    setSelectedProductIds((current) => {
      const next = new Set([...current].filter((id) => productIds.has(id)));
      return next.size === current.size ? current : next;
    });
    if (detailProductId && !productIds.has(detailProductId)) setDetailProductId(null);
  }, [products, detailProductId]);

  useEffect(() => {
    if (!focusStatusAfterDelete || !searchNotice) return;
    statusRef.current?.focus();
    setFocusStatusAfterDelete(false);
  }, [focusStatusAfterDelete, searchNotice]);

  const filteredProducts = useMemo(
    () => filterGoodsProducts(products, query, activeFilter, stockFilter, categoryFilter, categories),
    [products, query, activeFilter, stockFilter, categoryFilter, categories],
  );
  const stats = useMemo(() => computeGoodsStats(products), [products]);
  const detailProduct = useMemo(
    () => products.find((product) => product.id === detailProductId) ?? null,
    [products, detailProductId],
  );
  const selectedProducts = useMemo(
    () => products.filter((product) => selectedProductIds.has(product.id)),
    [products, selectedProductIds],
  );
  const canAdjustStock = appUser?.role === 'owner' || appUser?.permissions?.inventory === true;
  const editorInitialValues = useMemo(
    () => editingProduct ? productToFormState(editingProduct) : undefined,
    [editingProduct],
  );

  function openCreate() {
    setEditingProduct(null);
    setFormError(null);
    setEditorOpen(true);
  }

  function openEdit(product: Product) {
    setDetailProductId(null);
    setEditingProduct(product);
    setFormError(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (saving) return;
    setEditorOpen(false);
    setEditingProduct(null);
    setFormError(null);
  }

  async function handleSubmit(input: ProductInput, stockAdjustment?: ProductStockAdjustmentDraft) {
    if (!appUser || saving) return;

    setSaving(true);
    setFormError(null);
    let stockAdjustedTo: number | null = null;
    try {
      if (editingProduct) {
        if (stockAdjustment) {
          if (!canAdjustStock) throw new Error('Bạn không có quyền điều chỉnh tồn kho.');
          await adjustProductStock({
            productId: editingProduct.id,
            quantityBefore: editingProduct.stockQuantity,
            quantityAfter: stockAdjustment.quantity,
            actorUid: appUser.uid,
            note: stockAdjustment.note,
          });
          stockAdjustedTo = stockAdjustment.quantity;
        }
        await updateProduct(editingProduct, input, appUser.uid);
      } else {
        await createProduct(input, appUser.uid);
      }
      setEditorOpen(false);
      setEditingProduct(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể lưu sản phẩm.';
      if (editingProduct && stockAdjustedTo !== null) {
        const adjustedQuantity = stockAdjustedTo;
        setEditingProduct((current) => current ? {
          ...current,
          stockQuantity: adjustedQuantity,
          stockVersion: (Number(current.stockVersion) || 0) + 1,
        } : current);
        setFormError(`Tồn kho đã được cập nhật thành ${adjustedQuantity}, nhưng thông tin sản phẩm chưa lưu được. ${message}`);
      } else {
        setFormError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(product: Product) {
    if (!appUser || changingStatusId) return;
    const nextActive = !product.active;
    const confirmed = window.confirm(
      nextActive
        ? `Kích hoạt lại sản phẩm “${product.name}”?`
        : `Ngừng kinh doanh sản phẩm “${product.name}”? Sản phẩm không bị xóa và vẫn còn trong lịch sử.`,
    );
    if (!confirmed) return;

    setChangingStatusId(product.id);
    setLoadError(null);
    try {
      await setProductActive(product, nextActive, appUser.uid);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không thể đổi trạng thái sản phẩm.');
    } finally {
      setChangingStatusId(null);
    }
  }

  function handleExactLookup() {
    const code = query.trim();
    if (!code) return;
    const match = findProductByScannedCode(products, code);
    if (match) {
      setDetailProductId(match.product.id);
      setSearchNotice(`Đã tìm thấy ${match.product.sku} - ${match.product.name} theo ${match.field}.`);
      return;
    }
    setSearchNotice('Không tìm thấy mã chính xác. Danh sách vẫn đang lọc theo từ khóa hiện tại.');
  }

  function clearSearch() {
    setQuery('');
    setSearchNotice(null);
  }

  function toggleProductSelection(productId: string) {
    setDeleteBlockers([]);
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  function toggleAllVisible() {
    setDeleteBlockers([]);
    setSelectedProductIds((current) => {
      const next = new Set(current);
      const allVisibleSelected = filteredProducts.length > 0 && filteredProducts.every((product) => next.has(product.id));
      for (const product of filteredProducts) {
        if (allVisibleSelected) next.delete(product.id);
        else next.add(product.id);
      }
      return next;
    });
  }

  function clearFilters() {
    setActiveFilter('all');
    setStockFilter('all');
    setCategoryFilter('all');
  }

  function handleExportExcel() {
    if (appUser?.role !== 'owner' || loading) return;
    setLoadError(null);
    try {
      exportProductsToExcel(products, categories);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không thể xuất file Excel hàng hóa.');
    }
  }

  async function handleBulkDeactivate() {
    if (appUser?.role !== 'owner' || bulkDeactivating || bulkDeleting || selectedProducts.length === 0) return;

    const confirmed = window.confirm(
      `Bạn đang chuẩn bị ngừng kinh doanh ${selectedProducts.length} sản phẩm.\n\n` +
      'Sản phẩm không bị xóa.\nLịch sử bán hàng và kho vẫn được giữ nguyên.\n\n' +
      'Bạn có muốn tiếp tục?',
    );
    if (!confirmed) return;

    setBulkDeactivating(true);
    setSearchNotice(null);
    setLoadError(null);
    setDeleteBlockers([]);
    try {
      const result = await deactivateSelectedProducts(
        selectedProducts,
        (product) => setProductActive(product, false, appUser.uid),
      );

      if (result.failures.length > 0) {
        setSearchNotice(
          `Đã xử lý ${result.deactivated}/${result.targeted} sản phẩm. ` +
          `${result.failures.length} sản phẩm không thể cập nhật.`,
        );
      } else {
        setSearchNotice(`Đã ngừng kinh doanh ${result.deactivated} sản phẩm.`);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không thể ngừng kinh doanh các sản phẩm đã chọn.');
    } finally {
      setBulkDeactivating(false);
    }
  }

  async function handlePermanentDelete() {
    if (appUser?.role !== 'owner' || bulkDeleting || bulkDeactivating || selectedProducts.length === 0) return;

    let deletedSuccessfully = false;
    setBulkDeleting(true);
    setSearchNotice(null);
    setLoadError(null);
    setDeleteBlockers([]);

    try {
      const preflight = await preflightPermanentProductDeletion(selectedProducts);
      if (!preflight.canDeleteAll) {
        setDeleteBlockers(preflight.blockers);
        setSearchNotice(
          `Đã chặn ${preflight.blockers.length}/${preflight.selected} sản phẩm. Không xóa sản phẩm nào. ` +
          'Hãy bỏ chọn sản phẩm bị chặn rồi thử lại.',
        );
        return;
      }

      const confirmed = window.confirm(
        `Bạn đang xóa vĩnh viễn ${preflight.selected} sản phẩm.\nThao tác này không thể hoàn tác.`,
      );
      if (!confirmed) return;

      const result = await deleteProductsPermanently(selectedProducts, appUser.uid);
      if (!result.preflight.canDeleteAll) {
        setDeleteBlockers(result.preflight.blockers);
        setSearchNotice(
          `Điều kiện xóa đã thay đổi. Đã chặn ${result.preflight.blockers.length}/${result.preflight.selected} sản phẩm. ` +
          'Không xóa sản phẩm nào.',
        );
        return;
      }

      const deletedIds = new Set(result.preflight.eligibleProducts.map((record) => record.storageKey));
      setSelectedProductIds((current) => new Set([...current].filter((id) => !deletedIds.has(id))));
      setSearchNotice(`Đã xóa vĩnh viễn ${result.deleted} sản phẩm.`);
      setFocusStatusAfterDelete(true);
      deletedSuccessfully = true;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Không thể xóa vĩnh viễn các sản phẩm đã chọn.');
    } finally {
      setBulkDeleting(false);
      if (!deletedSuccessfully) {
        requestAnimationFrame(() => permanentDeleteButtonRef.current?.focus());
      }
    }
  }

  function printProducts(targetProducts: Product[]) {
    const initialQuantities = Object.fromEntries(targetProducts.map((product) => [product.id, 1]));
    navigate('/qr-printing', { state: { initialQuantities, source: 'products' } });
  }

  return (
    <div className="products-page">
      <header className="goods-heading">
        <div>
          <h1>Hàng hóa</h1>
          <p className="muted">Quản lý sản phẩm, danh mục, giá bán, tồn kho và thông tin liên quan.</p>
        </div>
        <button className="button button--secondary goods-touch" type="button" onClick={() => setCategoryManagerOpen((current) => !current)}>
          {categoryManagerOpen ? 'Đóng danh mục' : 'Quản lý danh mục'}
        </button>
      </header>

      <GoodsToolbar
        query={query}
        importOpen={importOpen}
        filtersOpen={filtersOpen}
        showExportExcel={appUser?.role === 'owner'}
        exportDisabled={loading}
        onQueryChange={(value) => { setQuery(value); setSearchNotice(null); }}
        onSubmitSearch={handleExactLookup}
        onClearSearch={clearSearch}
        onOpenScanner={() => { void primeScanSuccessFeedback(); setScannerOpen(true); }}
        onToggleImport={() => setImportOpen((current) => !current)}
        onToggleFilters={() => setFiltersOpen((current) => !current)}
        onExportExcel={handleExportExcel}
        onOpenPrinting={() => navigate('/qr-printing')}
        onCreate={openCreate}
      />

      <GoodsKpiBar
        stats={stats}
        stockFilter={stockFilter}
        onStockFilterChange={setStockFilter}
      />

      {searchNotice ? <p ref={statusRef} className="goods-info" role="status" tabIndex={-1}>{searchNotice}</p> : null}
      {loadError ? <p className="form-error" role="alert">{loadError}</p> : null}
      {categoryError ? <p className="form-error" role="alert">{categoryError}</p> : null}

      {categoryManagerOpen && appUser ? <CategoryManager categories={categories} actorUid={appUser.uid} onClose={() => setCategoryManagerOpen(false)} /> : null}

      {importOpen && appUser ? (
        <ProductExcelImportPanel products={products} categories={categories} actorUid={appUser.uid} onClose={() => setImportOpen(false)} />
      ) : null}

      {editorOpen ? (
        <section className="product-editor" aria-label={editingProduct ? 'Sửa sản phẩm' : 'Thêm sản phẩm'}>
          <div className="section-heading">
            <div>
              <h2>{editingProduct ? 'Sửa sản phẩm' : 'Thêm sản phẩm mới'}</h2>
              <p>
                {editingProduct
                  ? canAdjustStock
                    ? 'Có thể chỉnh tồn trực tiếp; mọi thay đổi sẽ được ghi vào biến động kho.'
                    : 'Bạn có thể sửa thông tin sản phẩm; cần quyền Kho để điều chỉnh số lượng tồn.'
                  : 'Sản phẩm mới luôn bắt đầu từ tồn 0.'}
              </p>
            </div>
            <button className="button button--secondary goods-touch" type="button" onClick={closeEditor} disabled={saving}>Đóng</button>
          </div>

          <ProductEditorForm
            key={editingProduct?.id ?? 'create'}
            mode={editingProduct ? 'edit' : 'create'}
            initialValues={editorInitialValues}
            products={products}
            categories={categories}
            editingProductId={editingProduct?.id}
            currentStockQuantity={editingProduct?.stockQuantity}
            canAdjustStock={canAdjustStock}
            saving={saving}
            error={formError}
            onSubmit={handleSubmit}
            onCancel={closeEditor}
          />
        </section>
      ) : null}

      <div className="goods-catalog-layout">
        <GoodsFilters
          open={filtersOpen}
          activeFilter={activeFilter}
          stockFilter={stockFilter}
          categoryFilter={categoryFilter}
          categories={categories}
          onActiveFilterChange={setActiveFilter}
          onStockFilterChange={setStockFilter}
          onCategoryFilterChange={setCategoryFilter}
          onClear={clearFilters}
          onClose={() => setFiltersOpen(false)}
        />

        <section className="goods-panel" aria-label="Danh sách hàng hóa">
          <GoodsBulkActionBar
            count={selectedProducts.length}
            showDeactivate={appUser?.role === 'owner'}
            showPermanentDelete={appUser?.role === 'owner'}
            deactivating={bulkDeactivating}
            deleting={bulkDeleting}
            permanentDeleteButtonRef={permanentDeleteButtonRef}
            onPrint={() => printProducts(selectedProducts)}
            onDeactivate={() => void handleBulkDeactivate()}
            onPermanentDelete={() => void handlePermanentDelete()}
            onClear={() => {
              setSelectedProductIds(new Set());
              setDeleteBlockers([]);
            }}
          />

          {deleteBlockers.length > 0 ? (
            <div className="form-error goods-delete-blockers" role="alert">
              <strong>{deleteBlockers.length} sản phẩm không đủ điều kiện xóa. Không xóa sản phẩm nào.</strong>
              <ul>
                {deleteBlockers.map((blocker) => (
                  <li key={blocker.productId}>
                    <strong>{blocker.sku} - {blocker.name}</strong>: {blocker.reasons.join(' ')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {loading ? (
            <div className="goods-empty">Đang tải hàng hóa...</div>
          ) : filteredProducts.length === 0 ? (
            <div className="goods-empty">
              <strong>{products.length === 0 ? 'Chưa có hàng hóa nào.' : 'Không tìm thấy hàng hóa phù hợp.'}</strong>
              <span>{products.length === 0 ? 'Bấm “+ Thêm sản phẩm” để tạo sản phẩm đầu tiên.' : 'Thử từ khóa khác hoặc xóa bộ lọc hiện tại.'}</span>
            </div>
          ) : (
            <>
              <GoodsTable
                products={filteredProducts}
                categories={categories}
                selectedIds={selectedProductIds}
                onToggleProduct={toggleProductSelection}
                onToggleAllVisible={toggleAllVisible}
                onView={(product) => setDetailProductId(product.id)}
                onEdit={openEdit}
              />
              <GoodsResponsiveList
                products={filteredProducts}
                categories={categories}
                selectedIds={selectedProductIds}
                onToggleProduct={toggleProductSelection}
                onView={(product) => setDetailProductId(product.id)}
                onEdit={openEdit}
              />
            </>
          )}
        </section>
      </div>

      {detailProduct ? (
        <ProductDetail
          product={detailProduct}
          categories={categories}
          changingStatus={changingStatusId === detailProduct.id}
          actorUid={appUser?.uid ?? ''}
          onClose={() => setDetailProductId(null)}
          onEdit={openEdit}
          onToggleActive={(product) => void handleToggleActive(product)}
          onScan={() => { void primeScanSuccessFeedback(); setDetailProductId(null); setScannerOpen(true); }}
          onPrint={(product) => printProducts([product])}
        />
      ) : null}

      {scannerOpen ? (
        <ProductScanDialog
          products={products}
          onClose={() => setScannerOpen(false)}
          onFound={(product) => { setScannerOpen(false); setDetailProductId(product.id); }}
        />
      ) : null}
    </div>
  );
}
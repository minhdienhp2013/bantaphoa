import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import type { Product, Purchase, Supplier } from '../../types/models';
import { subscribeProducts } from '../products/productService';
import { subscribeSuppliers } from '../suppliers/supplierService';
import PurchaseEditor from './PurchaseEditor';
import PurchaseExcelImportPanel from './PurchaseExcelImportPanel';
import PurchaseFilters from './PurchaseFilters';
import PurchaseResponsiveList from './PurchaseResponsiveList';
import PurchaseTable from './PurchaseTable';
import PurchaseToolbar from './PurchaseToolbar';
import {
  clearPurchaseDraft,
  guardPurchaseDraftReplacement,
  loadPurchaseDraft,
  type PurchaseDraft,
} from './purchaseDraft';
import { exportPurchaseListToExcel, exportPurchaseToExcel } from './purchaseExport';
import {
  buildPrintingInitialQuantities,
  filterPurchases,
  getLocalDayBoundary,
  isPurchaseDataLoading,
  paginatePurchases,
  resolveCreatorDisplay,
  type PurchaseSourceLoadState,
  type PurchaseStatusFilter,
} from './purchaseManagementViewModel';
import { cancelPurchase, createPurchase, subscribePurchases, type CreatePurchaseInput } from './purchaseService';
import './purchases.css';
import './purchaseSmartProductSearch.css';
import './purchaseExcelImport.css';
import './purchasesDesktopMobilePolish.css';

type EditorSession = { key: number; source: Purchase | null; draft: PurchaseDraft | null } | null;

export default function PurchasesPage() {
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [importCreatedProducts, setImportCreatedProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchasesLoadState, setPurchasesLoadState] = useState<PurchaseSourceLoadState>('pending');
  const [productsLoadState, setProductsLoadState] = useState<PurchaseSourceLoadState>('pending');
  const [suppliersLoadState, setSuppliersLoadState] = useState<PurchaseSourceLoadState>('pending');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<PurchaseStatusFilter>('all');
  const [supplierId, setSupplierId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [editorSession, setEditorSession] = useState<EditorSession>(null);
  const [creating, setCreating] = useState(false);
  const [busyPurchaseId, setBusyPurchaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const detailWasOpenRef = useRef(false);
  const restoredDraftUidRef = useRef<string | null>(null);

  const availableProducts = useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]));
    for (const product of importCreatedProducts) {
      if (!byId.has(product.id)) byId.set(product.id, product);
    }
    return [...byId.values()];
  }, [products, importCreatedProducts]);

  useEffect(() => {
    if (importCreatedProducts.length === 0) return;
    const subscribedIds = new Set(products.map((product) => product.id));
    setImportCreatedProducts((current) => current.filter((product) => !subscribedIds.has(product.id)));
  }, [products, importCreatedProducts.length]);

  useEffect(() => {
    let unsubPurchases: (() => void) | undefined;
    let unsubProducts: (() => void) | undefined;
    let unsubSuppliers: (() => void) | undefined;

    const sourceError = (
      label: string,
      setLoadState: (state: PurchaseSourceLoadState) => void,
    ) => (cause: Error) => {
      setLoadState('error');
      setError(`Không thể tải ${label}: ${cause.message}`);
    };

    try {
      unsubPurchases = subscribePurchases(
        (next) => {
          setPurchases(next);
          setPurchasesLoadState((current) => current === 'error' ? current : 'ready');
        },
        sourceError('phiếu nhập', setPurchasesLoadState),
      );
      unsubProducts = subscribeProducts(
        (next) => {
          setProducts(next);
          setProductsLoadState((current) => current === 'error' ? current : 'ready');
        },
        sourceError('sản phẩm', setProductsLoadState),
      );
      unsubSuppliers = subscribeSuppliers(
        (next) => {
          setSuppliers(next);
          setSuppliersLoadState((current) => current === 'error' ? current : 'ready');
        },
        sourceError('nhà cung cấp', setSuppliersLoadState),
      );
    } catch (cause) {
      unsubPurchases?.();
      unsubProducts?.();
      unsubSuppliers?.();
      setPurchasesLoadState('error');
      setProductsLoadState('error');
      setSuppliersLoadState('error');
      setError(cause instanceof Error ? cause.message : 'Không thể kết nối dữ liệu nhập hàng.');
      return undefined;
    }

    return () => {
      unsubPurchases?.();
      unsubProducts?.();
      unsubSuppliers?.();
    };
  }, []);

  useEffect(() => {
    const uid = appUser?.uid ?? '';
    if (!uid) {
      restoredDraftUidRef.current = null;
      return;
    }
    if (restoredDraftUidRef.current === uid) return;
    restoredDraftUidRef.current = uid;

    const draft = loadPurchaseDraft(uid);
    if (!draft) return;
    setEditorSession((current) => current ?? { key: Date.now(), source: null, draft });
  }, [appUser?.uid]);

  const fromBoundary = getLocalDayBoundary(fromDate, 'start');
  const toBoundary = getLocalDayBoundary(toDate, 'end');
  const invalidDateRange = fromBoundary !== null && toBoundary !== null && fromBoundary > toBoundary;

  const filteredPurchases = useMemo(() => filterPurchases(purchases, suppliers, {
    query,
    status,
    supplierId,
    fromDate,
    toDate,
    onlyMine,
    currentUserId: appUser?.uid,
  }), [purchases, suppliers, query, status, supplierId, fromDate, toDate, onlyMine, appUser?.uid]);

  const pagination = useMemo(() => paginatePurchases(filteredPurchases, page, pageSize), [filteredPurchases, page, pageSize]);
  const loadState = {
    purchases: purchasesLoadState,
    products: productsLoadState,
    suppliers: suppliersLoadState,
  };
  const loading = isPurchaseDataLoading(loadState);
  const hasLoadError = Object.values(loadState).some((state) => state === 'error');
  const activeFilterCount = Number(status !== 'all') + Number(Boolean(supplierId)) + Number(Boolean(fromDate || toDate)) + Number(onlyMine);

  useEffect(() => { setPage(1); }, [query, status, supplierId, fromDate, toDate, onlyMine]);
  useEffect(() => { if (pagination.page !== page) setPage(pagination.page); }, [pagination.page, page]);
  useEffect(() => {
    if (!selectedPurchaseId) return;
    const existsInRealtimeSource = purchases.some((purchase) => purchase.id === selectedPurchaseId);
    if (existsInRealtimeSource && !filteredPurchases.some((purchase) => purchase.id === selectedPurchaseId)) {
      setSelectedPurchaseId(null);
    }
  }, [purchases, filteredPurchases, selectedPurchaseId]);
  useEffect(() => {
    if (!selectedPurchaseId || !purchases.some((purchase) => purchase.id === selectedPurchaseId)) return;
    requestAnimationFrame(() => document.getElementById(`purchase-detail-${selectedPurchaseId}`)?.scrollIntoView({ block: 'nearest' }));
  }, [purchases, selectedPurchaseId]);
  useEffect(() => {
    if (selectedPurchaseId) {
      detailWasOpenRef.current = true;
      return;
    }
    if (!detailWasOpenRef.current) return;
    detailWasOpenRef.current = false;
    const opener = detailOpenerRef.current;
    detailOpenerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [selectedPurchaseId]);

  function clearFilters() {
    setStatus('all'); setSupplierId(''); setFromDate(''); setToDate(''); setOnlyMine(false); setNotice(null);
  }

  function toggleDetail(purchaseId: string, opener: HTMLElement) {
    detailOpenerRef.current = opener;
    setSelectedPurchaseId((current) => current === purchaseId ? null : purchaseId);
  }

  function closeDetail() { setSelectedPurchaseId(null); }

  function openCreate(source: Purchase | null = null) {
    const uid = appUser?.uid ?? '';
    if (uid && !guardPurchaseDraftReplacement(uid, (message) => window.confirm(message))) return;

    setImportOpen(false);
    setError(null); setNotice(null); setSelectedPurchaseId(null);
    setEditorSession({ key: Date.now(), source, draft: null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openImport() {
    if (productsLoadState !== 'ready') {
      setError('Cần tải xong danh mục Product trước khi đối chiếu Excel.');
      return;
    }
    const uid = appUser?.uid ?? '';
    if (!uid) {
      setError('Không thể xác định người dùng import Excel.');
      return;
    }
    if (!guardPurchaseDraftReplacement(uid, (message) => window.confirm(message))) return;

    setError(null); setNotice(null); setSelectedPurchaseId(null);
    setEditorSession(null);
    setImportOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleImportReady(draft: PurchaseDraft, createdProducts: Product[]) {
    setImportCreatedProducts((current) => {
      const byId = new Map(current.map((product) => [product.id, product]));
      for (const product of createdProducts) byId.set(product.id, product);
      return [...byId.values()];
    });
    setImportOpen(false);
    setError(null);
    setNotice('Đã đưa dữ liệu Excel vào phiếu nhập nháp. Hãy kiểm tra/chỉnh sửa trước khi hoàn tất.');
    setEditorSession({ key: Date.now(), source: null, draft });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleCreate(input: CreatePurchaseInput) {
    if (!appUser || creating) throw new Error('Không thể xác định người dùng tạo phiếu.');
    setCreating(true); setError(null); setNotice(null);
    try {
      const purchase = await createPurchase(input, appUser.uid);
      clearPurchaseDraft(appUser.uid);
      setEditorSession(null);
      setQuery('');
      setStatus('all');
      setSupplierId('');
      setFromDate('');
      setToDate('');
      setOnlyMine(false);
      setPage(1);
      detailOpenerRef.current = null;
      setSelectedPurchaseId(purchase.id);
      setNotice(`Đã tạo ${purchase.code}. Phiếu mới sẽ mở ngay để bạn có thể in tem mã / QR.`);
    } finally {
      setCreating(false);
    }
  }

  function handleExport(purchase: Purchase) {
    setNotice(null); setError(null);
    try {
      exportPurchaseToExcel(purchase, suppliers, resolveCreatorDisplay(purchase.createdBy, appUser));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xuất Excel phiếu nhập.');
    }
  }

  function handleExportList() {
    setNotice(null); setError(null);
    if (invalidDateRange) { setError('Từ ngày không được sau Đến ngày.'); return; }
    if (filteredPurchases.length === 0) { setNotice('Không có phiếu nhập phù hợp bộ lọc để xuất.'); return; }
    try {
      exportPurchaseListToExcel(filteredPurchases, suppliers, (createdBy) => resolveCreatorDisplay(createdBy, appUser));
      setNotice(`Đã chuẩn bị Excel cho ${filteredPurchases.length} phiếu đang lọc.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể xuất danh sách phiếu nhập.');
    }
  }

  function handlePrint(purchase: Purchase) {
    navigate('/qr-printing', {
      state: {
        initialQuantities: buildPrintingInitialQuantities(purchase),
        source: 'purchase',
        purchaseId: purchase.id,
      },
    });
  }

  async function handleCancel(purchase: Purchase) {
    if (!appUser || busyPurchaseId) return;
    const confirmed = window.confirm(`Bạn có chắc muốn hủy phiếu ${purchase.code} và hoàn nhập toàn bộ số lượng? Thao tác này sẽ giảm tồn kho.`);
    if (!confirmed) return;

    setBusyPurchaseId(purchase.id); setError(null); setNotice(null);
    try {
      await cancelPurchase(purchase.id, appUser.uid);
      setNotice(`Đã hủy ${purchase.code} và hoàn nhập toàn bộ số lượng.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể hủy và hoàn nhập phiếu.');
    } finally {
      setBusyPurchaseId(null);
    }
  }

  const listProps = {
    purchases: pagination.items,
    suppliers,
    appUser,
    selectedPurchaseId,
    busyPurchaseId,
    onToggleDetail: toggleDetail,
    onCollapseDetail: closeDetail,
    onExport: handleExport,
    onPrint: handlePrint,
    onCopy: (purchase: Purchase) => openCreate(purchase),
    onCancel: (purchase: Purchase) => void handleCancel(purchase),
  };

  return (
    <div className="purchase-page">
      <header className="purchase-page-header"><div><h1>Nhập hàng</h1><p className="muted">Quản lý các phiếu nhập hàng và lịch sử nhập kho.</p></div></header>
      {error ? <p className="form-error purchase-message" role="alert">{error}</p> : null}
      {notice ? <p className="purchase-success purchase-message" role="status">{notice}</p> : null}

      <div className="purchase-workspace">
        <PurchaseFilters open={filtersOpen} status={status} supplierId={supplierId} fromDate={fromDate} toDate={toDate} onlyMine={onlyMine} suppliers={suppliers} onStatusChange={setStatus} onSupplierChange={setSupplierId} onFromDateChange={setFromDate} onToDateChange={setToDate} onOnlyMineChange={setOnlyMine} onClear={clearFilters} onClose={() => setFiltersOpen(false)} />

        <main className="purchase-main">
          <PurchaseToolbar query={query} filtersOpen={filtersOpen} activeFilterCount={activeFilterCount} importDisabled={productsLoadState !== 'ready'} exportDisabled={loading || hasLoadError} onQueryChange={(value) => { setQuery(value); setNotice(null); }} onToggleFilters={() => setFiltersOpen((current) => !current)} onImport={openImport} onCreate={() => openCreate()} onExport={handleExportList} />

          {importOpen && appUser ? <PurchaseExcelImportPanel products={availableProducts} suppliers={suppliers} actorUid={appUser.uid} onClose={() => setImportOpen(false)} onReady={handleImportReady} /> : null}

          {editorSession ? <PurchaseEditor key={editorSession.key} products={availableProducts} suppliers={suppliers} actorUid={appUser?.uid ?? ''} sourcePurchase={editorSession.source} initialDraft={editorSession.draft} busy={creating} onClose={() => { if (!creating) setEditorSession(null); }} onSubmit={handleCreate} /> : null}

          <section className="purchase-list-panel" aria-label="Danh sách phiếu nhập">
            <div className="purchase-list-heading"><span>{loading ? 'Đang tải phiếu nhập...' : hasLoadError ? 'Không thể tải đầy đủ dữ liệu nhập hàng' : `Hiển thị ${filteredPurchases.length} phiếu nhập hàng`}</span></div>
            {invalidDateRange ? <p className="form-error purchase-inline-error" role="alert">Từ ngày không được sau Đến ngày.</p> : null}

            {loading ? (
              <div className="purchase-empty">Đang tải dữ liệu nhập hàng...</div>
            ) : hasLoadError ? (
              <div className="purchase-empty purchase-load-error" role="status"><strong>Không thể tải đầy đủ dữ liệu nhập hàng.</strong><span>Vui lòng xem lỗi phía trên và thử tải lại trang.</span></div>
            ) : filteredPurchases.length === 0 ? (
              <div className="purchase-empty"><strong>{purchases.length === 0 ? 'Chưa có phiếu nhập.' : 'Không có phiếu phù hợp bộ lọc.'}</strong><span>{purchases.length === 0 ? 'Bấm “+ Nhập hàng” để tạo phiếu đầu tiên.' : 'Thử thay đổi từ khóa hoặc đặt lại bộ lọc.'}</span></div>
            ) : (
              <><PurchaseTable {...listProps} /><PurchaseResponsiveList {...listProps} /></>
            )}

            {!loading && !hasLoadError && filteredPurchases.length > 0 ? (
              <div className="purchase-pagination">
                <label>Hiển thị <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); closeDetail(); }}><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option></select> / trang</label>
                <span>Trang {pagination.page}/{pagination.totalPages} · {pagination.totalRows} phiếu</span>
                <div><button type="button" className="button button--secondary purchase-touch" disabled={pagination.page <= 1} onClick={() => { closeDetail(); setPage((current) => Math.max(1, current - 1)); }}>‹</button><button type="button" className="button button--secondary purchase-touch" disabled={pagination.page >= pagination.totalPages} onClick={() => { closeDetail(); setPage((current) => Math.min(pagination.totalPages, current + 1)); }}>›</button></div>
              </div>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  );
}

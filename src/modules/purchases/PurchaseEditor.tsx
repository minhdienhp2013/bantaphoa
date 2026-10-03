import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import VndMoneyInput from '../../shared/numeric/VndMoneyInput';
import type { Product, Purchase, Supplier } from '../../types/models';
import BarcodeScanner from '../qr/BarcodeScanner';
import { findProductByScannedCode } from '../qr/productLookup';
import '../qr/qrPrinting.css';
import {
  PURCHASE_DRAFT_VERSION,
  clearPurchaseDraft,
  isMeaningfulPurchaseDraft,
  savePurchaseDraft,
  type PurchaseDraft,
  type PurchaseDraftLine,
} from './purchaseDraft';
import PurchaseProductPicker from './PurchaseProductPicker';
import PurchaseQuickAddProduct from './PurchaseQuickAddProduct';
import type { CreatePurchaseInput } from './purchaseService';

interface EditorLine {
  key: string;
  productId: string;
  quantity: number;
  unitCost: number;
  salePrice?: number;
  historicalSku?: string;
  historicalName?: string;
}

interface PurchaseEditorProps {
  products: readonly Product[];
  suppliers: readonly Supplier[];
  actorUid: string;
  sourcePurchase?: Purchase | null;
  initialDraft?: PurchaseDraft | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: CreatePurchaseInput) => Promise<void>;
}

interface QuickAddTarget {
  lineKey: string;
  initialName: string;
  opener: HTMLButtonElement;
}

let editorLineSequence = 0;
function nextLineKey() {
  editorLineSequence += 1;
  return `purchase-line-${editorLineSequence}`;
}

function emptyLine(): EditorLine {
  return { key: nextLineKey(), productId: '', quantity: 1, unitCost: 0 };
}

function draftLineToEditorLine(line: PurchaseDraftLine): EditorLine {
  return {
    key: nextLineKey(),
    productId: line.productId,
    quantity: line.quantity,
    unitCost: line.unitCost,
    ...(typeof line.salePrice === 'number' ? { salePrice: line.salePrice } : {}),
    ...(line.historicalSku ? { historicalSku: line.historicalSku } : {}),
    ...(line.historicalName ? { historicalName: line.historicalName } : {}),
  };
}

function initialLines(source?: Purchase | null, draft?: PurchaseDraft | null): EditorLine[] {
  if (draft?.lines.length) return draft.lines.map(draftLineToEditorLine);
  if (!source || !Array.isArray(source.items) || source.items.length === 0) return [emptyLine()];
  return source.items.map((item) => ({
    key: nextLineKey(),
    productId: item.productId,
    quantity: Number(item.quantity) || 0,
    unitCost: Number(item.unitCost) || 0,
    historicalSku: item.sku,
    historicalName: item.name,
  }));
}

function money(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(value));
}

export default function PurchaseEditor({
  products,
  suppliers,
  actorUid,
  sourcePurchase,
  initialDraft,
  busy,
  onClose,
  onSubmit,
}: PurchaseEditorProps) {
  const restoredDraft = sourcePurchase ? null : initialDraft;
  const [createdProducts, setCreatedProducts] = useState<Product[]>([]);
  const availableProducts = useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]));
    for (const product of createdProducts) {
      if (!byId.has(product.id)) byId.set(product.id, product);
    }
    return [...byId.values()];
  }, [products, createdProducts]);
  const activeProducts = useMemo(() => availableProducts.filter((product) => product.active), [availableProducts]);
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.active), [suppliers]);
  const copiedSupplier = sourcePurchase?.supplierId
    ? activeSuppliers.find((supplier) => supplier.id === sourcePurchase.supplierId)
    : undefined;
  const [supplierId, setSupplierId] = useState(restoredDraft?.supplierId ?? copiedSupplier?.id ?? '');
  const [supplierName, setSupplierName] = useState(restoredDraft?.supplierName ?? sourcePurchase?.supplierName ?? copiedSupplier?.name ?? '');
  const [note, setNote] = useState(restoredDraft?.note ?? sourcePurchase?.note ?? '');
  const [lines, setLines] = useState<EditorLine[]>(() => initialLines(sourcePurchase, restoredDraft));
  const [error, setError] = useState('');
  const [scanTargetLineKey, setScanTargetLineKey] = useState<string | null>(null);
  const [scanError, setScanError] = useState('');
  const [quickAddTarget, setQuickAddTarget] = useState<QuickAddTarget | null>(null);
  const quantityInputRefs = useRef(new Map<string, HTMLInputElement>());
  const contextPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (createdProducts.length === 0) return;
    const subscribedIds = new Set(products.map((product) => product.id));
    setCreatedProducts((current) => current.filter((product) => !subscribedIds.has(product.id)));
  }, [products, createdProducts.length]);

  useEffect(() => {
    if (!scanTargetLineKey) return undefined;
    const frame = requestAnimationFrame(() => {
      contextPanelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [scanTargetLineKey]);

  const activeProductById = useMemo(() => new Map(activeProducts.map((product) => [product.id, product])), [activeProducts]);

  useEffect(() => {
    setLines((current) => {
      let changed = false;
      const next = current.map((line) => {
        if (typeof line.salePrice === 'number' || !line.productId) return line;
        const product = activeProductById.get(line.productId);
        if (!product) return line;
        changed = true;
        return { ...line, salePrice: product.salePrice };
      });
      return changed ? next : current;
    });
  }, [activeProductById]);

  const unavailableLines = lines.filter((line) => line.productId && !activeProductById.has(line.productId));
  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0);
  const currentDraft = useMemo<PurchaseDraft>(() => ({
    version: PURCHASE_DRAFT_VERSION,
    supplierId,
    supplierName,
    note,
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitCost: line.unitCost,
      ...(typeof line.salePrice === 'number' ? { salePrice: line.salePrice } : {}),
      ...(line.historicalSku ? { historicalSku: line.historicalSku } : {}),
      ...(line.historicalName ? { historicalName: line.historicalName } : {}),
    })),
  }), [supplierId, supplierName, note, lines]);

  useEffect(() => {
    savePurchaseDraft(actorUid, currentDraft);
  }, [actorUid, currentDraft]);

  function patchLine(lineKey: string, patch: Partial<EditorLine>) {
    setLines((current) => current.map((line) => line.key === lineKey ? { ...line, ...patch } : line));
  }

  function focusQuantity(lineKey: string) {
    requestAnimationFrame(() => quantityInputRefs.current.get(lineKey)?.focus());
  }

  function selectProduct(lineKey: string, product: Product) {
    patchLine(lineKey, {
      productId: product.id,
      unitCost: product.costPrice,
      salePrice: product.salePrice,
      historicalSku: undefined,
      historicalName: undefined,
    });
    setError('');
    focusQuantity(lineKey);
  }

  function removeLine(lineKey: string) {
    if (scanTargetLineKey === lineKey) {
      setScanTargetLineKey(null);
      setScanError('');
    }
    if (quickAddTarget?.lineKey === lineKey) setQuickAddTarget(null);
    quantityInputRefs.current.delete(lineKey);
    setLines((current) => current.filter((line) => line.key !== lineKey));
  }

  function openScanner(lineKey: string) {
    setQuickAddTarget(null);
    setScanError('');
    setScanTargetLineKey(lineKey);
  }

  function handleScan(rawCode: string) {
    const code = rawCode.trim();
    if (!scanTargetLineKey || !code) return;
    const match = findProductByScannedCode([...availableProducts], code);
    if (!match) {
      setScanError(`Không tìm thấy sản phẩm có mã ${code}.`);
      return;
    }
    if (!match.product.active) {
      setScanError('Sản phẩm đã ngừng sử dụng.');
      return;
    }

    const targetLineKey = scanTargetLineKey;
    selectProduct(targetLineKey, match.product);
    setScanTargetLineKey(null);
    setScanError('');
  }

  function openQuickAdd(lineKey: string, query: string, opener: HTMLButtonElement) {
    setScanTargetLineKey(null);
    setScanError('');
    setQuickAddTarget({ lineKey, initialName: query.trim(), opener });
  }

  function closeQuickAdd(restoreFocus: boolean) {
    const opener = quickAddTarget?.opener;
    setQuickAddTarget(null);
    if (restoreFocus && opener?.isConnected) requestAnimationFrame(() => opener.focus());
  }

  function handleQuickProductCreated(product: Product) {
    if (!quickAddTarget) return;
    const targetLineKey = quickAddTarget.lineKey;
    setCreatedProducts((current) => current.some((item) => item.id === product.id) ? current : [...current, product]);
    setQuickAddTarget(null);
    selectProduct(targetLineKey, product);
  }

  function requestCloseEditor() {
    if (busy) return;
    if (isMeaningfulPurchaseDraft(currentDraft) && !window.confirm('Bỏ phiếu nhập đang soạn?')) return;
    clearPurchaseDraft(actorUid);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');

    if (unavailableLines.length > 0) {
      setError('Có sản phẩm từ phiếu cũ không còn khả dụng. Hãy chọn sản phẩm thay thế hoặc xóa dòng trước khi hoàn tất.');
      return;
    }

    if (lines.some((line) => typeof line.salePrice !== 'number' || !Number.isFinite(line.salePrice) || line.salePrice < 0)) {
      setError('Giá bán không hợp lệ.');
      return;
    }

    try {
      await onSubmit({
        items: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          salePrice: line.salePrice as number,
        })),
        ...(supplierId ? { supplierId } : {}),
        ...(supplierName.trim() ? { supplierName: supplierName.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể hoàn tất phiếu nhập.');
    }
  }

  return (
    <>
      <div className="purchase-modal-backdrop" aria-hidden="true" />
      <section className="purchase-editor purchase-modal-surface purchase-editor-modal" aria-labelledby="purchase-editor-title">
        <button
          className="purchase-modal-close"
          type="button"
          onClick={requestCloseEditor}
          disabled={busy}
          aria-label="Đóng cửa sổ nhập hàng"
        >
          ×
        </button>
        <div className="purchase-editor-heading">
        <div>
          <p className="eyebrow">{sourcePurchase ? 'Sao chép thành phiếu mới' : restoredDraft ? 'Khôi phục phiếu đang soạn' : 'Phiếu nhập mới'}</p>
          <h2 id="purchase-editor-title">{sourcePurchase ? 'Sao chép để sửa' : 'Nhập hàng'}</h2>
          <p className="muted">{sourcePurchase ? `Dữ liệu được sao chép từ ${sourcePurchase.code}. Chưa có gì được ghi vào kho cho tới khi hoàn tất.` : restoredDraft ? 'Phiếu đang soạn đã được khôi phục từ phiên làm việc này. Chưa có thay đổi tồn kho.' : 'Phiếu chỉ được ghi vào Firebase và tăng tồn khi bấm Hoàn tất nhập hàng.'}</p>
          <p className="muted purchase-editor-price-note">Giá bán bạn chỉnh tại đây chỉ cập nhật giá bán hiện tại của sản phẩm trong Hàng hóa sau khi phiếu nhập được hoàn tất thành công; trước khi hoàn tất, danh mục sản phẩm chưa thay đổi.</p>
        </div>
      </div>

      <form onSubmit={(event) => void handleSubmit(event)}>
        <div className="purchase-editor-supplier-grid">
          <label>Nhà cung cấp
            <select value={supplierId} onChange={(event) => {
              const nextId = event.target.value;
              const supplier = activeSuppliers.find((item) => item.id === nextId);
              setSupplierId(nextId);
              if (supplier) setSupplierName(supplier.name);
            }}>
              <option value="">— Chưa chọn danh mục —</option>
              {activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} - {supplier.name}</option>)}
            </select>
          </label>
          <label>Tên NCC trên phiếu mới
            <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Tên nhà cung cấp" />
          </label>
        </div>

        {unavailableLines.length > 0 ? (
          <p className="purchase-editor-warning" role="alert">Có {unavailableLines.length} dòng từ phiếu cũ hoặc draft chứa sản phẩm đã ngừng sử dụng hoặc không còn trong danh mục. Hãy xử lý các dòng này trước khi hoàn tất.</p>
        ) : null}

        <div className="purchase-editor-lines" aria-label="Danh sách sản phẩm nhập">
          <div className="purchase-editor-line purchase-editor-line--header" aria-hidden="true"><span>Sản phẩm</span><span>Số lượng</span><span>Giá nhập</span><span>Giá bán</span><span>Thành tiền</span><span>Xóa</span></div>
          {lines.map((line, index) => {
            const activeProduct = activeProductById.get(line.productId);
            const unavailable = Boolean(line.productId && !activeProduct);
            const scanTitleId = `purchase-scan-title-${line.key}`;
            return (
              <Fragment key={line.key}>
                <div className={`purchase-editor-line${unavailable ? ' is-unavailable' : ''}`}>
                  <div className="purchase-editor-product-field"><span className="purchase-mobile-label">Sản phẩm</span>
                    <PurchaseProductPicker
                      lineKey={line.key}
                      products={availableProducts}
                      productId={line.productId}
                      historicalSku={line.historicalSku}
                      historicalName={line.historicalName}
                      disabled={busy}
                      onSelect={(product) => selectProduct(line.key, product)}
                      onClearSelection={() => patchLine(line.key, { productId: '', salePrice: undefined, historicalSku: undefined, historicalName: undefined })}
                      onScanRequest={openScanner}
                      onQuickAddRequest={openQuickAdd}
                    />
                  </div>
                  <label><span className="purchase-mobile-label">Số lượng</span><input ref={(node) => { if (node) quantityInputRefs.current.set(line.key, node); else quantityInputRefs.current.delete(line.key); }} type="number" inputMode="numeric" min="1" step="1" value={line.quantity} onChange={(event) => patchLine(line.key, { quantity: Number(event.target.value) })} /></label>
                  <VndMoneyInput label="Giá nhập" labelClassName="purchase-mobile-label" value={line.unitCost} onChange={(value) => patchLine(line.key, { unitCost: Number(value) })} />
                  <VndMoneyInput label="Giá bán" labelClassName="purchase-mobile-label" value={line.salePrice ?? ''} onChange={(value) => patchLine(line.key, { salePrice: Number(value) })} />
                  <strong className="purchase-editor-line-total">{money(line.quantity * line.unitCost)} đ</strong>
                  <button className="purchase-editor-remove" type="button" onClick={() => removeLine(line.key)} disabled={busy || lines.length === 1} aria-label={`Xóa dòng ${index + 1}`}>×</button>
                </div>

                {scanTargetLineKey === line.key ? (
                  <div className="purchase-editor-context-panel" ref={contextPanelRef}>
                    <section className="purchase-scan-panel" aria-labelledby={scanTitleId}>
                      <div className="purchase-scan-heading">
                        <div><h3 id={scanTitleId}>Quét sản phẩm cho dòng {index + 1}</h3><p className="muted">Chỉ mã QR, barcode hoặc SKU chính xác mới được chọn.</p></div>
                        <button className="button button--secondary purchase-touch" type="button" onClick={() => { setScanTargetLineKey(null); setScanError(''); }}>Đóng camera</button>
                      </div>
                      {scanError ? <p className="form-error" role="alert">{scanError}</p> : null}
                      <BarcodeScanner onScan={(result) => handleScan(result.value)} autoStart />
                    </section>
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>

        <div className="purchase-editor-add"><button className="button button--secondary purchase-touch" type="button" onClick={() => setLines((current) => [...current, emptyLine()])} disabled={busy}>+ Thêm dòng</button></div>

        <div className="purchase-editor-footer">
          <label>Ghi chú<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ghi chú cho phiếu nhập hàng..." /></label>
          <div className="purchase-editor-total"><span>Tổng tiền</span><strong>{money(total)} đ</strong></div>
        </div>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="purchase-editor-actions">
          <button className="button button--secondary purchase-touch" type="button" onClick={requestCloseEditor} disabled={busy}>Hủy soạn</button>
          <button className="button button--primary purchase-touch" type="submit" disabled={busy || unavailableLines.length > 0}>{busy ? 'Đang hoàn tất...' : 'Hoàn tất nhập hàng'}</button>
        </div>
      </form>

        {quickAddTarget ? (
          <PurchaseQuickAddProduct
            products={availableProducts}
            actorUid={actorUid}
            initialName={quickAddTarget.initialName}
            onCreated={handleQuickProductCreated}
            onClose={() => closeQuickAdd(true)}
          />
        ) : null}
      </section>
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { MAX_PRODUCT_SEARCH_LIMIT, searchProducts } from '../../shared/search/productSearch';
import type { Product, StoreSettings } from '../../types/models';
import { isValidEan13, type BarcodeKind } from './codeGraphics';
import LabelPreview, { type LabelDisplayOptions, type PrintableLabel } from './LabelPreview';
import {
  DEFAULT_LABEL_CONFIG,
  LABEL_74X22_PAGE_HEIGHT_MM,
  LABEL_74X22_PAGE_WIDTH_MM,
  LABEL_74X22_QR_DEFAULT_MM,
  LABEL_74X22_QR_MAX_MM,
  LABEL_74X22_QR_MIN_MM,
  LABEL_PRESETS,
  clamp74x22QrSizeMm,
  is74x22RowPage,
  validateLabelConfig,
  type LabelPaperConfig,
} from './labelPresets';
import { printLabels } from './printService';
import { subscribeStoreSettings } from './settingsReader';

interface PrintWorkspaceProps {
  products: Product[];
  initialQuantities?: Readonly<Record<string, number>>;
}

const LEGACY_QR_SIZE_MM = 14;

export function partitionProductsSelectedFirst(
  products: readonly Product[],
  quantities: Readonly<Record<string, number>>,
): Product[] {
  const selected: Product[] = [];
  const unselected: Product[] = [];

  for (const product of products) {
    if ((quantities[product.id] ?? 0) > 0) selected.push(product);
    else unselected.push(product);
  }

  return [...selected, ...unselected];
}

export function searchProductsForPrinting(
  products: readonly Product[],
  query: string,
): Product[] {
  const trimmed = query.trim();
  if (!trimmed) return [...products];

  return searchProducts(products, trimmed, { limit: MAX_PRODUCT_SEARCH_LIMIT })
    .map((result) => result.product);
}

export function sanitizeInitialQuantities(
  products: readonly Product[],
  initialQuantities: unknown,
): Record<string, number> {
  if (!initialQuantities || typeof initialQuantities !== 'object' || Array.isArray(initialQuantities)) {
    return {};
  }

  const productIds = new Set(products.map((product) => product.id));
  const sanitized: Record<string, number> = {};

  for (const [productId, rawQuantity] of Object.entries(initialQuantities)) {
    if (!productIds.has(productId) || typeof rawQuantity !== 'number' || !Number.isFinite(rawQuantity)) {
      continue;
    }

    sanitized[productId] = Math.max(0, Math.min(999, Math.floor(rawQuantity)));
  }

  return sanitized;
}

function cloneConfig(config: LabelPaperConfig): LabelPaperConfig {
  return { ...config };
}

export default function PrintWorkspace({ products, initialQuantities }: PrintWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>(
    () => sanitizeInitialQuantities(products, initialQuantities),
  );
  const [config, setConfig] = useState<LabelPaperConfig>(() => cloneConfig(DEFAULT_LABEL_CONFIG));
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [printError, setPrintError] = useState('');
  const [options, setOptions] = useState<LabelDisplayOptions>({
    showName: true,
    showSku: true,
    showBarcode: false,
    showQr: true,
    showPrice: true,
    showUnit: false,
    showStoreName: false,
    barcodeKind: 'CODE128',
    qrSizeMm: LABEL_74X22_QR_DEFAULT_MM,
    storeName: undefined,
  });

  useEffect(() => subscribeStoreSettings(setSettings), []);

  useEffect(() => {
    setOptions((current) => ({ ...current, storeName: settings?.storeName?.trim() || undefined }));
  }, [settings?.storeName]);

  const filteredProducts = useMemo(() => {
    const matchingProducts = searchProductsForPrinting(products, query);
    return partitionProductsSelectedFirst(matchingProducts, quantities);
  }, [products, query, quantities]);

  const labels = useMemo<PrintableLabel[]>(() => {
    const output: PrintableLabel[] = [];
    for (const product of products) {
      const quantity = quantities[product.id] ?? 0;
      for (let index = 0; index < quantity; index += 1) {
        output.push({ key: `${product.id}-${index}`, product });
      }
    }
    return output;
  }, [products, quantities]);

  const validationErrors = validateLabelConfig(config);
  const eanWarnings = useMemo(() => {
    if (!options.showBarcode || options.barcodeKind !== 'EAN13') return [];
    return products
      .filter((product) => (quantities[product.id] ?? 0) > 0)
      .filter((product) => !isValidEan13(product.barcode?.trim() || product.sku.trim()))
      .map((product) => `${product.sku} – ${product.name}`);
  }, [options.barcodeKind, options.showBarcode, products, quantities]);

  const rowPage74x22 = is74x22RowPage(config);

  const updateConfigNumber = (field: keyof Pick<LabelPaperConfig, 'labelWidthMm' | 'labelHeightMm' | 'columns' | 'gapHorizontalMm' | 'gapVerticalMm' | 'marginMm'>, value: number) => {
    setConfig((current) => ({ ...current, id: 'custom', name: 'Khổ tùy chỉnh', [field]: value }));
  };

  const applyPreset = (preset: LabelPaperConfig) => {
    setConfig(cloneConfig(preset));
    setOptions((current) => is74x22RowPage(preset)
      ? {
          ...current,
          showBarcode: false,
          showStoreName: false,
          qrSizeMm: LABEL_74X22_QR_DEFAULT_MM,
        }
      : {
          ...current,
          showBarcode: true,
          showStoreName: true,
          qrSizeMm: LEGACY_QR_SIZE_MM,
        });
  };

  const setQuantity = (productId: string, value: number) => {
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(999, Math.floor(value))) : 0;
    setQuantities((current) => {
      const next = { ...current };
      if (safe <= 0) delete next[productId];
      else next[productId] = safe;
      return next;
    });
  };

  const toggleOption = (field: keyof Omit<LabelDisplayOptions, 'barcodeKind' | 'qrSizeMm' | 'storeName'>) => {
    setOptions((current) => ({ ...current, [field]: !current[field] }));
  };

  const handlePrint = () => {
    setPrintError('');
    try {
      printLabels(rowPage74x22
        ? { widthMm: LABEL_74X22_PAGE_WIDTH_MM, heightMm: LABEL_74X22_PAGE_HEIGHT_MM }
        : undefined);
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : 'Không thể mở hộp thoại in.');
    }
  };

  return (
    <section className="printing-workspace" aria-labelledby="printing-heading">
      <div className="qr-section-heading">
        <div>
          <p className="eyebrow">In tem trình duyệt</p>
          <h2 id="printing-heading">Thiết kế và xem trước tem</h2>
        </div>
        <strong>{labels.length} tem</strong>
      </div>

      <div className="printing-grid">
        <div className="printing-panel printing-panel--products">
          <h3>1. Chọn sản phẩm</h3>
          <label className="qr-field">
            Tìm sản phẩm
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tên/SKU/barcode/QR — gõ không dấu, sai nhẹ hoặc đảo từ…"
            />
          </label>
          <div className="print-product-list">
            {filteredProducts.length ? filteredProducts.map((product) => {
              const quantity = quantities[product.id] ?? 0;
              return (
                <div className="print-product-row" key={product.id}>
                  <label className="print-product-check">
                    <input
                      type="checkbox"
                      checked={quantity > 0}
                      onChange={(event) => setQuantity(product.id, event.target.checked ? Math.max(1, quantity) : 0)}
                    />
                    <span><strong>{product.name}</strong><small>{product.sku}</small></span>
                  </label>
                  <label className="print-quantity">
                    SL tem
                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="999"
                      value={quantity}
                      onChange={(event) => setQuantity(product.id, Number(event.target.value))}
                    />
                  </label>
                </div>
              );
            }) : <p className="muted">Không tìm thấy sản phẩm phù hợp.</p>}
          </div>
        </div>

        <div className="printing-panel">
          <h3>2. Khổ giấy và nội dung</h3>
          <label className="qr-field">
            Khổ tem
            <select
              value={LABEL_PRESETS.some((preset) => preset.id === config.id) ? config.id : 'custom'}
              onChange={(event) => {
                const preset = LABEL_PRESETS.find((item) => item.id === event.target.value);
                if (preset) applyPreset(preset);
                else setConfig((current) => ({ ...current, id: 'custom', name: 'Khổ tùy chỉnh' }));
              }}
            >
              {LABEL_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              <option value="custom">Khổ tùy chỉnh</option>
            </select>
          </label>

          <div className="print-size-grid">
            <label>Rộng mỗi tem (mm)<input type="number" min="0.1" step="0.1" value={config.labelWidthMm} onChange={(e) => updateConfigNumber('labelWidthMm', Number(e.target.value))} /></label>
            <label>Cao mỗi tem (mm)<input type="number" min="0.1" step="0.1" value={config.labelHeightMm} onChange={(e) => updateConfigNumber('labelHeightMm', Number(e.target.value))} /></label>
            <label>Số cột<input type="number" min="1" max="8" step="1" value={config.columns} onChange={(e) => updateConfigNumber('columns', Number(e.target.value))} /></label>
            <label>Gap ngang (mm)<input type="number" min="0" step="0.1" value={config.gapHorizontalMm} onChange={(e) => updateConfigNumber('gapHorizontalMm', Number(e.target.value))} /></label>
            <label>Gap dọc (mm)<input type="number" min="0" step="0.1" value={config.gapVerticalMm} onChange={(e) => updateConfigNumber('gapVerticalMm', Number(e.target.value))} /></label>
            <label>Margin (mm)<input type="number" min="0" step="0.05" value={config.marginMm} onChange={(e) => updateConfigNumber('marginMm', Number(e.target.value))} /></label>
          </div>

          {validationErrors.length ? <div className="qr-error" role="alert">{validationErrors.join(' ')}</div> : null}

          <fieldset className="print-options">
            <legend>Thành phần trên tem</legend>
            <label><input type="checkbox" checked={options.showName} onChange={() => toggleOption('showName')} /> Tên sản phẩm</label>
            <label><input type="checkbox" checked={options.showSku} onChange={() => toggleOption('showSku')} /> SKU</label>
            <label><input type="checkbox" checked={options.showBarcode} onChange={() => toggleOption('showBarcode')} /> Barcode</label>
            <label><input type="checkbox" checked={options.showQr} onChange={() => toggleOption('showQr')} /> QR</label>
            <label><input type="checkbox" checked={options.showPrice} onChange={() => toggleOption('showPrice')} /> Giá bán</label>
            <label><input type="checkbox" checked={options.showUnit} onChange={() => toggleOption('showUnit')} /> Đơn vị tính</label>
            <label><input type="checkbox" checked={options.showStoreName} onChange={() => toggleOption('showStoreName')} /> Tên cửa hàng</label>
          </fieldset>

          {rowPage74x22 && options.showQr ? (
            <label className="qr-field">
              Kích thước QR (mm)
              <input
                type="number"
                min={LABEL_74X22_QR_MIN_MM}
                max={LABEL_74X22_QR_MAX_MM}
                step="0.5"
                value={options.qrSizeMm}
                onChange={(event) => setOptions((current) => ({
                  ...current,
                  qrSizeMm: clamp74x22QrSizeMm(Number(event.target.value)),
                }))}
              />
              <small className="muted">Cho phép {LABEL_74X22_QR_MIN_MM}–{LABEL_74X22_QR_MAX_MM} mm; mặc định {LABEL_74X22_QR_DEFAULT_MM} mm.</small>
            </label>
          ) : null}

          {options.showBarcode ? (
            <label className="qr-field">
              Chuẩn barcode
              <select value={options.barcodeKind} onChange={(event) => setOptions((current) => ({ ...current, barcodeKind: event.target.value as BarcodeKind }))}>
                <option value="CODE128">CODE128 (mặc định)</option>
                <option value="EAN13">EAN-13 (chỉ mã hợp lệ)</option>
              </select>
            </label>
          ) : null}

          {options.barcodeKind === 'EAN13' && eanWarnings.length ? (
            <div className="qr-warning" role="status">
              <strong>EAN-13 không hợp lệ:</strong> {eanWarnings.slice(0, 4).join('; ')}{eanWarnings.length > 4 ? ` và ${eanWarnings.length - 4} sản phẩm khác` : ''}. Các tem này sẽ không giả tạo mã EAN-13.
            </div>
          ) : null}
        </div>

        <div className="printing-panel printing-panel--preview">
          <div className="print-preview-heading">
            <div>
              <h3>3. Preview</h3>
              <p className="muted">Kích thước dùng đơn vị mm. Với giấy 74 × 22 mm, mỗi hàng xem trước là một trang in vật lý. Khi in, chọn Scale 100% và Margin None nếu driver yêu cầu.</p>
            </div>
            <button className="button button--primary qr-touch-button" type="button" disabled={!labels.length || validationErrors.length > 0} onClick={handlePrint}>
              In tem
            </button>
          </div>
          {printError ? <p className="qr-error" role="alert">{printError}</p> : null}
          <LabelPreview labels={labels} config={config} options={options} />
        </div>
      </div>
    </section>
  );
}

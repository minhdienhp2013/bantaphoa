import type { CSSProperties } from 'react';
import type { Product } from '../../types/models';
import { BarcodeGraphic, QrGraphic, type BarcodeKind } from './codeGraphics';
import {
  LABEL_74X22_PAGE_HEIGHT_MM,
  clamp74x22QrSizeMm,
  getSheetWidthMm,
  is74x22RowPage,
  type LabelPaperConfig,
} from './labelPresets';

export interface LabelDisplayOptions {
  showName: boolean;
  showSku: boolean;
  showBarcode: boolean;
  showQr: boolean;
  showPrice: boolean;
  showUnit: boolean;
  showStoreName: boolean;
  barcodeKind: BarcodeKind;
  qrSizeMm: number;
  storeName?: string;
}

export interface PrintableLabel {
  key: string;
  product: Product;
}

interface LabelPreviewProps {
  labels: PrintableLabel[];
  config: LabelPaperConfig;
  options: LabelDisplayOptions;
}

function formatPrice(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value) + ' ₫';
}

export function getAdaptiveNameClass(name: string): string {
  const length = Array.from(name.trim()).length;
  if (length <= 22) return 'product-label__name--short';
  if (length <= 42) return 'product-label__name--medium';
  if (length <= 70) return 'product-label__name--long';
  return 'product-label__name--xlong';
}

export function groupLabelsIntoRowPages<T>(items: readonly T[], columns = 2): T[][] {
  if (!Number.isInteger(columns) || columns <= 0) return [];
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += columns) {
    pages.push(items.slice(index, index + columns));
  }
  return pages;
}

function LabelCard({
  product,
  options,
  compact74x22 = false,
}: {
  product: Product;
  options: LabelDisplayOptions;
  compact74x22?: boolean;
}) {
  const qrValue = product.qrCode?.trim() || product.sku.trim() || product.id;
  const barcodeValue = product.barcode?.trim() || product.sku.trim();
  const nameClass = getAdaptiveNameClass(product.name);

  if (compact74x22) {
    return (
      <article className={`product-label product-label--74x22${options.showQr ? '' : ' product-label--no-qr'}`}>
        <div className="product-label__text product-label__text--74x22">
          {options.showStoreName && options.storeName ? <div className="product-label__store">{options.storeName}</div> : null}
          {options.showName ? <div className={`product-label__name ${nameClass}`} title={product.name}>{product.name}</div> : null}
          {options.showPrice ? <div className="product-label__price">{formatPrice(product.salePrice)}</div> : null}
          {options.showSku ? <div className="product-label__sku">SKU: {product.sku}</div> : null}
          {options.showUnit && product.unit ? <div className="product-label__unit">ĐVT: {product.unit}</div> : null}
          {options.showBarcode ? (
            <div className="product-label__barcode product-label__barcode--compact">
              <BarcodeGraphic value={barcodeValue} kind={options.barcodeKind} />
            </div>
          ) : null}
        </div>
        {options.showQr ? (
          <div className="product-label__qr-zone">
            <QrGraphic value={qrValue} />
          </div>
        ) : null}
      </article>
    );
  }

  return (
    <article className="product-label">
      <div className="product-label__text">
        {options.showStoreName && options.storeName ? <div className="product-label__store">{options.storeName}</div> : null}
        {options.showName ? <div className="product-label__name" title={product.name}>{product.name}</div> : null}
        {options.showSku ? <div className="product-label__sku">SKU: {product.sku}</div> : null}
        {options.showPrice ? <div className="product-label__price">{formatPrice(product.salePrice)}</div> : null}
        {options.showUnit && product.unit ? <div className="product-label__unit">ĐVT: {product.unit}</div> : null}
      </div>
      <div className="product-label__codes">
        {options.showBarcode ? (
          <div className="product-label__barcode"><BarcodeGraphic value={barcodeValue} kind={options.barcodeKind} /></div>
        ) : null}
        {options.showQr ? <QrGraphic value={qrValue} /> : null}
      </div>
    </article>
  );
}

export default function LabelPreview({ labels, config, options }: LabelPreviewProps) {
  const rowPage74x22 = is74x22RowPage(config);
  const sheetWidthMm = getSheetWidthMm(config);
  const qrSizeMm = rowPage74x22 ? clamp74x22QrSizeMm(options.qrSizeMm) : options.qrSizeMm;
  const style = {
    '--label-width': `${config.labelWidthMm}mm`,
    '--label-height': `${config.labelHeightMm}mm`,
    '--label-columns': String(config.columns),
    '--label-gap-x': `${config.gapHorizontalMm}mm`,
    '--label-gap-y': `${config.gapVerticalMm}mm`,
    '--label-margin': `${config.marginMm}mm`,
    '--sheet-width': `${sheetWidthMm}mm`,
    '--page-width': `${sheetWidthMm}mm`,
    '--page-height': `${rowPage74x22 ? LABEL_74X22_PAGE_HEIGHT_MM : config.labelHeightMm}mm`,
    '--qr-size': `${qrSizeMm}mm`,
  } as CSSProperties;

  const rowPages = rowPage74x22 ? groupLabelsIntoRowPages(labels, 2) : [];

  return (
    <div className="label-preview-shell">
      <div className={`label-preview-scale${rowPage74x22 ? ' label-preview-scale--row-pages' : ''}`}>
        {!labels.length ? (
          <div className="label-preview-empty">Chọn sản phẩm và số lượng tem để xem trước.</div>
        ) : rowPage74x22 ? (
          <div className="label-print-pages" style={style} aria-label="Xem trước tem in 74 x 22 mm">
            {rowPages.map((page, pageIndex) => (
              <section className="label-print-page" key={`page-${pageIndex}`} data-print-page={pageIndex + 1}>
                {page.map((label) => (
                  <LabelCard key={label.key} product={label.product} options={options} compact74x22 />
                ))}
                {page.length < 2 ? <div className="product-label product-label--empty" aria-hidden="true" /> : null}
              </section>
            ))}
          </div>
        ) : (
          <div className="label-print-surface" style={style} aria-label="Xem trước tem in">
            {labels.map((label) => <LabelCard key={label.key} product={label.product} options={options} />)}
          </div>
        )}
      </div>
    </div>
  );
}

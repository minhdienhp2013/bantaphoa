import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
// Node 24 strips TypeScript; resolve the extensionless imports used by Vite.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('firebase/client')) return { url: 'data:text/javascript,export const db = null;', shortCircuit: true };
  if (specifier.startsWith('.') && context.parentURL) {
    const target = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(target)) return nextResolve(target.href, context);
  }
  return nextResolve(specifier, context);
} });
const { normalizeSale } = await import('../src/modules/sales/saleNormalizer.ts');
const { normalizeBackupSales } = await import('../src/modules/backup/backupSaleValidation.ts');
const { buildSalesFinancialSummary, buildCustomerReportRows } = await import('../src/modules/reports/reportMetrics.ts');
const { buildSaleReceiptHtml } = await import('../src/modules/printing/receiptPrint.ts');
const { buildA4InvoiceHtml } = await import('../src/modules/printing/a4InvoicePrint.ts');
const { findProductByScannedCode } = await import('../src/modules/qr/productLookup.ts');
const sale = {
  id: 's1', code: 'BH-TEST', saleKind: 'product', status: 'completed', createdBy: 'owner', createdAt: 1, updatedAt: 1,
  subtotal: 20000, discount: 1000, total: 19000, costTotal: 12000, profit: 7000, paymentMethod: 'cash',
  items: [{ productId: 'p1', sku: 'COCA', name: 'Coca <lon>', quantity: 2, unitPrice: 10000, costPrice: 6000, lineTotal: 20000 }],
};
test('product sale validates snapshots, arithmetic, and fractional stock quantity', () => {
  assert.deepEqual(normalizeSale('s1', sale), sale);
  assert.equal(normalizeSale('s1', { ...sale, costTotal: 1 }), null);
  assert.equal(normalizeSale('s1', { ...sale, total: 20000 }), null);
  assert.equal(normalizeSale('s1', { ...sale, items: [{ ...sale.items[0], quantity: -1 }] }), null);
  assert.equal(normalizeSale('s1', { ...sale, saleKind: 'quick_service', serviceCategory: 'photo' }), null);
});
test('backup accepts product sales and refuses service records without silently losing them', () => {
  assert.deepEqual(normalizeBackupSales({ s1: sale }, 3), { s1: sale });
  assert.throws(() => normalizeBackupSales({ s1: { ...sale, saleKind: 'quick_service' } }, 3));
  const { saleKind, ...legacy } = sale;
  assert.deepEqual(normalizeBackupSales({ s1: legacy }, 1), { s1: sale });
  assert.throws(() => normalizeBackupSales({ s1: legacy }, 3));
});
test('reports use historical costs and exclude cancelled/refunded sales', () => {
  const sales = [sale, { ...sale, id: 's2', status: 'cancelled' }, { ...sale, id: 's3', status: 'refunded' }];
  const summary = buildSalesFinancialSummary(sales, 2000, [], 1000);
  assert.equal(summary.totalRevenue, 19000);
  assert.equal(summary.productCostOfGoods, 12000);
  assert.equal(summary.grossProfit, 7000);
  assert.equal(summary.netProfit, 4000);
  assert.equal(summary.completedSales, 1);
  assert.equal(buildCustomerReportRows(sales, {})[0].grossProfit, 7000);
});
test('barcode and QR resolve the product rather than a quick service', () => {
  const product = { id: 'p1', sku: 'COCA', barcode: '8931234567890', qrCode: 'COCA-QR', active: true };
  assert.equal(findProductByScannedCode([product], product.barcode).product.id, 'p1');
  assert.equal(findProductByScannedCode([product], product.qrCode).product.id, 'p1');
});
test('receipt and A4 invoice render product lines and escape names', () => {
  for (const html of [buildSaleReceiptHtml(sale, null), buildA4InvoiceHtml(sale, null)]) {
    assert.match(html, /Coca &lt;lon&gt;/);
    assert.match(html, /BH-TEST/);
    assert.doesNotMatch(html, /Quick Service|Dịch vụ bán nhanh|Minh Điến/);
  }
});

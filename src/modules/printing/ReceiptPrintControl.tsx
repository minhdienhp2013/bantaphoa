import { useEffect, useState } from 'react';
import type { InvoicePaperSize, Sale, StoreSettings } from '../../types/models';
import { printA4Invoice } from './a4InvoicePrint';
import {
  printSaleReceipt,
  readReceiptPaperSize,
  saveReceiptPaperSize,
} from './receiptPrint';
import { subscribeStoreSettings } from './settingsReader';
import './receiptPrintControl.css';

interface ReceiptPrintControlProps {
  sale: Sale;
  creatorName?: string;
  compact?: boolean;
  buttonOnly?: boolean;
  tone?: 'brand' | 'blue';
  preferA4?: boolean;
}

export default function ReceiptPrintControl({
  sale,
  creatorName,
  compact = false,
  buttonOnly = false,
  tone = 'brand',
  preferA4 = false,
}: ReceiptPrintControlProps) {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [paperSize, setPaperSize] = useState<InvoicePaperSize>(() => (
    preferA4 ? 'A4' : readReceiptPaperSize()
  ));
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');

  useEffect(() => subscribeStoreSettings(setSettings), []);

  useEffect(() => {
    // The Sales completion notice explicitly uses A4 as its default.
    // Do not let a previously saved receipt preference override that screen-only default.
    if (preferA4) {
      setPaperSize('A4');
      return;
    }
    if (settings?.defaultInvoicePaperSize) {
      setPaperSize(settings.defaultInvoicePaperSize);
      return;
    }
    if (settings?.receipt?.defaultPaperSize) {
      setPaperSize(settings.receipt.defaultPaperSize);
    }
  }, [
    preferA4,
    settings?.defaultInvoicePaperSize,
    settings?.receipt?.defaultPaperSize,
  ]);

  function handlePaperSizeChange(value: InvoicePaperSize) {
    setPaperSize(value);
    if (value !== 'A4') saveReceiptPaperSize(value);
  }

  async function handlePrint() {
    if (printing) return;
    setPrinting(true);
    setPrintError('');
    try {
      if (paperSize === 'A4') {
        await printA4Invoice(sale, settings, { creatorName });
      } else {
        await printSaleReceipt(sale, settings, { paperSize, creatorName });
      }
    } catch (cause) {
      setPrintError(cause instanceof Error ? cause.message : 'Không thể in hóa đơn.');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className={`receipt-print-control${compact ? ' receipt-print-control--compact' : ''}`}>
      {!buttonOnly ? (
        <label className="receipt-print-control__paper">
          <span className="receipt-print-control__paper-label">Khổ</span>
          <select
            value={paperSize}
            onChange={(event) => handlePaperSizeChange(event.target.value as InvoicePaperSize)}
            aria-label="Khổ giấy hóa đơn"
          >
            <option value="A4">A4</option>
            <option value="80mm">7,8 cm (máy 80mm)</option>
            <option value="58mm">58mm</option>
          </select>
        </label>
      ) : null}
      <button
        className={`receipt-print-control__button${tone === 'blue' ? ' receipt-print-control__button--blue' : ''}`}
        type="button"
        onClick={() => void handlePrint()}
        disabled={printing}
      >
        {printing ? 'Đang mở in…' : '🖨 In hóa đơn'}
      </button>
      {printError ? <span className="receipt-print-control__error" role="alert">{printError}</span> : null}
    </div>
  );
}

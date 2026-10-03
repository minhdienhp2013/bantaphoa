import { useState } from 'react';
import type { Product } from '../../types/models';
import { playScanSuccessFeedback } from '../../shared/audio/scanSuccessFeedback';
import BarcodeScanner from '../qr/BarcodeScanner';
import { findProductByScannedCode } from '../qr/productLookup';
import type { ScanResult } from '../qr/scannerService';
import '../qr/qrPrinting.css';

interface ProductScanDialogProps {
  products: Product[];
  onFound: (product: Product) => void;
  onClose: () => void;
}

export default function ProductScanDialog({ products, onFound, onClose }: ProductScanDialogProps) {
  const [message, setMessage] = useState('Quét để tìm hàng hóa.');

  function handleScan(result: ScanResult) {
    const match = findProductByScannedCode(products, result.value);
    if (!match) {
      setMessage(`Không tìm thấy hàng hóa có mã “${result.value}”.`);
      return;
    }
    setMessage(`Đã tìm thấy ${match.product.sku} - ${match.product.name}.`);
    playScanSuccessFeedback();
    onFound(match.product);
  }

  return (
    <div className="goods-modal-backdrop" role="presentation">
      <div className="goods-modal goods-scan-dialog" role="dialog" aria-modal="true" aria-labelledby="goods-scan-title">
        <div className="goods-modal-heading">
          <div><p className="eyebrow">Tra cứu bằng mã</p><h2 id="goods-scan-title">Quét để tìm hàng hóa</h2></div>
          <button className="goods-modal-close" type="button" onClick={onClose} aria-label="Đóng cửa sổ quét mã">×</button>
        </div>
        <p className="goods-scan-message" role="status">{message}</p>
        <BarcodeScanner onScan={handleScan} autoStart />
      </div>
    </div>
  );
}

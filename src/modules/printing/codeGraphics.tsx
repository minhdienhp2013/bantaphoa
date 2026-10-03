import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

export type BarcodeKind = 'CODE128' | 'EAN13';

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  const expected = (10 - (sum % 10)) % 10;
  return expected === digits[12];
}

export function QrGraphic({ value }: { value: string }) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSvg('');
    setError('');
    if (!value.trim()) {
      setError('Thiếu dữ liệu QR');
      return;
    }

    QRCode.toString(value, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 256,
    })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setError('Không tạo được QR');
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (error) return <span className="label-code-error">{error}</span>;
  return <span className="label-qr" aria-label={`QR ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function BarcodeGraphic({ value, kind }: { value: string; kind: BarcodeKind }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    node.replaceChildren();
    setError('');

    if (!value.trim()) {
      setError('Thiếu mã barcode');
      return;
    }
    if (kind === 'EAN13' && !isValidEan13(value)) {
      setError('EAN-13 không hợp lệ');
      return;
    }

    try {
      JsBarcode(node, value, {
        format: kind,
        displayValue: true,
        width: 1.35,
        height: 34,
        margin: 0,
        textMargin: 1,
        fontSize: 11,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      setError(`${kind} không hỗ trợ giá trị này`);
    }
  }, [kind, value]);

  return (
    <span className="label-barcode-shell">
      {error ? <span className="label-code-error">{error}</span> : null}
      <svg
        ref={svgRef}
        className={`label-barcode${error ? ' label-barcode--hidden' : ''}`}
        role="img"
        aria-label={`${kind} ${value}`}
      />
    </span>
  );
}

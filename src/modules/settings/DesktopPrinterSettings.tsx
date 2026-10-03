import { useEffect, useMemo, useState } from 'react';
import DesktopCashDrawerSettings from './DesktopCashDrawerSettings';
import type { ReceiptPaperSize } from '../../types/models';

type DesktopPrinter = Awaited<ReturnType<NonNullable<Window['banTapHoaDesktop']>['getPrinters']>>[number];

interface DesktopPrinterSettingsProps {
  paperSize?: ReceiptPaperSize;
  mode?: 'thermal' | 'a4';
}

function printerLabel(printer: DesktopPrinter): string {
  const displayName = printer.displayName?.trim();
  if (displayName && displayName !== printer.name) {
    return `${displayName} — ${printer.name}`;
  }
  return displayName || printer.name;
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message.trim()) return cause.message;
  return fallback;
}

export default function DesktopPrinterSettings({
  paperSize = '80mm',
  mode = 'thermal',
}: DesktopPrinterSettingsProps) {
  const desktop = window.banTapHoaDesktop;
  const isA4 = mode === 'a4';
  const savedDeviceName = (settings: Awaited<ReturnType<NonNullable<Window['banTapHoaDesktop']>['getPrinterSettings']>>) =>
    isA4 ? settings.a4DeviceName : settings.receiptDeviceName;
  const [printers, setPrinters] = useState<DesktopPrinter[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [loading, setLoading] = useState(Boolean(desktop));
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectedPrinter = useMemo(
    () => printers.find((printer) => printer.name === selectedName) ?? null,
    [printers, selectedName],
  );

  async function loadPrinters(preferSaved = false) {
    if (!desktop) return;
    const [nextPrinters, settings] = await Promise.all([
      desktop.getPrinters(),
      desktop.getPrinterSettings(),
    ]);
    setPrinters(nextPrinters);
    setSavedName(savedDeviceName(settings));

    setSelectedName((current) => {
      const requested = preferSaved ? savedDeviceName(settings) : current || savedDeviceName(settings);
      if (requested && nextPrinters.some((printer) => printer.name === requested)) {
        return requested;
      }
      return nextPrinters.find((printer) => printer.isDefault)?.name
        ?? nextPrinters[0]?.name
        ?? '';
    });
  }

  useEffect(() => {
    if (!desktop) return undefined;

    let active = true;
    setLoading(true);
    setError('');

    Promise.all([
      desktop.getPrinters(),
      desktop.getPrinterSettings(),
    ]).then(([nextPrinters, settings]) => {
      if (!active) return;
      setPrinters(nextPrinters);
      setSavedName(savedDeviceName(settings));
      const initialName = (
        savedDeviceName(settings)
        && nextPrinters.some((printer) => printer.name === savedDeviceName(settings))
      )
        ? savedDeviceName(settings)
        : nextPrinters.find((printer) => printer.isDefault)?.name
          ?? nextPrinters[0]?.name
          ?? '';
      setSelectedName(initialName);
    }).catch((cause) => {
      if (!active) return;
      setError(errorMessage(cause, 'Không thể đọc danh sách máy in Windows.'));
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [desktop]);

  if (!desktop) return null;

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    setMessage('');
    try {
      await loadPrinters();
      setMessage('Đã làm mới danh sách máy in Windows.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể làm mới danh sách máy in.'));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSave() {
    const api = window.banTapHoaDesktop;
    if (!api || !selectedName || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await api.savePrinterSettings({
        deviceName: selectedName,
        kind: isA4 ? 'a4' : 'receipt',
      });
      setSavedName(isA4 ? saved.a4DeviceName : saved.receiptDeviceName);
      setMessage(isA4
        ? 'Đã lưu máy in A4 mặc định cho Electron trên máy tính này.'
        : 'Đã lưu máy in hóa đơn nhiệt mặc định cho máy tính này.');
    } catch (cause) {
      setError(errorMessage(cause, isA4 ? 'Không thể lưu máy in A4.' : 'Không thể lưu máy in hóa đơn.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    const api = window.banTapHoaDesktop;
    if (!api || !selectedName || testing) return;
    setTesting(true);
    setError('');
    setMessage('');
    try {
      await api.testPrinter({
        deviceName: selectedName,
        paperSize: isA4 ? 'A4' : paperSize,
      });
      setMessage(isA4
        ? 'Đã gửi phiếu A4 in thử trực tiếp tới máy in đã chọn.'
        : 'Đã gửi phiếu in thử trực tiếp tới máy in ở Scale 100%.');
    } catch (cause) {
      setError(errorMessage(cause, 'Không thể in thử trên máy in đã chọn.'));
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
    <section className="receipt-desktop-printer" aria-labelledby="receipt-desktop-printer-heading">
      <div className="receipt-desktop-printer__heading">
        <div>
          <strong id="receipt-desktop-printer-heading">
            {isA4 ? 'Máy in A4 trên Windows' : 'Máy in hóa đơn trên Windows'}
          </strong>
          <small>
            {isA4
              ? 'Chọn máy in A4 mặc định của máy tính này. Cấu hình chỉ lưu trên Electron của máy hiện tại.'
              : 'Chọn đúng tên thiết bị Windows của PRP-085K. Cấu hình này chỉ lưu trên máy tính đang chạy app.'}
          </small>
        </div>
        <span className="receipt-desktop-printer__badge">Electron</span>
      </div>

      <div className="receipt-desktop-printer__grid">
        <label className="receipt-settings-field receipt-settings-field--wide">
          <span>{isA4 ? 'Máy in A4' : 'Máy in hóa đơn'}</span>
          <select
            value={selectedName}
            disabled={loading || refreshing || saving || testing || printers.length === 0}
            onChange={(event) => {
              const nextValue = event.currentTarget.value;
              setSelectedName(nextValue);
              setMessage('');
            }}
          >
            {printers.length === 0 ? (
              <option value="">Không tìm thấy máy in Windows</option>
            ) : (
              printers.map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {printerLabel(printer)}
                  {printer.isDefault ? ' (mặc định Windows)' : ''}
                </option>
              ))
            )}
          </select>
        </label>

        <div className="receipt-desktop-printer__status">
          <span>Đã lưu:</span>
          <strong>
            {savedName
              ? printers.find((printer) => printer.name === savedName)
                ? savedName
                : `${savedName} (không còn thấy trong Windows)`
              : 'Chưa chọn'}
          </strong>
          {selectedPrinter?.description ? <small>{selectedPrinter.description}</small> : null}
        </div>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {message ? <p className="settings-success" role="status">{message}</p> : null}

      <div className="receipt-desktop-printer__actions">
        <button
          className="button"
          type="button"
          disabled={loading || refreshing}
          onClick={() => void handleRefresh()}
        >
          {refreshing ? 'Đang làm mới…' : '↻ Làm mới máy in'}
        </button>
        <button
          className="button receipt-settings-test"
          type="button"
          disabled={!selectedName || loading || testing}
          onClick={() => void handleTest()}
        >
          {testing ? 'Đang in thử…' : isA4 ? '🖨 In thử A4' : '🖨 In thử PRP-085K'}
        </button>
        <button
          className="button button--primary"
          type="button"
          disabled={!selectedName || loading || saving || selectedName === savedName}
          onClick={() => void handleSave()}
        >
          {saving ? 'Đang lưu…' : selectedName === savedName ? 'Đã lưu máy in' : isA4 ? 'Lưu máy in A4' : 'Lưu máy in mặc định'}
        </button>
      </div>

      <p className="receipt-desktop-printer__hint">
        {isA4
          ? 'A4 được gửi trực tiếp tới máy in A4 đã chọn, không dùng máy in nhiệt.'
          : 'In thử Electron gửi trực tiếp tới máy in đã chọn với Scale 100%, không mở hộp thoại Print.'}
      </p>
    </section>
    {!isA4 ? <DesktopCashDrawerSettings /> : null}
    </>
  );
}

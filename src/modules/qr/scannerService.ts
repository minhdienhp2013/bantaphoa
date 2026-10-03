import { BrowserMultiFormatReader } from '@zxing/browser';
import { isCapacitorNativeRuntime, isTrustedMediaCaptureContext } from '../../platform/runtime';

export type ScannerEngine = 'barcode-detector' | 'zxing';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface ScanResult {
  value: string;
  format?: string;
  engine: ScannerEngine;
}

export type ScanObservation =
  | { kind: 'codes'; engine: ScannerEngine; observedAt: number; results: ScanResult[] }
  | { kind: 'empty'; engine: ScannerEngine; observedAt: number }
  | { kind: 'uncertain'; engine: ScannerEngine; observedAt: number };

export interface ScannerController {
  engine: ScannerEngine;
  stop: () => void;
}

export interface CameraScannerOptions {
  onObservation?: (observation: ScanObservation) => void;
  zxingAttemptDelayMs?: number;
}

interface DetectedBarcode {
  rawValue: string;
  format?: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
}

const PREFERRED_FORMATS = ['qr_code', 'code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e'];
const NATIVE_SCAN_INTERVAL_MS = 240;

function barcodeDetectorConstructor(): BarcodeDetectorConstructor | undefined {
  return (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

function cameraConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
  };
}

function stopVideo(video: HTMLVideoElement) {
  const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
  stream?.getTracks().forEach((track) => track.stop());
  video.pause();
  video.srcObject = null;
}

function observedAt() {
  return performance.now();
}

function zxingErrorKind(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { getKind?: () => unknown; name?: unknown };
  try {
    const kind = candidate.getKind?.();
    if (typeof kind === 'string') return kind;
  } catch {
    // Fall through to name when a third-party error does not expose getKind safely.
  }
  return typeof candidate.name === 'string' ? candidate.name : '';
}

export function describeCameraError(error: unknown): string {
  if (!(error instanceof DOMException)) {
    return error instanceof Error ? error.message : 'Không thể khởi động camera.';
  }

  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Trình duyệt đang chặn quyền camera. Hãy cho phép camera và bảo đảm trang chạy bằng HTTPS.';
    case 'NotFoundError':
      return 'Không tìm thấy camera trên thiết bị.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Camera đang bận hoặc không thể truy cập. Hãy đóng ứng dụng khác đang dùng camera rồi thử lại.';
    case 'OverconstrainedError':
      return 'Camera không đáp ứng cấu hình được yêu cầu. Hãy thử camera khác.';
    default:
      return `Không thể mở camera (${error.name}).`;
  }
}

export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'videoinput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`,
    }));
}

async function supportedNativeFormats(ctor: BarcodeDetectorConstructor): Promise<string[]> {
  if (!ctor.getSupportedFormats) return PREFERRED_FORMATS;
  try {
    const supported = await ctor.getSupportedFormats();
    return PREFERRED_FORMATS.filter((format) => supported.includes(format));
  } catch {
    return PREFERRED_FORMATS;
  }
}

async function startNativeScanner(
  video: HTMLVideoElement,
  onResult: (result: ScanResult) => void,
  deviceId?: string,
  options: CameraScannerOptions = {},
): Promise<ScannerController | null> {
  const ctor = barcodeDetectorConstructor();
  if (!ctor || !navigator.mediaDevices?.getUserMedia) return null;

  const formats = await supportedNativeFormats(ctor);
  if (formats.length === 0) return null;

  let detector: BarcodeDetectorInstance;
  try {
    detector = new ctor({ formats });
  } catch {
    return null;
  }

  const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(deviceId));
  video.srcObject = stream;
  await video.play();

  let stopped = false;
  let busy = false;
  const timer = window.setInterval(async () => {
    if (stopped || busy || document.hidden || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    busy = true;
    try {
      const codes = await detector.detect(video);
      const results = codes
        .map((code) => ({
          value: code.rawValue?.trim() ?? '',
          format: code.format,
          engine: 'barcode-detector' as const,
        }))
        .filter((result) => Boolean(result.value));

      for (const result of results) onResult(result);
      options.onObservation?.(
        results.length > 0
          ? { kind: 'codes', engine: 'barcode-detector', observedAt: observedAt(), results }
          : { kind: 'empty', engine: 'barcode-detector', observedAt: observedAt() },
      );
    } catch {
      options.onObservation?.({ kind: 'uncertain', engine: 'barcode-detector', observedAt: observedAt() });
      // Decode failures are expected while the camera is moving; keep scanning.
    } finally {
      busy = false;
    }
  }, NATIVE_SCAN_INTERVAL_MS);

  return {
    engine: 'barcode-detector',
    stop: () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(timer);
      stopVideo(video);
    },
  };
}

async function startZxingScanner(
  video: HTMLVideoElement,
  onResult: (result: ScanResult) => void,
  deviceId?: string,
  options: CameraScannerOptions = {},
): Promise<ScannerController> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      isCapacitorNativeRuntime()
        ? 'Ứng dụng iPhone chưa truy cập được Camera. Hãy kiểm tra quyền Camera của ứng dụng.'
        : 'Trình duyệt này không hỗ trợ Web Camera API.',
    );
  }

  const zxingDelay = options.zxingAttemptDelayMs;
  const reader = new BrowserMultiFormatReader(
    undefined,
    Number.isFinite(zxingDelay) && Number(zxingDelay) > 0
      ? { delayBetweenScanAttempts: Number(zxingDelay), delayBetweenScanSuccess: Number(zxingDelay) }
      : undefined,
  );
  const controls = await reader.decodeFromConstraints(cameraConstraints(deviceId), video, (result, error) => {
    const timestamp = observedAt();
    if (result) {
      const value = result.getText().trim();
      if (!value) {
        options.onObservation?.({ kind: 'uncertain', engine: 'zxing', observedAt: timestamp });
        return;
      }
      const scanResult: ScanResult = {
        value,
        format: String(result.getBarcodeFormat()),
        engine: 'zxing',
      };
      onResult(scanResult);
      options.onObservation?.({ kind: 'codes', engine: 'zxing', observedAt: timestamp, results: [scanResult] });
      return;
    }

    if (zxingErrorKind(error) === 'NotFoundException') {
      options.onObservation?.({ kind: 'empty', engine: 'zxing', observedAt: timestamp });
      return;
    }
    options.onObservation?.({ kind: 'uncertain', engine: 'zxing', observedAt: timestamp });
  });

  let stopped = false;
  return {
    engine: 'zxing',
    stop: () => {
      if (stopped) return;
      stopped = true;
      controls.stop();
      stopVideo(video);
    },
  };
}

export async function startCameraScanner(
  video: HTMLVideoElement,
  onResult: (result: ScanResult) => void,
  deviceId?: string,
  options: CameraScannerOptions = {},
): Promise<ScannerController> {
  if (!isTrustedMediaCaptureContext()) {
    throw new Error('Camera trên website công khai cần HTTPS (secure context).');
  }

  try {
    const nativeController = await startNativeScanner(video, onResult, deviceId, options);
    if (nativeController) return nativeController;
    return await startZxingScanner(video, onResult, deviceId, options);
  } catch (error) {
    stopVideo(video);
    throw new Error(describeCameraError(error));
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listCameras,
  startCameraScanner,
  type CameraDevice,
  type ScanObservation,
  type ScanResult,
  type ScannerController,
} from './scannerService';
import { useCameraPermission } from '../../shared/camera/CameraPermissionContext';
import { createDuplicateSuppressor } from './productLookup';
import { createPresenceRearmGate } from './presenceRearm';

export type ScanPolicy = 'time-window' | 'leave-to-rearm';

interface BarcodeScannerProps {
  onScan: (result: ScanResult) => void;
  duplicateWindowMs?: number;
  scanPolicy?: ScanPolicy;
  absenceThresholdMs?: number;
  autoStart?: boolean;
}

const NATIVE_ABSENCE_THRESHOLD_MS = 480;
const ZXING_ABSENCE_THRESHOLD_MS = 900;
const ZXING_PRESENCE_ATTEMPT_DELAY_MS = 240;

function thresholdFor(observation: ScanObservation, override?: number) {
  if (Number.isFinite(override) && Number(override) >= 0) return Number(override);
  return observation.engine === 'zxing' ? ZXING_ABSENCE_THRESHOLD_MS : NATIVE_ABSENCE_THRESHOLD_MS;
}

export default function BarcodeScanner({
  onScan,
  duplicateWindowMs = 1400,
  scanPolicy = 'time-window',
  absenceThresholdMs,
  autoStart = false,
}: BarcodeScannerProps) {
  const { markCameraGranted, refreshPermission, openPermissionPrompt } = useCameraPermission();
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<ScannerController | null>(null);
  const desiredActiveRef = useRef(false);
  const startTokenRef = useRef(0);
  const selectedCameraIdRef = useRef('');
  const onScanRef = useRef(onScan);
  const suppressor = useMemo(() => createDuplicateSuppressor(duplicateWindowMs), [duplicateWindowMs]);
  const presenceGate = useMemo(() => createPresenceRearmGate(), []);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Camera đang tắt.');
  const [error, setError] = useState('');
  const [engine, setEngine] = useState('');
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [salesAutoStart, setSalesAutoStart] = useState(false);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const handleObservation = useCallback((observation: ScanObservation) => {
    if (scanPolicy !== 'leave-to-rearm') return;
    const outcome = presenceGate.observe(observation, thresholdFor(observation, absenceThresholdMs));
    if (outcome.multiCode) {
      setStatus('Chỉ đưa một mã vào vùng quét.');
      return;
    }
    if (outcome.accepted) {
      onScanRef.current(outcome.accepted);
      setStatus('Đã nhận mã. Đưa mã ra khỏi khung để quét tiếp.');
      return;
    }
    if (outcome.rearmed) setStatus('Sẵn sàng quét mã tiếp theo.');
  }, [absenceThresholdMs, presenceGate, scanPolicy]);

  const stop = useCallback((keepDesiredState = false, preservePresence = false) => {
    startTokenRef.current += 1;
    controllerRef.current?.stop();
    controllerRef.current = null;
    if (!keepDesiredState) desiredActiveRef.current = false;
    if (scanPolicy === 'leave-to-rearm') {
      if (preservePresence) presenceGate.pause();
      else presenceGate.reset();
    }
    setActive(false);
    setEngine('');
    setStatus(keepDesiredState ? 'Tạm dừng camera khi tab không hoạt động.' : 'Camera đang tắt.');
  }, [presenceGate, scanPolicy]);

  const start = useCallback(
    async (deviceId?: string, preservePresence = false) => {
      const video = videoRef.current;
      const resolvedDeviceId = deviceId ?? selectedCameraIdRef.current;
      if (!video) return;

      const token = ++startTokenRef.current;
      desiredActiveRef.current = true;
      controllerRef.current?.stop();
      controllerRef.current = null;
      if (scanPolicy === 'leave-to-rearm' && !preservePresence) presenceGate.reset();
      setError('');
      setStatus('Đang mở camera…');

      try {
        const controller = await startCameraScanner(
          video,
          (result) => {
            if (scanPolicy === 'leave-to-rearm') return;
            if (!suppressor.shouldAccept(result.value)) return;
            onScanRef.current(result);
          },
          resolvedDeviceId || undefined,
          scanPolicy === 'leave-to-rearm'
            ? {
                onObservation: handleObservation,
                zxingAttemptDelayMs: ZXING_PRESENCE_ATTEMPT_DELAY_MS,
              }
            : undefined,
        );

        if (token !== startTokenRef.current || !desiredActiveRef.current) {
          controller.stop();
          return;
        }

        controllerRef.current = controller;
        markCameraGranted();
        setActive(true);
        setEngine(controller.engine === 'barcode-detector' ? 'BarcodeDetector' : 'ZXing fallback');
        setStatus(
          scanPolicy === 'leave-to-rearm'
            ? presenceGate.getState() === 'READY'
              ? 'Sẵn sàng quét mã.'
              : 'Đã nhận mã. Đưa mã ra khỏi khung để quét tiếp.'
            : 'Đang quét liên tục. Đưa QR hoặc mã vạch vào khung hình.',
        );

        const available = await listCameras();
        if (token !== startTokenRef.current) return;
        setCameras(available);
        const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
        const currentDeviceId = stream?.getVideoTracks()[0]?.getSettings().deviceId;
        if (currentDeviceId) {
          selectedCameraIdRef.current = currentDeviceId;
          setSelectedCameraId(currentDeviceId);
        }
      } catch (reason) {
        if (token !== startTokenRef.current) return;
        desiredActiveRef.current = false;
        setActive(false);
        setEngine('');
        setStatus('Không thể khởi động camera.');
        setError(reason instanceof Error ? reason.message : 'Không thể khởi động camera.');
        void refreshPermission().then((next) => {
          if (next === 'denied' || next === 'insecure' || next === 'unsupported') {
            openPermissionPrompt();
          }
        });
      }
    },
    [handleObservation, markCameraGranted, openPermissionPrompt, presenceGate, refreshPermission, scanPolicy, suppressor],
  );

  useEffect(() => {
    const shouldAutoStart = autoStart || Boolean(rootRef.current?.closest('.sales-scanner-panel'));
    if (!shouldAutoStart) return;
    setSalesAutoStart(true);
    void start();
  }, [autoStart, start]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        if (desiredActiveRef.current) stop(true, true);
      } else if (desiredActiveRef.current) {
        void start(selectedCameraIdRef.current, true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      desiredActiveRef.current = false;
      startTokenRef.current += 1;
      controllerRef.current?.stop();
      controllerRef.current = null;
      presenceGate.reset();
    };
  }, [presenceGate, start, stop]);

  const switchCamera = async () => {
    const available = cameras.length > 1 ? cameras : await listCameras();
    setCameras(available);
    if (available.length < 2) {
      setError('Thiết bị chỉ phát hiện một camera.');
      return;
    }
    const index = Math.max(0, available.findIndex((camera) => camera.deviceId === selectedCameraId));
    const next = available[(index + 1) % available.length];
    selectedCameraIdRef.current = next.deviceId;
    setSelectedCameraId(next.deviceId);
    suppressor.reset();
    presenceGate.reset();
    if (desiredActiveRef.current) await start(next.deviceId);
  };

  return (
    <section ref={rootRef} className={`qr-scanner${salesAutoStart ? ' qr-scanner--sales-auto' : ''}`} aria-labelledby="camera-scanner-heading">
      <div className="qr-section-heading">
        <div>
          <p className="eyebrow">Camera scanner</p>
          <h2 id="camera-scanner-heading">Quét QR / barcode</h2>
        </div>
        {engine ? <span className="qr-engine-badge">{engine}</span> : null}
      </div>

      <div className="qr-video-shell">
        <video ref={videoRef} className="qr-video" muted playsInline aria-label="Hình ảnh camera dùng để quét mã" />
        {!active ? <div className="qr-video-placeholder">{salesAutoStart && !error ? 'Đang mở camera…' : 'Camera chưa bật'}</div> : null}
      </div>

      <p className="qr-status" role="status">{status}</p>
      {error ? <p className="qr-error" role="alert">{error}</p> : null}

      <div className="qr-scanner-actions">
        {!salesAutoStart || error ? (
          active ? (
            <button className="button button--secondary qr-touch-button" type="button" onClick={() => stop()}>
              Tắt camera
            </button>
          ) : (
            <button className="button button--primary qr-touch-button" type="button" onClick={() => void start()}>
              {salesAutoStart ? 'Thử lại camera' : 'Bật camera'}
            </button>
          )
        ) : null}
        <button className="button button--secondary qr-touch-button" type="button" onClick={() => void switchCamera()}>
          Đổi camera trước / sau
        </button>
      </div>

      {cameras.length > 1 ? (
        <label className="qr-field">
          Camera
          <select
            value={selectedCameraId}
            onChange={(event) => {
              const nextId = event.target.value;
              selectedCameraIdRef.current = nextId;
              setSelectedCameraId(nextId);
              suppressor.reset();
              presenceGate.reset();
              if (desiredActiveRef.current) void start(nextId);
            }}
          >
            {cameras.map((camera) => (
              <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>
            ))}
          </select>
        </label>
      ) : null}
    </section>
  );
}

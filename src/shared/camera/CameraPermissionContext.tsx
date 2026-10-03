import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { isCapacitorNativeRuntime, isTrustedMediaCaptureContext } from '../../platform/runtime';
import './cameraPermission.css';

export type CameraPermissionState =
  | 'checking'
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'unsupported'
  | 'insecure';

interface CameraPermissionContextValue {
  status: CameraPermissionState;
  error: string;
  promptOpen: boolean;
  requestPermission: () => Promise<boolean>;
  refreshPermission: () => Promise<CameraPermissionState>;
  openPermissionPrompt: () => void;
  dismissPermissionPrompt: () => void;
  markCameraGranted: () => void;
}

const CameraPermissionContext = createContext<CameraPermissionContextValue | undefined>(undefined);

async function probeCameraPermission(): Promise<CameraPermissionState> {
  if (!isTrustedMediaCaptureContext()) return 'insecure';
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';

  try {
    if (navigator.permissions?.query) {
      const result = await navigator.permissions.query({ name: 'camera' } as PermissionDescriptor);
      if (result.state === 'granted') return 'granted';
      if (result.state === 'denied') return 'denied';
      if (result.state === 'prompt') return 'prompt';
    }
  } catch {
    // Safari/iOS may not support querying camera permission. Fall through.
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices?.();
    if (devices?.some((device) => device.kind === 'videoinput' && Boolean(device.label))) {
      return 'granted';
    }
  } catch {
    // Device enumeration is only a best-effort fallback.
  }

  return 'prompt';
}

function describePermissionRequestError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Camera đang bị trình duyệt chặn. Hãy mở quyền của trang web và chọn Cho phép Camera.';
    }
    if (error.name === 'NotFoundError') return 'Thiết bị không tìm thấy camera.';
    if (error.name === 'NotReadableError' || error.name === 'AbortError') {
      return 'Camera đang bận hoặc chưa thể truy cập. Hãy đóng ứng dụng khác đang dùng camera rồi thử lại.';
    }
  }
  return error instanceof Error ? error.message : 'Không thể xin quyền camera.';
}

function CameraPermissionPrompt({
  status,
  error,
  requesting,
  onRequest,
  onRefresh,
  onClose,
}: {
  status: CameraPermissionState;
  error: string;
  requesting: boolean;
  onRequest: () => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const blocked = status === 'denied';
  const unavailable = status === 'unsupported' || status === 'insecure';

  return (
    <>
      <button
        className="camera-permission-backdrop"
        type="button"
        aria-label="Đóng thông báo quyền camera"
        onClick={onClose}
      />
      <section
        className="camera-permission-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-permission-title"
      >
        <header className="camera-permission-dialog__header">
          <div>
            <span>Quyền camera khi quét</span>
            <h2 id="camera-permission-title">Camera quét QR / barcode</h2>
          </div>
          <button
            className="camera-permission-dialog__close"
            type="button"
            aria-label="Đóng cửa sổ quyền camera"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="camera-permission-dialog__body">
          {status === 'insecure' ? (
            <p>
              Camera trên điện thoại cần mở phần mềm bằng HTTPS. Hãy dùng website chính thức thay vì địa chỉ HTTP trong mạng LAN.
            </p>
          ) : status === 'unsupported' ? (
            <p>
              {isCapacitorNativeRuntime()
                ? 'Ứng dụng iPhone chưa truy cập được Camera. Hãy kiểm tra quyền Camera của ứng dụng trong Cài đặt iPhone và cài lại bản đã có cấu hình quyền native.'
                : 'Trình duyệt hoặc thiết bị hiện tại không cung cấp Web Camera API.'}
            </p>
          ) : blocked ? (
            <>
              <p><strong>Camera đang bị chặn.</strong> Trình duyệt thường không hiện lại hộp hỏi quyền sau khi bạn đã chọn chặn.</p>
              <p className="camera-permission-dialog__hint">
                Hãy mở quyền của website trong Safari/Chrome, đổi Camera thành <strong>Cho phép</strong>, rồi thử mở chức năng quét lại.
              </p>
            </>
          ) : (
            <>
              <p>Cho phép camera để sử dụng chức năng quét QR / barcode.</p>
              <p className="camera-permission-dialog__hint">
                Ứng dụng chỉ xin quyền khi bạn chủ động dùng chức năng quét.
              </p>
            </>
          )}

          {error ? <p className="camera-permission-dialog__error" role="alert">{error}</p> : null}
        </div>

        <footer className="camera-permission-dialog__actions">
          {!unavailable && !blocked ? (
            <button className="button button--primary" type="button" onClick={onRequest} disabled={requesting}>
              {requesting ? 'Đang xin quyền…' : 'Cho phép camera'}
            </button>
          ) : null}
          {blocked ? (
            <button className="button button--primary" type="button" onClick={onRefresh} disabled={requesting}>
              Kiểm tra lại quyền
            </button>
          ) : null}
          <button className="button button--secondary" type="button" onClick={onClose}>
            Để sau
          </button>
        </footer>
      </section>
    </>
  );
}

export function CameraPermissionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CameraPermissionState>('prompt');
  const [error, setError] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const applyStatus = useCallback((next: CameraPermissionState) => {
    setStatus(next);

    if (next === 'granted') {
      setError('');
      setPromptOpen(false);
    }
  }, []);

  const refreshPermission = useCallback(async () => {
    const next = await probeCameraPermission();
    applyStatus(next);
    return next;
  }, [applyStatus]);

  const requestPermission = useCallback(async () => {
    setError('');

    const initial = await probeCameraPermission();
    if (initial === 'granted') {
      applyStatus('granted');
      return true;
    }
    if (initial === 'insecure' || initial === 'unsupported') {
      applyStatus(initial);
      setPromptOpen(true);
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      applyStatus('unsupported');
      setPromptOpen(true);
      return false;
    }

    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      stream.getTracks().forEach((track) => track.stop());
      applyStatus('granted');
      return true;
    } catch (cause) {
      setError(describePermissionRequestError(cause));
      const next = await probeCameraPermission();
      applyStatus(
        cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError')
          ? 'denied'
          : next,
      );
      setPromptOpen(true);
      return false;
    } finally {
      setRequesting(false);
    }
  }, [applyStatus]);

  const openPermissionPrompt = useCallback(() => setPromptOpen(true), []);
  const dismissPermissionPrompt = useCallback(() => setPromptOpen(false), []);
  const markCameraGranted = useCallback(() => applyStatus('granted'), [applyStatus]);

  const value = useMemo<CameraPermissionContextValue>(() => ({
    status,
    error,
    promptOpen,
    requestPermission,
    refreshPermission,
    openPermissionPrompt,
    dismissPermissionPrompt,
    markCameraGranted,
  }), [
    status,
    error,
    promptOpen,
    requestPermission,
    refreshPermission,
    openPermissionPrompt,
    dismissPermissionPrompt,
    markCameraGranted,
  ]);

  return (
    <CameraPermissionContext.Provider value={value}>
      {children}
      {promptOpen && status !== 'granted' ? (
        <CameraPermissionPrompt
          status={status}
          error={error}
          requesting={requesting}
          onRequest={() => void requestPermission()}
          onRefresh={() => void refreshPermission()}
          onClose={() => setPromptOpen(false)}
        />
      ) : null}
    </CameraPermissionContext.Provider>
  );
}

export function useCameraPermission() {
  const context = useContext(CameraPermissionContext);
  if (!context) {
    throw new Error('useCameraPermission phải được dùng bên trong CameraPermissionProvider.');
  }
  return context;
}

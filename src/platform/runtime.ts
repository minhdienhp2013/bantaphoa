type CapacitorBridge = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

type CapacitorWindow = Window & {
  Capacitor?: CapacitorBridge;
};

function capacitorBridge(): CapacitorBridge | undefined {
  return (window as CapacitorWindow).Capacitor;
}

export function isCapacitorNativeRuntime() {
  if (window.location.protocol === 'capacitor:') return true;
  try {
    return capacitorBridge()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function isCapacitorIosRuntime() {
  if (!isCapacitorNativeRuntime()) return false;
  try {
    const platform = capacitorBridge()?.getPlatform?.();
    if (platform) return platform === 'ios';
  } catch {
    // Fall back to the default Capacitor iOS scheme below.
  }
  return window.location.protocol === 'capacitor:';
}

export function isTrustedMediaCaptureContext() {
  const hostname = window.location.hostname;
  return (
    window.isSecureContext ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    isCapacitorNativeRuntime()
  );
}

export function installCapacitorRuntimeShell() {
  if (!isCapacitorNativeRuntime()) return;

  document.documentElement.classList.add('capacitor-native');

  if (!isCapacitorIosRuntime()) return;
  document.documentElement.classList.add('capacitor-ios');

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport && !viewport.content.includes('viewport-fit=')) {
    viewport.content = `${viewport.content}, viewport-fit=cover`;
  }
}

type SafariAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let sharedContext: AudioContext | null = null;

function getAudioContext() {
  if (sharedContext && sharedContext.state !== 'closed') return sharedContext;

  const AudioContextCtor = typeof AudioContext !== 'undefined'
    ? AudioContext
    : (window as SafariAudioWindow).webkitAudioContext;

  if (!AudioContextCtor) return null;
  sharedContext = new AudioContextCtor();
  return sharedContext;
}

/**
 * Mẫu 1 — tít cao, rõ:
 * sine 1200 Hz, khoảng 120 ms, attack/release rất ngắn.
 * Gọi hàm này từ thao tác người dùng mở scanner để iOS/Safari cho phép phát âm.
 */
export async function primeScanSuccessFeedback() {
  try {
    const context = getAudioContext();
    if (context?.state === 'suspended') await context.resume();
  } catch {
    // Âm thanh là phản hồi phụ, không được chặn luồng quét.
  }
}

export function playScanSuccessFeedback() {
  void (async () => {
    try {
      const context = getAudioContext();
      if (!context || context.state === 'closed') return;
      if (context.state === 'suspended') await context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1200, now);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.42, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.125);
    } catch {
      // Không để lỗi âm thanh ảnh hưởng kết quả quét.
    }
  })();

  try {
    navigator.vibrate?.(40);
  } catch {
    // Rung không được hỗ trợ trên mọi thiết bị.
  }
}

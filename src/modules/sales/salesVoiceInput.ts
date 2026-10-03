export type SalesVoiceError = 'permission-denied' | 'no-speech' | 'unsupported';

type SpeechRecognitionResultEvent = {
  results?: ArrayLike<{ 0?: { transcript?: string } }>;
};

type SpeechRecognitionErrorEvent = {
  error?: string;
};

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onspeechend: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionScope = {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export interface SalesVoiceSession {
  cancel(): void;
}

interface StartSalesVoiceInputOptions {
  onTranscript: (transcript: string) => void;
  onListeningChange: (listening: boolean) => void;
  onError: (error: SalesVoiceError) => void;
  recognitionConstructor?: SpeechRecognitionConstructor;
  timeoutMs?: number;
}

export function getSalesVoiceErrorMessage(error: SalesVoiceError) {
  if (error === 'permission-denied') return 'Không có quyền dùng micro.';
  if (error === 'unsupported') return 'Trình duyệt này không hỗ trợ nhập bằng giọng nói.';
  return 'Không nghe rõ. Hãy thử lại.';
}

export function resolveSpeechRecognitionConstructor(
  scope: SpeechRecognitionScope = globalThis as SpeechRecognitionScope,
) {
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

function mapRecognitionError(error?: string): SalesVoiceError {
  return error === 'not-allowed' || error === 'service-not-allowed'
    ? 'permission-denied'
    : 'no-speech';
}

export function startSalesVoiceInput(options: StartSalesVoiceInputOptions): SalesVoiceSession | null {
  const Recognition = options.recognitionConstructor ?? resolveSpeechRecognitionConstructor();
  if (!Recognition) {
    options.onError('unsupported');
    return null;
  }

  const recognition = new Recognition();
  const timeoutMs = options.timeoutMs ?? 10_000;
  let active = true;
  let transcriptDelivered = false;
  let errorReported = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = null;
  };

  const detach = () => {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onspeechend = null;
    recognition.onend = null;
  };

  const finish = () => {
    if (!active) return;
    active = false;
    clearTimer();
    detach();
    options.onListeningChange(false);
  };

  const reportError = (error: SalesVoiceError) => {
    if (errorReported || transcriptDelivered) return;
    errorReported = true;
    options.onError(error);
  };

  const stopSafely = () => {
    try {
      recognition.stop();
    } catch {
      // Some WebKit implementations throw after they have already stopped.
    }
  };

  recognition.lang = 'vi-VN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    if (!active || transcriptDelivered) return;
    const transcript = event.results?.[0]?.[0]?.transcript?.trim() ?? '';
    if (!transcript) {
      reportError('no-speech');
      finish();
      stopSafely();
      return;
    }

    transcriptDelivered = true;
    options.onTranscript(transcript);
    finish();
    stopSafely();
  };

  recognition.onerror = (event) => {
    if (!active) return;
    reportError(mapRecognitionError(event.error));
    finish();
  };

  recognition.onspeechend = () => {
    if (active) stopSafely();
  };

  recognition.onend = () => {
    if (!active) return;
    if (!transcriptDelivered && !errorReported) reportError('no-speech');
    finish();
  };

  timeoutId = setTimeout(() => {
    if (!active) return;
    reportError('no-speech');
    finish();
    stopSafely();
  }, timeoutMs);

  try {
    options.onListeningChange(true);
    recognition.start();
  } catch (cause) {
    const errorName = cause instanceof Error ? cause.name : '';
    reportError(errorName === 'NotAllowedError' ? 'permission-denied' : 'no-speech');
    finish();
    return null;
  }

  return {
    cancel() {
      if (!active) return;
      active = false;
      clearTimer();
      detach();
      try {
        recognition.abort();
      } catch {
        // Cleanup remains complete even when an old WebKit instance throws.
      }
      options.onListeningChange(false);
    },
  };
}

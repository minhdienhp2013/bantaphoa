import type { ScanObservation, ScanResult } from './scannerService';

export type PresenceState = 'READY' | 'LOCKED' | 'ABSENT_PENDING';

export interface PresenceDecision {
  state: PresenceState;
  accepted?: ScanResult;
  rearmed: boolean;
  multiCode: boolean;
}

export interface PresenceRearmGate {
  observe: (observation: ScanObservation, absenceThresholdMs: number) => PresenceDecision;
  reset: () => void;
  pause: () => void;
  getState: () => PresenceState;
}

function safeThreshold(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function distinctResults(results: readonly ScanResult[]): ScanResult[] {
  const distinct = new Map<string, ScanResult>();
  for (const result of results) {
    const value = result.value.trim();
    if (!value || distinct.has(value)) continue;
    distinct.set(value, value === result.value ? result : { ...result, value });
  }
  return [...distinct.values()];
}

export function createPresenceRearmGate(): PresenceRearmGate {
  let state: PresenceState = 'READY';
  let absentSince: number | null = null;

  const decision = (accepted?: ScanResult, rearmed = false, multiCode = false): PresenceDecision => ({
    state,
    accepted,
    rearmed,
    multiCode,
  });

  return {
    observe(observation, absenceThresholdMs) {
      if (observation.kind === 'uncertain') {
        if (state !== 'READY') {
          state = 'LOCKED';
          absentSince = null;
        }
        return decision();
      }

      if (observation.kind === 'codes') {
        const results = distinctResults(observation.results);
        if (state === 'READY') {
          if (results.length > 1) return decision(undefined, false, true);
          if (results.length === 1) {
            state = 'LOCKED';
            absentSince = null;
            return decision(results[0]);
          }
          return decision();
        }

        state = 'LOCKED';
        absentSince = null;
        return decision();
      }

      if (state === 'READY') return decision();

      if (state === 'LOCKED') {
        state = 'ABSENT_PENDING';
        absentSince = observation.observedAt;
        return decision();
      }

      const threshold = safeThreshold(absenceThresholdMs);
      const startedAt = absentSince ?? observation.observedAt;
      absentSince = startedAt;
      if (observation.observedAt - startedAt >= threshold) {
        state = 'READY';
        absentSince = null;
        return decision(undefined, true);
      }
      return decision();
    },

    reset() {
      state = 'READY';
      absentSince = null;
    },

    pause() {
      if (state === 'ABSENT_PENDING') state = 'LOCKED';
      absentSince = null;
    },

    getState() {
      return state;
    },
  };
}

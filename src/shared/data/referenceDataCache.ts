export const REFERENCE_CACHE_TTL_MS = {
  products: 15_000,
  customers: 120_000,
  suppliers: 120_000,
  users: 120_000,
} as const;

interface CachedValue {
  value: unknown;
  expiresAt: number;
  generation: number;
}

interface InflightValue {
  promise: Promise<unknown>;
  generation: number;
}

const values = new Map<string, CachedValue>();
const inflight = new Map<string, InflightValue>();
const generations = new Map<string, number>();

function getGeneration(key: string) {
  return generations.get(key) ?? 0;
}

export async function readThroughReferenceCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const generation = getGeneration(key);
  const cached = values.get(key);
  if (cached && cached.generation === generation && cached.expiresAt > now) {
    return cached.value as T;
  }

  const pending = inflight.get(key);
  if (pending && pending.generation === generation) {
    return pending.promise as Promise<T>;
  }

  let promise: Promise<T>;
  promise = loader()
    .then((value) => {
      if (getGeneration(key) === generation) {
        values.set(key, {
          value,
          expiresAt: Date.now() + Math.max(0, ttlMs),
          generation,
        });
      }
      return value;
    })
    .finally(() => {
      const current = inflight.get(key);
      if (current?.promise === promise) inflight.delete(key);
    });

  inflight.set(key, { promise, generation });
  return promise;
}

export function invalidateReferenceCache(...keysOrPrefixes: string[]) {
  for (const target of keysOrPrefixes) {
    const matching = new Set<string>();

    for (const key of values.keys()) {
      if (key === target || key.startsWith(`${target}:`)) matching.add(key);
    }
    for (const key of inflight.keys()) {
      if (key === target || key.startsWith(`${target}:`)) matching.add(key);
    }

    // Also advance the direct key generation so a stale in-flight loader that
    // has already been detached cannot repopulate the cache after a write.
    matching.add(target);

    for (const key of matching) {
      generations.set(key, getGeneration(key) + 1);
      values.delete(key);
      inflight.delete(key);
    }
  }
}

export function clearReferenceCache() {
  const keys = new Set([...values.keys(), ...inflight.keys(), ...generations.keys()]);
  for (const key of keys) generations.set(key, getGeneration(key) + 1);
  values.clear();
  inflight.clear();
}

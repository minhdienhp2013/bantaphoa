import {
  get,
  increment,
  onValue,
  push,
  ref,
  set,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { db } from '../../firebase/client';
import type { Category, Product } from '../../types/models';
import { prepareSearchQuery } from '../../shared/search/searchNormalization';
import {
  hashSalesLearningSignature,
} from './salesLearningSignature';
import type {
  SalesAiLearningEvidence,
  SalesAiLearningEvidenceEntry,
} from './salesAiLearningSearch';
import { buildSalesCatalogVocabulary, type SalesLocalTransformation } from './salesLocalPhoneticResolver';

export type SalesAiLearningEventType =
  | 'QUERY_RESULT'
  | 'PRODUCT_SELECTED'
  | 'ADD_TO_CART'
  | 'REMOVE_FROM_CART_SHORTLY_AFTER_ADD'
  | 'CORRECTION_WIN'
  | 'CORRECTION_LOSS';

export type SalesAiInputSource = 'keyboard' | 'voice' | 'barcode' | 'qr' | 'manual';
export type SalesAiLearningEnvironment = 'production' | 'debug' | 'test';

export interface SalesAiCandidateSnapshot {
  productId: string;
  rank: number;
  score?: number;
  evidenceTier?: string;
}

export interface SalesAiLearningComponentMapping {
  id: string;
  source: string;
  target: string;
  targetType: 'catalog-token';
  status: 'observing' | 'conflict' | 'suggested' | 'approved' | 'disabled';
  positiveCount: number;
  strongPositiveCount: number;
  negativeCount: number;
  correctionCount: number;
  lastSeenAt: number;
  approvedBy?: string;
  approvedAt?: number;
}

export interface RecordSalesAiQueryObservationInput {
  originalQuery: string;
  normalizedSignature: string;
  normalizedQuery: string;
  phoneticVariants?: string[];
  normalizedCandidates?: string[];
  candidates?: SalesAiCandidateSnapshot[];
  inputSource: SalesAiInputSource;
  actorUid: string;
  sessionId: string;
  environment?: SalesAiLearningEnvironment;
  localPhoneticResolved: boolean;
  learnedMappingHit?: boolean;
  deepSeekCalled: boolean;
  ambiguous: boolean;
  manualCorrection?: boolean;
  timeToSelectionMs?: number;
}

export interface RecordSalesAiLearningSignalInput {
  query: string;
  normalizedSignature?: string;
  product: Pick<Product, 'id' | 'name'>;
  event: Exclude<SalesAiLearningEventType, 'QUERY_RESULT'>;
  actorUid: string;
  sessionId?: string;
  inputSource?: SalesAiInputSource;
  environment?: SalesAiLearningEnvironment;
  candidateRank?: number;
  components?: readonly SalesLocalTransformation[];
  candidates?: readonly SalesAiCandidateSnapshot[];
  timeToSelectionMs?: number;
}

interface LegacyLearningProductStats {
  productId: string;
  productName: string;
  addToCartCount: number;
  removeSoonCount: number;
  score: number;
  lastEventAt: number;
}

interface LearningV2ProductStats {
  productId: string;
  productName: string;
  selectionCount?: number;
  addToCartCount?: number;
  removeSoonCount?: number;
  correctionWinCount?: number;
  correctionLossCount?: number;
  sessionCount?: number;
  sessions?: Record<string, boolean>;
  lastEventAt?: number;
}

const MAX_QUERY_SNAPSHOT_LENGTH = 240;
const MAX_EVENT_CANDIDATES = 5;
const MAX_EVENT_VARIANTS = 5;
const RAW_EVENT_RETENTION_DAYS = 180;
const HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function cleanQuerySnapshot(value: string) {
  return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_QUERY_SNAPSHOT_LENGTH);
}

function safeFirebaseKey(value: string) {
  return value.replace(/[.#$\[\]\/]/gu, '_').slice(0, 80);
}

function safeStringArray(values: readonly string[] | undefined) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values ?? []) {
    const cleaned = cleanQuerySnapshot(raw);
    const key = cleaned.toLocaleLowerCase('vi');
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= MAX_EVENT_VARIANTS) break;
  }
  return result;
}

function safeCandidateSnapshots(values: readonly SalesAiCandidateSnapshot[] | undefined) {
  return (values ?? []).slice(0, MAX_EVENT_CANDIDATES).map((candidate, index) => ({
    productId: candidate.productId,
    rank: Number.isInteger(candidate.rank) && candidate.rank >= 0 ? candidate.rank : index,
    ...(typeof candidate.score === 'number' && Number.isFinite(candidate.score)
      ? { score: Math.round(candidate.score) }
      : {}),
    ...(candidate.evidenceTier ? { evidenceTier: candidate.evidenceTier.slice(0, 40) } : {}),
  }));
}

function eventContribution(event: Exclude<SalesAiLearningEventType, 'QUERY_RESULT'>) {
  if (event === 'PRODUCT_SELECTED') return 1;
  if (event === 'ADD_TO_CART') return 3;
  if (event === 'REMOVE_FROM_CART_SHORTLY_AFTER_ADD') return -1;
  if (event === 'CORRECTION_WIN') return 5;
  return -4;
}

function legacyContribution(event: Exclude<SalesAiLearningEventType, 'QUERY_RESULT'>) {
  if (event === 'ADD_TO_CART') return 4;
  if (event === 'REMOVE_FROM_CART_SHORTLY_AFTER_ADD') return -3;
  return 0;
}

function componentKey(source: string, target: string) {
  return hashSalesLearningSignature(`${source}=>${target}`).replace(/^q_/u, 'c_');
}

function confidenceFor(
  current: Partial<LearningV2ProductStats>,
  totalPositive: number,
  now: number,
) {
  const selection = Math.max(0, Number(current.selectionCount) || 0);
  const add = Math.max(0, Number(current.addToCartCount) || 0);
  const remove = Math.max(0, Number(current.removeSoonCount) || 0);
  const correctionWin = Math.max(0, Number(current.correctionWinCount) || 0);
  const correctionLoss = Math.max(0, Number(current.correctionLossCount) || 0);
  const sessions = current.sessions && typeof current.sessions === 'object'
    ? Object.keys(current.sessions).length
    : Math.max(0, Number(current.sessionCount) || 0);

  const positive = selection + (3 * add) + (5 * correctionWin);
  const negative = remove + (4 * correctionLoss);
  const behaviorConfidence = positive / (positive + negative + 4);
  const consistency = totalPositive > 0 ? positive / totalPositive : 0;
  const sessionSupport = Math.min(1, sessions / 4);
  const ageMs = Math.max(0, now - Number(current.lastEventAt || 0));
  const decay = Math.pow(0.5, ageMs / HALF_LIFE_MS);

  return Math.max(0, Math.min(
    1,
    behaviorConfidence * consistency * (0.5 + (0.5 * sessionSupport)) * decay,
  ));
}

function weightedPositive(current: Partial<LearningV2ProductStats>) {
  return Math.max(0, Number(current.selectionCount) || 0)
    + (3 * Math.max(0, Number(current.addToCartCount) || 0))
    + (5 * Math.max(0, Number(current.correctionWinCount) || 0));
}

export async function loadSalesAiLearningEvidence(signatureText: string): Promise<SalesAiLearningEvidence> {
  const normalizedSignature = cleanQuerySnapshot(signatureText);
  if (!normalizedSignature) return {};

  const key = hashSalesLearningSignature(normalizedSignature);
  const snapshot = await get(ref(requireDatabase(), `salesAiLearning/${key}`));
  if (!snapshot.exists()) return {};

  const storedSignature = snapshot.child('normalizedSignature').val()
    ?? snapshot.child('normalizedQuery').val();
  if (storedSignature !== normalizedSignature) return {};
  if (snapshot.child('status').val() === 'disabled') return {};

  const legacy = (snapshot.child('products').val() ?? {}) as Record<string, Partial<LegacyLearningProductStats>>;
  const v2 = (snapshot.child('v2Products').val() ?? {}) as Record<string, Partial<LearningV2ProductStats>>;
  const productIds = [...new Set([...Object.keys(legacy), ...Object.keys(v2)])];
  const now = Date.now();
  const totalPositive = Object.values(v2).reduce((sum, value) => sum + weightedPositive(value), 0);
  const sortedPositive = Object.values(v2)
    .map(weightedPositive)
    .sort((left, right) => right - left);
  const topShare = totalPositive > 0 ? (sortedPositive[0] ?? 0) / totalPositive : 1;
  const conflict = totalPositive >= 4 && topShare < 0.7;

  return Object.fromEntries(
    productIds.flatMap((productId) => {
      const oldValue = legacy[productId] ?? {};
      const nextValue = v2[productId] ?? {};
      const legacyScore = Number(oldValue.score);
      const lastEventAt = Math.max(
        Number(oldValue.lastEventAt) || 0,
        Number(nextValue.lastEventAt) || 0,
      );
      if (!productId || !Number.isFinite(lastEventAt)) return [];

      const selectionCount = Math.max(0, Number(nextValue.selectionCount) || 0);
      const addToCartCount = Math.max(
        Math.max(0, Number(oldValue.addToCartCount) || 0),
        Math.max(0, Number(nextValue.addToCartCount) || 0),
      );
      const removeSoonCount = Math.max(
        Math.max(0, Number(oldValue.removeSoonCount) || 0),
        Math.max(0, Number(nextValue.removeSoonCount) || 0),
      );
      const correctionWinCount = Math.max(0, Number(nextValue.correctionWinCount) || 0);
      const correctionLossCount = Math.max(0, Number(nextValue.correctionLossCount) || 0);
      const sessionCount = nextValue.sessions && typeof nextValue.sessions === 'object'
        ? Object.keys(nextValue.sessions).length
        : Math.max(0, Number(nextValue.sessionCount) || 0);
      const confidence = confidenceFor(nextValue, totalPositive, now);
      const rawScore = Number.isFinite(legacyScore) ? legacyScore : 0;
      const v2Score = selectionCount
        + (3 * addToCartCount)
        - removeSoonCount
        + (5 * correctionWinCount)
        - (4 * correctionLossCount);

      const entry: SalesAiLearningEvidenceEntry = {
        productId,
        score: rawScore + v2Score,
        addToCartCount,
        removeSoonCount,
        lastEventAt,
        selectionCount,
        correctionWinCount,
        correctionLossCount,
        sessionCount,
        confidence,
        conflict,
      };
      return [[productId, entry] as const];
    }),
  );
}

export function subscribeApprovedSalesAiComponents(
  onMappings: (mappings: SalesAiLearningComponentMapping[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'salesAiLearningComponents'),
    (snapshot) => {
      if (!snapshot.exists()) {
        onMappings([]);
        return;
      }
      const raw = snapshot.val() as Record<string, Partial<SalesAiLearningComponentMapping>>;
      const mappings = Object.entries(raw)
        .flatMap(([id, value]) => {
          if (
            value.status !== 'approved'
            || typeof value.source !== 'string'
            || typeof value.target !== 'string'
          ) {
            return [];
          }
          return [{
            id,
            source: cleanQuerySnapshot(value.source),
            target: cleanQuerySnapshot(value.target),
            targetType: 'catalog-token' as const,
            status: 'approved' as const,
            positiveCount: Math.max(0, Number(value.positiveCount) || 0),
            strongPositiveCount: Math.max(0, Number(value.strongPositiveCount) || 0),
            negativeCount: Math.max(0, Number(value.negativeCount) || 0),
            correctionCount: Math.max(0, Number(value.correctionCount) || 0),
            lastSeenAt: Number(value.lastSeenAt) || 0,
            ...(typeof value.approvedBy === 'string' ? { approvedBy: value.approvedBy } : {}),
            ...(typeof value.approvedAt === 'number' ? { approvedAt: value.approvedAt } : {}),
          }];
        });
      onMappings(mappings);
    },
    (cause) => onError(cause instanceof Error ? cause : new Error('Không thể tải cách gọi AI đã duyệt.')),
  );
}

export async function recordSalesAiQueryObservation(input: RecordSalesAiQueryObservationInput) {
  const originalQuery = cleanQuerySnapshot(input.originalQuery);
  const normalizedQuery = cleanQuerySnapshot(input.normalizedQuery);
  const normalizedSignature = cleanQuerySnapshot(input.normalizedSignature);
  if (!originalQuery || !normalizedQuery || !normalizedSignature || !input.actorUid || !input.sessionId) return;

  const database = requireDatabase();
  const eventId = push(ref(database, 'salesAiLearningEvents')).key;
  if (!eventId) return;

  const now = Date.now();
  const event = {
    schemaVersion: 2,
    id: eventId,
    event: 'QUERY_RESULT',
    environment: input.environment ?? 'production',
    queryKey: hashSalesLearningSignature(normalizedSignature),
    originalQuery,
    normalizedQuery,
    normalizedSignature,
    phoneticVariants: safeStringArray(input.phoneticVariants),
    normalizedCandidates: safeStringArray(input.normalizedCandidates),
    candidates: safeCandidateSnapshots(input.candidates),
    inputSource: input.inputSource,
    actorUid: input.actorUid,
    sessionId: input.sessionId.slice(0, 80),
    localPhoneticResolved: Boolean(input.localPhoneticResolved),
    learnedMappingHit: Boolean(input.learnedMappingHit),
    deepSeekCalled: Boolean(input.deepSeekCalled),
    ambiguous: Boolean(input.ambiguous),
    manualCorrection: Boolean(input.manualCorrection),
    ...(typeof input.timeToSelectionMs === 'number' && Number.isFinite(input.timeToSelectionMs)
      ? { timeToSelectionMs: Math.max(0, Math.round(input.timeToSelectionMs)) }
      : {}),
    createdAt: now,
    expiresAt: now + (RAW_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    source: 'sales-ai-quick-ask',
  };

  await set(ref(database, `salesAiLearningEvents/${eventId}`), event);
}

export async function recordSalesAiLearningSignal(input: RecordSalesAiLearningSignalInput) {
  const originalQuery = cleanQuerySnapshot(input.query);
  const normalizedSignature = cleanQuerySnapshot(input.normalizedSignature ?? originalQuery);
  if (!originalQuery || !normalizedSignature || !input.product.id || !input.product.name.trim() || !input.actorUid) return;

  const environment = input.environment ?? 'production';
  const queryKey = hashSalesLearningSignature(normalizedSignature);
  const database = requireDatabase();
  const now = Date.now();
  const eventId = push(ref(database, 'salesAiLearningEvents')).key;
  if (!eventId) return;

  const candidates = safeCandidateSnapshots(input.candidates);
  const contribution = eventContribution(input.event);
  const event = {
    schemaVersion: 2,
    id: eventId,
    event: input.event,
    contribution,
    environment,
    queryKey,
    originalQuery,
    normalizedQuery: normalizedSignature,
    normalizedSignature,
    productId: input.product.id,
    productName: input.product.name.slice(0, 200),
    actorUid: input.actorUid,
    sessionId: (input.sessionId ?? 'legacy').slice(0, 80),
    inputSource: input.inputSource ?? 'keyboard',
    candidates,
    source: 'sales-ai-quick-ask',
    createdAt: now,
    expiresAt: now + (RAW_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    ...(Number.isInteger(input.candidateRank) && Number(input.candidateRank) >= 0
      ? { candidateRank: Number(input.candidateRank) }
      : {}),
    ...(typeof input.timeToSelectionMs === 'number' && Number.isFinite(input.timeToSelectionMs)
      ? { timeToSelectionMs: Math.max(0, Math.round(input.timeToSelectionMs)) }
      : {}),
  };

  if (environment !== 'production') {
    await set(ref(database, `salesAiLearningEvents/${eventId}`), event);
    return;
  }

  const productPath = `salesAiLearning/${queryKey}/v2Products/${input.product.id}`;
  const updates: Record<string, unknown> = {
    [`salesAiLearning/${queryKey}/schemaVersion`]: 2,
    [`salesAiLearning/${queryKey}/normalizedQuery`]: normalizedSignature,
    [`salesAiLearning/${queryKey}/normalizedSignature`]: normalizedSignature,
    [`salesAiLearning/${queryKey}/exampleQuery`]: originalQuery,
    [`salesAiLearning/${queryKey}/updatedAt`]: now,
    [`${productPath}/productId`]: input.product.id,
    [`${productPath}/productName`]: input.product.name.slice(0, 200),
    [`${productPath}/selectionCount`]: increment(input.event === 'PRODUCT_SELECTED' ? 1 : 0),
    [`${productPath}/addToCartCount`]: increment(input.event === 'ADD_TO_CART' ? 1 : 0),
    [`${productPath}/removeSoonCount`]: increment(input.event === 'REMOVE_FROM_CART_SHORTLY_AFTER_ADD' ? 1 : 0),
    [`${productPath}/correctionWinCount`]: increment(input.event === 'CORRECTION_WIN' ? 1 : 0),
    [`${productPath}/correctionLossCount`]: increment(input.event === 'CORRECTION_LOSS' ? 1 : 0),
    [`${productPath}/lastEventAt`]: now,
    [`${productPath}/lastEventType`]: input.event,
    [`${productPath}/lastEventId`]: eventId,
    [`salesAiLearningEvents/${eventId}`]: event,
  };

  if (input.sessionId) {
    const sessionKey = safeFirebaseKey(input.sessionId);
    if (sessionKey) updates[`${productPath}/sessions/${sessionKey}`] = true;
  }

  const legacy = legacyContribution(input.event);
  if (legacy !== 0) {
    const legacyPath = `salesAiLearning/${queryKey}/products/${input.product.id}`;
    updates[`${legacyPath}/productId`] = input.product.id;
    updates[`${legacyPath}/productName`] = input.product.name.slice(0, 200);
    updates[`${legacyPath}/addToCartCount`] = increment(input.event === 'ADD_TO_CART' ? 1 : 0);
    updates[`${legacyPath}/removeSoonCount`] = increment(input.event === 'REMOVE_FROM_CART_SHORTLY_AFTER_ADD' ? 1 : 0);
    updates[`${legacyPath}/score`] = increment(legacy);
    updates[`${legacyPath}/lastEventAt`] = now;
    updates[`${legacyPath}/lastEventType`] = input.event;
    updates[`${legacyPath}/lastEventId`] = eventId;
  }

  for (const mapping of input.components ?? []) {
    const source = cleanQuerySnapshot(mapping.source);
    const target = cleanQuerySnapshot(mapping.target);
    if (!source || !target || source === target) continue;
    const key = componentKey(source, target);
    const path = `salesAiLearningComponents/${key}`;
    updates[`${path}/id`] = key;
    updates[`${path}/source`] = source;
    updates[`${path}/target`] = target;
    updates[`${path}/targetType`] = 'catalog-token';
    updates[`${path}/positiveCount`] = increment(
      input.event === 'PRODUCT_SELECTED' || input.event === 'ADD_TO_CART' || input.event === 'CORRECTION_WIN' ? 1 : 0,
    );
    updates[`${path}/strongPositiveCount`] = increment(
      input.event === 'ADD_TO_CART' || input.event === 'CORRECTION_WIN' ? 1 : 0,
    );
    updates[`${path}/negativeCount`] = increment(
      input.event === 'REMOVE_FROM_CART_SHORTLY_AFTER_ADD' || input.event === 'CORRECTION_LOSS' ? 1 : 0,
    );
    updates[`${path}/correctionCount`] = increment(
      input.event === 'CORRECTION_WIN' || input.event === 'CORRECTION_LOSS' ? 1 : 0,
    );
    updates[`${path}/lastSeenAt`] = now;
    updates[`${path}/lastEventId`] = eventId;
  }

  await update(ref(database), updates);
}

export async function createApprovedSalesAiLearningComponentManual(
  sourceRaw: string,
  targetRaw: string,
  actorUid: string,
) {
  const sourcePrepared = prepareSearchQuery(cleanQuerySnapshot(sourceRaw));
  const targetPrepared = prepareSearchQuery(cleanQuerySnapshot(targetRaw));
  const source = sourcePrepared.normalized;
  const targetTokens = targetPrepared.tokens;

  if (!source || sourcePrepared.tokens.length === 0) {
    throw new Error('Hãy nhập từ hoặc cụm từ máy thường nghe sai.');
  }
  if (targetTokens.length !== 1) {
    throw new Error('Từ đúng phải là một từ hoặc mã hàng đơn lẻ có trong catalog.');
  }

  const target = targetTokens[0];
  if (!target || sourcePrepared.compact === targetPrepared.compact) {
    throw new Error('Từ nghe sai và từ đúng phải khác nhau.');
  }
  if (!actorUid) throw new Error('Không xác định được tài khoản duyệt mapping.');

  const database = requireDatabase();
  const mappingId = componentKey(source, target);
  const mappingPath = `salesAiLearningComponents/${mappingId}`;

  const [productsSnapshot, categoriesSnapshot, existingSnapshot] = await Promise.all([
    get(ref(database, 'products')),
    get(ref(database, 'categories')),
    get(ref(database, mappingPath)),
  ]);

  const products = productsSnapshot.exists()
    ? Object.values(productsSnapshot.val() as Record<string, Product>)
    : [];
  const categories = categoriesSnapshot.exists()
    ? Object.values(categoriesSnapshot.val() as Record<string, Category>)
    : [];
  const vocabulary = buildSalesCatalogVocabulary(products, categories);
  const allowedTargets = new Set(vocabulary.catalogTokens);

  if (!allowedTargets.has(target)) {
    throw new Error('Từ/mã đúng chưa có trong tên hàng, alias, SKU hoặc danh mục đang hoạt động.');
  }

  const existing = existingSnapshot.exists()
    ? existingSnapshot.val() as Partial<SalesAiLearningComponentMapping> & { lastEventId?: unknown }
    : {};
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo audit log cho mapping thủ công.');

  const now = Date.now();
  const nextMapping: SalesAiLearningComponentMapping & {
    lastEventId: string;
    updatedAt: number;
  } = {
    id: mappingId,
    source,
    target,
    targetType: 'catalog-token',
    status: 'approved',
    positiveCount: Math.max(0, Math.trunc(Number(existing.positiveCount) || 0)),
    strongPositiveCount: Math.max(0, Math.trunc(Number(existing.strongPositiveCount) || 0)),
    negativeCount: Math.max(0, Math.trunc(Number(existing.negativeCount) || 0)),
    correctionCount: Math.max(0, Math.trunc(Number(existing.correctionCount) || 0)),
    lastSeenAt: Math.max(0, Number(existing.lastSeenAt) || now),
    lastEventId: typeof existing.lastEventId === 'string' && existing.lastEventId
      ? existing.lastEventId
      : `manual_${mappingId}`,
    approvedBy: actorUid,
    approvedAt: now,
    updatedAt: now,
  };

  await update(ref(database), {
    [mappingPath]: nextMapping,
    [`auditLogs/${auditId}`]: {
      id: auditId,
      actorUid,
      action: 'SALES_AI_PHONETIC_COMPONENT_MANUAL_APPROVED',
      entityType: 'salesAiLearningComponent',
      entityId: mappingId,
      summary: `Thêm thủ công phonetic mapping: ${source} → ${target}`.slice(0, 240),
      createdAt: now,
    },
  });
}

export async function setSalesAiLearningComponentStatus(
  mappingId: string,
  status: 'approved' | 'disabled' | 'observing',
  actorUid: string,
) {
  const database = requireDatabase();
  const mappingRef = ref(database, `salesAiLearningComponents/${mappingId}`);
  const snapshot = await get(mappingRef);

  if (!snapshot.exists()) {
    throw new Error('Component mapping không còn tồn tại.');
  }

  const raw = snapshot.val() as Partial<SalesAiLearningComponentMapping> & {
    lastEventId?: unknown;
  };
  const source = cleanQuerySnapshot(String(raw.source ?? ''));
  const target = cleanQuerySnapshot(String(raw.target ?? ''));

  if (!source || !target) {
    throw new Error('Component mapping thiếu source hoặc target.');
  }

  const now = Date.now();
  const next: Record<string, unknown> = {
    id: mappingId,
    source,
    target,
    targetType: 'catalog-token',
    status,
    positiveCount: Math.max(0, Math.trunc(Number(raw.positiveCount) || 0)),
    strongPositiveCount: Math.max(0, Math.trunc(Number(raw.strongPositiveCount) || 0)),
    negativeCount: Math.max(0, Math.trunc(Number(raw.negativeCount) || 0)),
    correctionCount: Math.max(0, Math.trunc(Number(raw.correctionCount) || 0)),
    lastSeenAt: Math.max(0, Number(raw.lastSeenAt) || now),
    lastEventId: typeof raw.lastEventId === 'string' && raw.lastEventId
      ? raw.lastEventId
      : `manual_${mappingId}`,
    updatedAt: now,
  };

  if (status === 'approved') {
    next.approvedBy = actorUid;
    next.approvedAt = now;
  }

  await set(mappingRef, next);
}

export async function resetSalesAiLearningComponent(mappingId: string) {
  await set(ref(requireDatabase(), `salesAiLearningComponents/${mappingId}`), null);
}

export async function listSalesAiLearningComponentsForOwner() {
  const snapshot = await get(ref(requireDatabase(), 'salesAiLearningComponents'));
  if (!snapshot.exists()) return [] as SalesAiLearningComponentMapping[];
  const raw = snapshot.val() as Record<string, Partial<SalesAiLearningComponentMapping>>;
  return Object.entries(raw).map(([id, value]) => ({
    id,
    source: cleanQuerySnapshot(String(value.source ?? '')),
    target: cleanQuerySnapshot(String(value.target ?? '')),
    targetType: 'catalog-token' as const,
    status: (value.status ?? 'observing') as SalesAiLearningComponentMapping['status'],
    positiveCount: Math.max(0, Number(value.positiveCount) || 0),
    strongPositiveCount: Math.max(0, Number(value.strongPositiveCount) || 0),
    negativeCount: Math.max(0, Number(value.negativeCount) || 0),
    correctionCount: Math.max(0, Number(value.correctionCount) || 0),
    lastSeenAt: Number(value.lastSeenAt) || 0,
    ...(typeof value.approvedBy === 'string' ? { approvedBy: value.approvedBy } : {}),
    ...(typeof value.approvedAt === 'number' ? { approvedAt: value.approvedAt } : {}),
  }));
}

export interface SalesAiLearningOwnerMapping {
  key: string;
  normalizedSignature: string;
  exampleQuery: string;
  status: 'observing' | 'ambiguous' | 'suggested' | 'approved' | 'disabled';
  topProductId?: string;
  topProductName?: string;
  topConfidence: number;
  productCount: number;
  updatedAt: number;
  approvedProductId?: string;
  aliasPromotedAt?: number;
  promotedAlias?: string;
}

export interface SalesAiLearningMetrics {
  periodDays: number;
  totalQuickAsk: number;
  top1Accuracy: number | null;
  top3Accuracy: number | null;
  queryCorrectionRate: number;
  firstResultAddToCartRate: number | null;
  deepSeekCallRate: number;
  averageCandidateCount: number;
  learnedMappingHitRate: number;
  manualSearchRate: number;
  correctionRate: number;
  falsePositiveRate: number | null;
  averageTimeToProductMs: number | null;
  phoneticResolverHitRate: number;
  ambiguousQueryRate: number;
}

function eventCandidates(value: unknown): SalesAiCandidateSnapshot[] {
  if (Array.isArray(value)) return safeCandidateSnapshots(value as SalesAiCandidateSnapshot[]);
  if (!value || typeof value !== 'object') return [];
  return safeCandidateSnapshots(
    Object.values(value as Record<string, SalesAiCandidateSnapshot>),
  );
}

export async function listSalesAiLearningMappingsForOwner(): Promise<SalesAiLearningOwnerMapping[]> {
  const snapshot = await get(ref(requireDatabase(), 'salesAiLearning'));
  if (!snapshot.exists()) return [];

  const raw = snapshot.val() as Record<string, Record<string, unknown>>;
  return Object.entries(raw)
    .map(([key, bucket]) => {
      const normalizedSignature = cleanQuerySnapshot(String(
        bucket.normalizedSignature ?? bucket.normalizedQuery ?? '',
      ));
      const exampleQuery = cleanQuerySnapshot(String(bucket.exampleQuery ?? normalizedSignature));
      const v2Products = (bucket.v2Products ?? {}) as Record<string, Partial<LearningV2ProductStats>>;
      const legacyProducts = (bucket.products ?? {}) as Record<string, Partial<LegacyLearningProductStats>>;
      const ids = [...new Set([...Object.keys(v2Products), ...Object.keys(legacyProducts)])];
      const totalPositive = Object.values(v2Products).reduce((sum, value) => sum + weightedPositive(value), 0);
      const now = Date.now();
      const ranked = ids.map((productId) => {
        const v2 = v2Products[productId] ?? {};
        const legacy = legacyProducts[productId] ?? {};
        const confidence = confidenceFor(v2, totalPositive, now);
        const score = weightedPositive(v2) + Math.max(0, Number(legacy.score) || 0);
        return {
          productId,
          productName: String(v2.productName ?? legacy.productName ?? ''),
          confidence,
          score,
        };
      }).sort((left, right) => {
        if (left.confidence !== right.confidence) return right.confidence - left.confidence;
        return right.score - left.score;
      });

      const top = ranked[0];
      const statusRaw = String(bucket.status ?? 'observing');
      const status: SalesAiLearningOwnerMapping['status'] =
        statusRaw === 'approved'
        || statusRaw === 'disabled'
        || statusRaw === 'ambiguous'
        || statusRaw === 'suggested'
          ? statusRaw
          : 'observing';

      return {
        key,
        normalizedSignature,
        exampleQuery,
        status,
        ...(top?.productId ? { topProductId: top.productId } : {}),
        ...(top?.productName ? { topProductName: top.productName } : {}),
        topConfidence: top?.confidence ?? 0,
        productCount: ids.length,
        updatedAt: Number(bucket.updatedAt) || 0,
        ...(typeof bucket.approvedProductId === 'string'
          ? { approvedProductId: bucket.approvedProductId }
          : {}),
        ...(typeof bucket.aliasPromotedAt === 'number'
          ? { aliasPromotedAt: bucket.aliasPromotedAt }
          : {}),
        ...(typeof bucket.promotedAlias === 'string' && cleanQuerySnapshot(bucket.promotedAlias)
          ? { promotedAlias: cleanQuerySnapshot(bucket.promotedAlias) }
          : {}),
      };
    })
    .filter((item) => Boolean(item.normalizedSignature))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function setSalesAiLearningMappingStatus(
  key: string,
  status: 'approved' | 'disabled' | 'observing',
  actorUid: string,
  approvedProductId?: string,
) {
  const now = Date.now();
  await update(ref(requireDatabase()), {
    [`salesAiLearning/${key}/status`]: status,
    [`salesAiLearning/${key}/approvedProductId`]:
      status === 'approved' && approvedProductId ? approvedProductId : null,
    [`salesAiLearning/${key}/approvedBy`]: status === 'approved' ? actorUid : null,
    [`salesAiLearning/${key}/approvedAt`]: status === 'approved' ? now : null,
    [`salesAiLearning/${key}/updatedAt`]: now,
  });
}

export async function resetSalesAiLearningMapping(key: string) {
  await set(ref(requireDatabase(), `salesAiLearning/${key}`), null);
}

export async function promoteSalesAiLearningAlias(key: string, actorUid: string) {
  const database = requireDatabase();
  const [bucketSnapshot, productsSnapshot] = await Promise.all([
    get(ref(database, `salesAiLearning/${key}`)),
    get(ref(database, 'products')),
  ]);
  if (!bucketSnapshot.exists()) throw new Error('Không còn mapping learning để duyệt alias.');

  const approvedProductId = bucketSnapshot.child('approvedProductId').val();
  const alias = cleanQuerySnapshot(String(bucketSnapshot.child('exampleQuery').val() ?? ''));
  if (typeof approvedProductId !== 'string' || !approvedProductId || !alias) {
    throw new Error('Mapping phải được Owner duyệt Product trước khi thêm alias.');
  }
  if (!productsSnapshot.child(approvedProductId).exists()) {
    throw new Error('Product đích không còn tồn tại.');
  }

  const product = productsSnapshot.child(approvedProductId).val() as Product;
  if (product.active !== true) throw new Error('Product đích đang ngừng hoạt động.');
  const aliases = [...new Set([...(product.aliases ?? []), alias].map((value) => value.trim()).filter(Boolean))];
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo audit log cho alias.');

  const now = Date.now();
  await update(ref(database), {
    [`products/${approvedProductId}/aliases`]: aliases,
    [`products/${approvedProductId}/updatedAt`]: now,
    [`salesAiLearning/${key}/aliasPromotedAt`]: now,
    [`salesAiLearning/${key}/promotedAlias`]: alias,
    [`salesAiLearning/${key}/updatedAt`]: now,
    [`auditLogs/${auditId}`]: {
      id: auditId,
      actorUid,
      action: 'SALES_AI_ALIAS_APPROVED',
      entityType: 'product',
      entityId: approvedProductId,
      summary: `Duyệt alias từ Sales AI: ${alias}`.slice(0, 240),
      createdAt: now,
    },
  });
}

export async function updateSalesAiLearningPromotedAlias(
  key: string,
  nextAliasRaw: string,
  actorUid: string,
) {
  const database = requireDatabase();
  const [bucketSnapshot, productsSnapshot] = await Promise.all([
    get(ref(database, `salesAiLearning/${key}`)),
    get(ref(database, 'products')),
  ]);

  if (!bucketSnapshot.exists()) throw new Error('Không còn mapping learning để sửa alias.');

  const approvedProductId = bucketSnapshot.child('approvedProductId').val();
  const aliasPromotedAt = bucketSnapshot.child('aliasPromotedAt').val();
  const originalAlias = cleanQuerySnapshot(String(
    bucketSnapshot.child('promotedAlias').val()
      ?? bucketSnapshot.child('exampleQuery').val()
      ?? '',
  ));
  const nextAlias = cleanQuerySnapshot(nextAliasRaw);

  if (typeof approvedProductId !== 'string' || !approvedProductId || typeof aliasPromotedAt !== 'number') {
    throw new Error('Mapping chưa được chuyển thành alias.');
  }
  if (!nextAlias) throw new Error('Alias mới không được để trống.');
  if (!productsSnapshot.child(approvedProductId).exists()) {
    throw new Error('Product đích không còn tồn tại.');
  }

  const product = productsSnapshot.child(approvedProductId).val() as Product;
  if (product.active !== true) throw new Error('Product đích đang ngừng hoạt động.');

  const normalizeAlias = (value: string) => cleanQuerySnapshot(value).toLocaleLowerCase('vi');
  const originalKey = normalizeAlias(originalAlias);
  const nextKey = normalizeAlias(nextAlias);
  const aliases = (product.aliases ?? [])
    .map((value) => cleanQuerySnapshot(value))
    .filter(Boolean)
    .filter((value) => !originalKey || normalizeAlias(value) !== originalKey);

  if (!aliases.some((value) => normalizeAlias(value) === nextKey)) aliases.push(nextAlias);

  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo audit log khi sửa alias.');

  const now = Date.now();
  await update(ref(database), {
    [`products/${approvedProductId}/aliases`]: aliases,
    [`products/${approvedProductId}/updatedAt`]: now,
    [`salesAiLearning/${key}/promotedAlias`]: nextAlias,
    [`salesAiLearning/${key}/aliasEditedAt`]: now,
    [`salesAiLearning/${key}/updatedAt`]: now,
    [`auditLogs/${auditId}`]: {
      id: auditId,
      actorUid,
      action: 'SALES_AI_ALIAS_UPDATED',
      entityType: 'product',
      entityId: approvedProductId,
      summary: `Sửa alias Sales AI: ${originalAlias || '(trống)'} → ${nextAlias}`.slice(0, 240),
      createdAt: now,
    },
  });
}

export async function getSalesAiLearningMetricsForOwner(periodDays = 30): Promise<SalesAiLearningMetrics> {
  const safeDays = Math.max(1, Math.min(180, Math.round(periodDays) || 30));
  const since = Date.now() - (safeDays * 24 * 60 * 60 * 1000);
  const snapshot = await get(ref(requireDatabase(), 'salesAiLearningEvents'));
  const events = snapshot.exists()
    ? Object.values(snapshot.val() as Record<string, Record<string, unknown>>)
        .filter((event) => Number(event.createdAt) >= since && event.environment === 'production')
    : [];

  const queries = events.filter((event) => event.event === 'QUERY_RESULT');
  const actions = events.filter((event) => (
    event.event === 'PRODUCT_SELECTED'
    || event.event === 'ADD_TO_CART'
    || event.event === 'CORRECTION_WIN'
  ));
  const corrections = events.filter((event) => event.event === 'CORRECTION_WIN');
  const correctionLosses = events.filter((event) => event.event === 'CORRECTION_LOSS');
  const addEvents = events.filter((event) => event.event === 'ADD_TO_CART');

  const selectedWithCandidates = actions
    .map((event) => ({
      productId: String(event.productId ?? ''),
      candidates: eventCandidates(event.candidates),
    }))
    .filter((event) => event.productId && event.candidates.length > 0);
  const top1Hits = selectedWithCandidates.filter(
    (event) => event.candidates[0]?.productId === event.productId,
  ).length;
  const top3Hits = selectedWithCandidates.filter(
    (event) => event.candidates.slice(0, 3).some((candidate) => candidate.productId === event.productId),
  ).length;

  const addWithCandidates = addEvents
    .map((event) => ({
      productId: String(event.productId ?? ''),
      candidates: eventCandidates(event.candidates),
    }))
    .filter((event) => event.productId && event.candidates.length > 0);
  const firstAddHits = addWithCandidates.filter(
    (event) => event.candidates[0]?.productId === event.productId,
  ).length;

  const times = events
    .map((event) => Number(event.timeToSelectionMs))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const candidateCounts = queries.map((event) => eventCandidates(event.candidates).length);

  const totalQuickAsk = queries.length;
  return {
    periodDays: safeDays,
    totalQuickAsk,
    top1Accuracy: selectedWithCandidates.length
      ? top1Hits / selectedWithCandidates.length
      : null,
    top3Accuracy: selectedWithCandidates.length
      ? top3Hits / selectedWithCandidates.length
      : null,
    queryCorrectionRate: totalQuickAsk ? corrections.length / totalQuickAsk : 0,
    firstResultAddToCartRate: addWithCandidates.length
      ? firstAddHits / addWithCandidates.length
      : null,
    deepSeekCallRate: totalQuickAsk
      ? queries.filter((event) => event.deepSeekCalled === true).length / totalQuickAsk
      : 0,
    averageCandidateCount: candidateCounts.length
      ? candidateCounts.reduce((sum, value) => sum + value, 0) / candidateCounts.length
      : 0,
    learnedMappingHitRate: totalQuickAsk
      ? queries.filter((event) => event.learnedMappingHit === true).length / totalQuickAsk
      : 0,
    manualSearchRate: totalQuickAsk
      ? queries.filter((event) => event.manualCorrection === true).length / totalQuickAsk
      : 0,
    correctionRate: totalQuickAsk ? corrections.length / totalQuickAsk : 0,
    falsePositiveRate: actions.length ? correctionLosses.length / actions.length : null,
    averageTimeToProductMs: times.length
      ? times.reduce((sum, value) => sum + value, 0) / times.length
      : null,
    phoneticResolverHitRate: totalQuickAsk
      ? queries.filter((event) => event.localPhoneticResolved === true).length / totalQuickAsk
      : 0,
    ambiguousQueryRate: totalQuickAsk
      ? queries.filter((event) => event.ambiguous === true).length / totalQuickAsk
      : 0,
  };
}


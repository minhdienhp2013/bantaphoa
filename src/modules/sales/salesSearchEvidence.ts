import { searchProducts, type ProductSearchResult, type SalePriceFilter } from '../../shared/search/productSearch';
import { prepareSearchCandidate, prepareSearchQuery } from '../../shared/search/searchNormalization';
import type { Category, Product } from '../../types/models';
import type { SalesAiLearningEvidence } from './salesAiLearningSearch';
import type { SalesLocalResolution } from './salesLocalPhoneticResolver';
import { isModelLikeToken } from './salesLocalPhoneticResolver';

export type SalesEvidenceTier =
  | 'hard-identifier'
  | 'exact-catalog'
  | 'model-variant'
  | 'token-coverage'
  | 'phonetic'
  | 'bounded-fuzzy';

export interface SalesEvidenceCandidate {
  result: ProductSearchResult;
  score: number;
  evidenceTier: SalesEvidenceTier;
  reasons: string[];
  candidateIndex: number;
}

export interface SalesEvidenceDecision {
  status: 'resolved' | 'ambiguous' | 'weak' | 'none';
  ranked: SalesEvidenceCandidate[];
  topMargin: number | null;
}

const UI_RESULT_LIMIT = 5;
const AUTO_RESOLVE_MIN_SCORE = 150;
const AMBIGUOUS_MIN_SCORE = 110;
const AUTO_RESOLVE_MARGIN = 22;
const LEARNING_MAX_BOOST = 15;
const LEARNING_MIN_BOOST = -8;
const LEARNING_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function learningBoost(
  productId: string,
  evidence: SalesAiLearningEvidence,
  now: number,
) {
  const entry = evidence[productId];
  if (!entry) return 0;

  const ageMs = Math.max(0, now - Number(entry.lastEventAt || 0));
  const decay = Math.pow(0.5, ageMs / LEARNING_HALF_LIFE_MS);
  const raw = Number.isFinite(entry.score) ? entry.score : 0;
  return clamp(raw * decay, LEARNING_MIN_BOOST, LEARNING_MAX_BOOST);
}

function allProductTokens(product: Product) {
  return [...new Set([
    ...prepareSearchCandidate(product.name).tokens,
    ...prepareSearchCandidate(product.sku).tokens,
    ...(product.aliases ?? []).flatMap((alias) => prepareSearchCandidate(alias).tokens),
  ])];
}

function evidenceFor(
  result: ProductSearchResult,
  resolution: SalesLocalResolution,
  candidateIndex: number,
  evidence: SalesAiLearningEvidence,
  now: number,
): Omit<SalesEvidenceCandidate, 'result' | 'candidateIndex'> {
  const productTokens = allProductTokens(result.product);
  const queryTokens = prepareSearchQuery(resolution.candidates[candidateIndex] ?? resolution.normalizedQuery).tokens;
  const modelTokens = queryTokens.filter(isModelLikeToken);
  const exactTokenCount = queryTokens.filter((token) => productTokens.includes(token)).length;
  const modelMatches = modelTokens.filter((token) => productTokens.includes(token)).length;
  const transformedTargets = resolution.transformations.map((item) => item.target);
  const phoneticTargetMatches = transformedTargets.filter((target) => productTokens.includes(target)).length;
  const coverage = queryTokens.length > 0 ? exactTokenCount / queryTokens.length : 0;

  let tier: SalesEvidenceTier;
  if (result.rank <= 3) tier = 'hard-identifier';
  else if (result.rank <= 5) tier = 'exact-catalog';
  else if (modelMatches > 0) tier = 'model-variant';
  else if (coverage >= 0.6) tier = 'token-coverage';
  else if (phoneticTargetMatches > 0) tier = 'phonetic';
  else tier = 'bounded-fuzzy';

  const reasons: string[] = [];
  if (result.rank <= 5) reasons.push(result.kind);
  if (modelMatches > 0) reasons.push(`model:${modelMatches}`);
  if (coverage > 0) reasons.push(`coverage:${coverage.toFixed(2)}`);
  if (phoneticTargetMatches > 0) reasons.push(`phonetic:${phoneticTargetMatches}`);

  const rankBase = 220 - (result.rank * 8);
  const candidatePriority = Math.max(0, 16 - (candidateIndex * 4));
  const modelScore = modelMatches * 28;
  const coverageScore = Math.round(coverage * 28);
  const phoneticScore = phoneticTargetMatches * 10;
  const learned = learningBoost(result.product.id, evidence, now);
  if (learned !== 0) reasons.push(`learned:${learned.toFixed(1)}`);

  return {
    score: rankBase + candidatePriority + modelScore + coverageScore + phoneticScore + learned,
    evidenceTier: tier,
    reasons,
  };
}

export function rankLocalSalesCandidates(
  products: readonly Product[],
  categories: readonly Category[],
  resolution: SalesLocalResolution,
  evidence: SalesAiLearningEvidence = {},
  options: { salePrice?: SalePriceFilter; now?: number } = {},
): SalesEvidenceCandidate[] {
  const active = products.filter((product) => product.active === true);
  const aggregated = new Map<string, { result: ProductSearchResult; candidateIndex: number }>();

  resolution.candidates.forEach((candidate, candidateIndex) => {
    const matches = searchProducts(active, candidate, {
      categories,
      limit: 12,
      ...(options.salePrice ? { salePrice: options.salePrice } : {}),
    });

    for (const result of matches) {
      const current = aggregated.get(result.product.id);
      if (
        !current
        || result.rank < current.result.rank
        || (result.rank === current.result.rank && candidateIndex < current.candidateIndex)
      ) {
        aggregated.set(result.product.id, { result, candidateIndex });
      }
    }
  });

  const now = options.now ?? Date.now();
  return [...aggregated.values()]
    .map(({ result, candidateIndex }) => ({
      result,
      candidateIndex,
      ...evidenceFor(result, resolution, candidateIndex, evidence, now),
    }))
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      if (left.result.rank !== right.result.rank) return left.result.rank - right.result.rank;
      return left.result.product.name.localeCompare(right.result.product.name, 'vi');
    })
    .slice(0, UI_RESULT_LIMIT);
}

export function decideSalesEvidence(ranked: readonly SalesEvidenceCandidate[]): SalesEvidenceDecision {
  if (ranked.length === 0) {
    return { status: 'none', ranked: [], topMargin: null };
  }

  const top = ranked[0];
  const second = ranked[1];
  const margin = second ? top.score - second.score : null;

  if (top.evidenceTier === 'hard-identifier' || top.evidenceTier === 'exact-catalog') {
    if (!second || top.result.rank < second.result.rank) {
      return { status: 'resolved', ranked: [...ranked], topMargin: margin };
    }
  }

  if (
    top.score >= AUTO_RESOLVE_MIN_SCORE
    && (!second || (margin ?? AUTO_RESOLVE_MARGIN) >= AUTO_RESOLVE_MARGIN)
    && top.evidenceTier !== 'bounded-fuzzy'
  ) {
    return { status: 'resolved', ranked: [...ranked], topMargin: margin };
  }

  if (top.score >= AMBIGUOUS_MIN_SCORE) {
    return { status: 'ambiguous', ranked: [...ranked], topMargin: margin };
  }

  return { status: 'weak', ranked: [...ranked], topMargin: margin };
}

export function summarizeEvidenceCandidates(ranked: readonly SalesEvidenceCandidate[]) {
  return ranked.slice(0, UI_RESULT_LIMIT).map((candidate, index) => ({
    productId: candidate.result.product.id,
    rank: index,
    score: Math.round(candidate.score),
    evidenceTier: candidate.evidenceTier,
  }));
}

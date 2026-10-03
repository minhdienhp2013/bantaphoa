import { prepareSearchQuery } from '../../shared/search/searchNormalization';
import type { SalesLocalResolution } from './salesLocalPhoneticResolver';
import { isModelLikeToken } from './salesLocalPhoneticResolver';

const LEADING_COMMAND_TOKENS = new Set([
  'tim', 'kiem', 'cho', 'them', 'lay', 'xem', 'hoi',
  'gia', 'con', 'hang', 'khong', 'bao', 'nhieu',
  'vao', 'hoa', 'don', 'gio',
]);

function cleanTokens(value: string) {
  return prepareSearchQuery(value).tokens.filter(Boolean);
}

function stripLeadingCommandTokens(tokens: readonly string[]) {
  let start = 0;
  while (start < tokens.length && LEADING_COMMAND_TOKENS.has(tokens[start])) start += 1;
  return tokens.slice(start);
}

export interface SalesLearningSignature {
  normalizedSignature: string;
  signatureKey: string;
  modelTokens: string[];
}

export function hashSalesLearningSignature(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `q_${(hash >>> 0).toString(16).padStart(8, '0')}_${value.length}`;
}

export function buildSalesLearningSignature(
  resolution: Pick<SalesLocalResolution, 'normalizedQuery' | 'candidates'>,
): SalesLearningSignature {
  const best = resolution.candidates[0] || resolution.normalizedQuery;
  const tokens = stripLeadingCommandTokens(cleanTokens(best));
  const modelIndexes = tokens
    .map((token, index) => isModelLikeToken(token) ? index : -1)
    .filter((index) => index >= 0);

  let signatureTokens = [...tokens];
  if (modelIndexes.length > 0) {
    const firstModelIndex = modelIndexes[0];
    // A model/code is a strong clustering anchor. Keep it and all following
    // distinguishing tokens, while dropping noisy speech before the model.
    signatureTokens = tokens.slice(firstModelIndex);
  }

  if (signatureTokens.length === 0) signatureTokens = cleanTokens(resolution.normalizedQuery);
  const normalizedSignature = signatureTokens.join(' ').slice(0, 240);

  return {
    normalizedSignature,
    signatureKey: hashSalesLearningSignature(normalizedSignature),
    modelTokens: signatureTokens.filter(isModelLikeToken),
  };
}

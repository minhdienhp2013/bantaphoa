import type { Category, Product } from '../../types/models';
import { prepareSearchCandidate, prepareSearchQuery } from '../../shared/search/searchNormalization';

export type SalesLocalTransformationKind = 'spoken-model' | 'phonetic' | 'learned';

export interface SalesLocalTransformation {
  source: string;
  target: string;
  kind: SalesLocalTransformationKind;
  confidence: number;
}

export interface SalesCatalogVocabulary {
  lexicalTokens: string[];
  modelTokens: string[];
  categoryTokens: string[];
  // Full token set from the active catalog. Manual owner-approved mappings use
  // this broader set so short alphabetic aliases/SKUs (for example "sz") are
  // valid targets without making the automatic phonetic matcher more permissive.
  catalogTokens: string[];
}

export interface SalesApprovedPhoneticMapping {
  source: string;
  target: string;
}

export interface SalesLocalResolution {
  originalQuery: string;
  normalizedQuery: string;
  candidates: string[];
  transformations: SalesLocalTransformation[];
  vocabulary: SalesCatalogVocabulary;
}

interface Replacement extends SalesLocalTransformation {
  start: number;
  end: number;
}

const MAX_NORMALIZED_CANDIDATES = 5;
const MAX_LEXICAL_VOCABULARY = 2500;
const MAX_MODEL_VOCABULARY = 800;
const MODEL_TOKEN_PATTERN = /^[a-z]{1,4}\d{1,5}[a-z0-9]*$/u;
const ALPHA_TOKEN_PATTERN = /^[a-z]+$/u;
const DIGIT_WORDS = ['khong', 'mot', 'hai', 'ba', 'bon', 'nam', 'sau', 'bay', 'tam', 'chin'] as const;

const LETTER_SPOKEN_FORMS: Readonly<Record<string, readonly string[]>> = {
  a: ['a'],
  b: ['b', 'be'],
  c: ['c', 'xe'],
  d: ['d', 'de'],
  e: ['e'],
  f: ['f', 'ep'],
  g: ['g', 'go'],
  h: ['h', 'hat'],
  i: ['i'],
  j: ['j', 'giay'],
  k: ['k', 'ca'],
  l: ['l', 'el', 'e lo'],
  m: ['m', 'em'],
  n: ['n', 'en'],
  o: ['o'],
  p: ['p', 'pe'],
  q: ['q', 'quy'],
  r: ['r', 'e ro'],
  s: ['s', 'et'],
  t: ['t', 'te'],
  u: ['u'],
  v: ['v', 've'],
  w: ['w', 've kep'],
  x: ['x', 'ich'],
  y: ['y', 'i dai'],
  z: ['z', 'det'],
};

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function clean(value: string) {
  return prepareSearchQuery(value).normalized;
}

function compact(value: string) {
  return prepareSearchQuery(value).compact;
}

function boundedDistance(left: string, right: string, maxDistance: number) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  const overflow = maxDistance + 1;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => Math.min(index, overflow));
  const current = new Array<number>(right.length + 1).fill(overflow);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = Math.min(leftIndex, overflow);
    let rowMin = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost,
        overflow,
      );
      rowMin = Math.min(rowMin, current[rightIndex]);
    }

    if (rowMin > maxDistance) return overflow;
    for (let index = 0; index <= right.length; index += 1) previous[index] = current[index];
  }

  return previous[right.length];
}

function phoneticFold(value: string) {
  return compact(value)
    .replace(/ngh/gu, 'ng')
    .replace(/gh/gu, 'g')
    .replace(/ph/gu, 'f')
    .replace(/th/gu, 't')
    .replace(/tr/gu, 'c')
    .replace(/ch/gu, 'c')
    .replace(/[pb]/gu, 'b')
    .replace(/[ckq]/gu, 'k')
    .replace(/[aeiouy]+/gu, 'a')
    .replace(/h$/u, '')
    .replace(/(.)\1+/gu, '$1');
}

function similarity(left: string, right: string) {
  const plainLeft = compact(left);
  const plainRight = compact(right);
  if (!plainLeft || !plainRight) return 0;

  const plainMax = Math.max(plainLeft.length, plainRight.length);
  const plainLimit = Math.max(1, Math.floor(plainMax * 0.42));
  const plainDistance = boundedDistance(plainLeft, plainRight, plainLimit);
  const plainScore = plainDistance > plainLimit ? 0 : 1 - (plainDistance / plainMax);

  const foldedLeft = phoneticFold(left);
  const foldedRight = phoneticFold(right);
  const foldedMax = Math.max(foldedLeft.length, foldedRight.length);
  const foldedLimit = Math.max(1, Math.floor(foldedMax * 0.38));
  const foldedDistance = boundedDistance(foldedLeft, foldedRight, foldedLimit);
  const foldedScore = foldedDistance > foldedLimit || foldedMax === 0
    ? 0
    : 1 - (foldedDistance / foldedMax);

  return Math.max(plainScore, foldedScore);
}

function numberBelow100(value: number) {
  if (value < 10) return DIGIT_WORDS[value];
  const tens = Math.floor(value / 10);
  const units = value % 10;
  if (tens === 1) {
    if (units === 0) return 'muoi';
    if (units === 5) return 'muoi lam';
    return `muoi ${DIGIT_WORDS[units]}`;
  }

  const head = `${DIGIT_WORDS[tens]} muoi`;
  if (units === 0) return head;
  if (units === 1) return `${head} mot`;
  if (units === 4) return `${head} tu`;
  if (units === 5) return `${head} lam`;
  return `${head} ${DIGIT_WORDS[units]}`;
}

function cardinalNumberWords(rawDigits: string) {
  if (!/^\d{1,3}$/u.test(rawDigits) || (rawDigits.length > 1 && rawDigits.startsWith('0'))) return null;
  const value = Number(rawDigits);
  if (!Number.isInteger(value) || value < 0 || value > 999) return null;
  if (value < 100) return numberBelow100(value);

  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  if (remainder === 0) return `${DIGIT_WORDS[hundreds]} tram`;
  if (remainder < 10) return `${DIGIT_WORDS[hundreds]} tram le ${DIGIT_WORDS[remainder]}`;
  return `${DIGIT_WORDS[hundreds]} tram ${numberBelow100(remainder)}`;
}

function digitByDigitForms(rawDigits: string) {
  const digits = [...rawDigits];
  const normal = digits.map((digit) => DIGIT_WORDS[Number(digit)]).join(' ');
  const variants = [normal, digits.join(' '), rawDigits];

  if (digits.length >= 2 && digits[digits.length - 1] === '5') {
    variants.push([
      ...digits.slice(0, -1).map((digit) => DIGIT_WORDS[Number(digit)]),
      'lam',
    ].join(' '));
    variants.push([
      ...digits.slice(0, -1),
      'lam',
    ].join(' '));
  }

  const cardinal = cardinalNumberWords(rawDigits);
  if (cardinal) variants.push(cardinal);
  return unique(variants.map(clean).filter(Boolean));
}

function prefixForms(prefix: string) {
  const chars = [...prefix];
  const forms = [prefix, chars.join(' ')];

  const spoken = chars.map((char) => LETTER_SPOKEN_FORMS[char]?.[1] ?? char).join(' ');
  forms.push(spoken);

  if (chars.length === 1) {
    forms.push(...(LETTER_SPOKEN_FORMS[chars[0]] ?? [chars[0]]));
  }

  return unique(forms.map(clean).filter(Boolean));
}

function modelSpokenForms(modelToken: string) {
  const match = /^([a-z]{1,4})(\d{1,5})([a-z0-9]*)$/u.exec(modelToken);
  if (!match) return [];

  const [, prefix, digits, suffix] = match;
  if (suffix) return [clean(modelToken)];

  const forms = new Set<string>([clean(modelToken)]);
  const prefixes = prefixForms(prefix);
  const numbers = digitByDigitForms(digits);

  for (const prefixForm of prefixes) {
    for (const numberForm of numbers) {
      forms.add(clean(`${prefixForm} ${numberForm}`));
    }
  }

  return [...forms].filter(Boolean);
}

function collectForms(values: readonly string[]) {
  return values
    .flatMap((value) => {
      const forms = prepareSearchCandidate(value);
      return forms.tokens;
    })
    .filter(Boolean);
}

export function buildSalesCatalogVocabulary(
  products: readonly Product[],
  categories: readonly Category[] = [],
): SalesCatalogVocabulary {
  const active = products.filter((product) => product.active === true);
  const categoryTokens = unique(collectForms(
    categories.filter((category) => category.active === true).map((category) => category.name),
  ));

  const lexical = new Set<string>();
  const models = new Set<string>();
  const catalog = new Set<string>(categoryTokens);

  for (const product of active) {
    const displayFields = [product.name, ...(product.aliases ?? [])];
    const codeFields = [product.sku];
    const displayTokens = collectForms(displayFields);
    const codeTokens = collectForms(codeFields);

    for (const token of [...displayTokens, ...codeTokens]) {
      catalog.add(token);
    }

    // Brand/word phonetics prefer human-facing catalog text. SKU is still
    // included for model/code vocabulary, but an arbitrary alphabetic SKU
    // fragment must not outrank the real Product name as an automatic target.
    for (const token of displayTokens) {
      if (MODEL_TOKEN_PATTERN.test(token)) {
        if (models.size < MAX_MODEL_VOCABULARY) models.add(token);
        continue;
      }
      if (
        lexical.size < MAX_LEXICAL_VOCABULARY
        && ALPHA_TOKEN_PATTERN.test(token)
        && token.length >= 5
      ) {
        lexical.add(token);
      }
    }

    for (const token of codeTokens) {
      if (MODEL_TOKEN_PATTERN.test(token) && models.size < MAX_MODEL_VOCABULARY) {
        models.add(token);
      }
    }
  }

  for (const token of categoryTokens) {
    if (lexical.size >= MAX_LEXICAL_VOCABULARY) break;
    if (ALPHA_TOKEN_PATTERN.test(token) && token.length >= 5) lexical.add(token);
  }

  return {
    lexicalTokens: [...lexical],
    modelTokens: [...models],
    categoryTokens,
    catalogTokens: [...catalog],
  };
}

function buildModelFormIndex(modelTokens: readonly string[]) {
  const index = new Map<string, Set<string>>();
  for (const modelToken of modelTokens) {
    for (const form of modelSpokenForms(modelToken)) {
      const key = compact(form);
      if (!key) continue;
      const targets = index.get(key) ?? new Set<string>();
      targets.add(modelToken);
      index.set(key, targets);
    }
  }
  return index;
}

function findApprovedMappingReplacements(
  tokens: readonly string[],
  mappings: readonly SalesApprovedPhoneticMapping[],
  vocabulary: SalesCatalogVocabulary,
) {
  const replacements: Replacement[] = [];
  const allowedTargets = new Set(vocabulary.catalogTokens);

  for (const mapping of mappings) {
    const sourceTokens = prepareSearchQuery(mapping.source).tokens;
    const target = clean(mapping.target);
    if (!sourceTokens.length || !target || !allowedTargets.has(target)) continue;

    for (let start = 0; start + sourceTokens.length <= tokens.length; start += 1) {
      const source = tokens.slice(start, start + sourceTokens.length).join(' ');
      if (compact(source) !== compact(mapping.source)) continue;
      if (clean(source) === target) continue;
      replacements.push({
        start,
        end: start + sourceTokens.length,
        source,
        target,
        kind: 'learned',
        confidence: 1,
      });
    }
  }

  return replacements;
}

function findModelReplacements(tokens: readonly string[], vocabulary: SalesCatalogVocabulary) {
  const replacements: Replacement[] = [];
  const index = buildModelFormIndex(vocabulary.modelTokens);

  for (let start = 0; start < tokens.length; start += 1) {
    for (let length = 1; length <= 5 && start + length <= tokens.length; length += 1) {
      const source = tokens.slice(start, start + length).join(' ');
      const targets = index.get(compact(source));
      if (!targets || targets.size !== 1) continue;
      const target = [...targets][0];
      if (clean(source) === target) continue;

      replacements.push({
        start,
        end: start + length,
        source,
        target,
        kind: 'spoken-model',
        confidence: 1,
      });
    }
  }

  return replacements;
}

function phoneticThreshold(sourceCompact: string, target: string) {
  const maxLength = Math.max(sourceCompact.length, target.length);
  if (maxLength <= 5) return 0.78;
  if (maxLength <= 7) return 0.62;
  return 0.61;
}

function findPhoneticReplacements(tokens: readonly string[], vocabulary: SalesCatalogVocabulary) {
  const replacements: Replacement[] = [];

  for (let start = 0; start < tokens.length; start += 1) {
    for (let length = 1; length <= 3 && start + length <= tokens.length; length += 1) {
      const source = tokens.slice(start, start + length).join(' ');
      const sourceCompact = compact(source);
      if (sourceCompact.length < 4 || /\d/u.test(sourceCompact)) continue;

      let bestTarget = '';
      let bestScore = 0;
      let secondScore = 0;

      for (const target of vocabulary.lexicalTokens) {
        if (target === sourceCompact) continue;
        if (phoneticFold(target)[0] !== phoneticFold(sourceCompact)[0]) continue;

        const score = similarity(sourceCompact, target);
        if (score > bestScore) {
          secondScore = bestScore;
          bestScore = score;
          bestTarget = target;
        } else if (score > secondScore) {
          secondScore = score;
        }
      }

      if (!bestTarget || bestScore < phoneticThreshold(sourceCompact, bestTarget)) continue;
      if (bestScore - secondScore < 0.08 && secondScore > 0) continue;

      replacements.push({
        start,
        end: start + length,
        source,
        target: bestTarget,
        kind: 'phonetic',
        confidence: Number(bestScore.toFixed(3)),
      });
    }
  }

  return replacements;
}

function overlaps(left: Replacement, right: Replacement) {
  return left.start < right.end && right.start < left.end;
}

function selectCompatibleReplacements(replacements: readonly Replacement[]) {
  const selected: Replacement[] = [];
  const ordered = [...replacements].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'spoken-model' ? -1 : 1;
    if (left.confidence !== right.confidence) return right.confidence - left.confidence;
    const leftLength = left.end - left.start;
    const rightLength = right.end - right.start;
    if (leftLength !== rightLength) return rightLength - leftLength;
    return left.start - right.start;
  });

  for (const replacement of ordered) {
    if (selected.some((current) => overlaps(current, replacement))) continue;
    selected.push(replacement);
  }

  return selected.sort((left, right) => left.start - right.start);
}

function applyReplacements(tokens: readonly string[], replacements: readonly Replacement[]) {
  if (replacements.length === 0) return tokens.join(' ');

  const result: string[] = [];
  let cursor = 0;
  for (const replacement of replacements) {
    if (replacement.start < cursor) continue;
    result.push(...tokens.slice(cursor, replacement.start));
    result.push(replacement.target);
    cursor = replacement.end;
  }
  result.push(...tokens.slice(cursor));
  return clean(result.join(' '));
}

function addCandidate(target: string[], seen: Set<string>, value: string) {
  const normalized = clean(value);
  if (!normalized) return;
  const key = compact(normalized);
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push(normalized);
}

export function resolveSalesLocalPhonetics(
  products: readonly Product[],
  categories: readonly Category[],
  query: string,
  approvedMappings: readonly SalesApprovedPhoneticMapping[] = [],
): SalesLocalResolution {
  const originalQuery = query.replace(/\s+/gu, ' ').trim();
  const normalizedQuery = clean(originalQuery);
  const tokens = prepareSearchQuery(normalizedQuery).tokens;
  const vocabulary = buildSalesCatalogVocabulary(products, categories);

  const approvedReplacements = findApprovedMappingReplacements(tokens, approvedMappings, vocabulary);
  const modelReplacements = findModelReplacements(tokens, vocabulary);
  const phoneticReplacements = findPhoneticReplacements(tokens, vocabulary);
  const selected = selectCompatibleReplacements([
    ...approvedReplacements,
    ...modelReplacements,
    ...phoneticReplacements,
  ]);

  const candidates: string[] = [];
  const seen = new Set<string>();

  addCandidate(candidates, seen, applyReplacements(tokens, selected));

  for (const replacement of selected) {
    const withoutOne = selected.filter((current) => current !== replacement);
    addCandidate(candidates, seen, applyReplacements(tokens, withoutOne));
    if (candidates.length >= MAX_NORMALIZED_CANDIDATES - 1) break;
  }

  addCandidate(candidates, seen, normalizedQuery);

  return {
    originalQuery,
    normalizedQuery,
    candidates: candidates.slice(0, MAX_NORMALIZED_CANDIDATES),
    transformations: selected.map(({ source, target, kind, confidence }) => ({
      source,
      target,
      kind,
      confidence,
    })),
    vocabulary,
  };
}

export function isModelLikeToken(token: string) {
  return MODEL_TOKEN_PATTERN.test(clean(token));
}

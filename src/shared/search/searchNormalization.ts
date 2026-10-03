export type SearchAliases = Readonly<Record<string, string>>;

export interface SearchForms {
  normalized: string;
  compact: string;
  expanded: string;
  expandedCompact: string;
  tokens: string[];
}

const NAME_SEPARATOR_PATTERN = /[\s\-_.\/\\]+/g;
const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const NUMBER_C_PATTERN = /^(\d+)c$/;
const EMBEDDED_NUMBER_C_PATTERN = /([a-z])(\d+)c(?!anh)(?=$|[a-z]{2,}$)/g;

function removeVietnameseDiacritics(value: string) {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .replace(/[đĐ]/g, 'd');
}

function normalizeBase(value: string) {
  return removeVietnameseDiacritics(value)
    .toLocaleLowerCase('vi')
    .trim();
}

function normalizeNameSeparators(value: string) {
  return value
    .replace(NAME_SEPARATOR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAliasMap(aliases?: SearchAliases) {
  const normalized = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(aliases ?? {})) {
    const key = normalizeNameSeparators(normalizeBase(rawKey));
    const value = normalizeNameSeparators(normalizeBase(rawValue));
    if (key && value) normalized.set(key, value);
  }
  return normalized;
}

function expandToken(token: string, aliases: Map<string, string> | null) {
  const configured = aliases?.get(token);
  if (configured) return configured;

  const numberC = NUMBER_C_PATTERN.exec(token);
  if (numberC) return `${numberC[1]} canh`;

  return token;
}

function expandEmbeddedNumberCQuery(token: string) {
  // Compact user shorthand is intentionally query-only. A suffix of one letter
  // (for example thanh3cm) stays literal so common dimensions do not become
  // false "3 canh" matches. Candidate data never uses this aggressive path.
  return token.replace(EMBEDDED_NUMBER_C_PATTERN, '$1$2canh');
}

function prepareForms(
  value: string,
  aliases: Map<string, string> | null,
  expandEmbeddedQueryShorthand: boolean,
): SearchForms {
  const normalized = normalizeNameSeparators(normalizeBase(value));
  const compact = normalized.replace(/\s+/g, '');
  const expanded = normalized
    .split(' ')
    .filter(Boolean)
    .map((token) => expandToken(token, aliases))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = expanded.split(' ').filter(Boolean);
  const expandedCompact = tokens
    .map((token) => expandEmbeddedQueryShorthand ? expandEmbeddedNumberCQuery(token) : token)
    .join('');

  return {
    normalized,
    compact,
    expanded,
    expandedCompact,
    tokens,
  };
}

export function prepareSearchQuery(value: string, aliases?: SearchAliases): SearchForms {
  return prepareForms(value, buildAliasMap(aliases), true);
}

export function prepareSearchCandidate(value: string): SearchForms {
  return prepareForms(value, null, false);
}

// Backward-compatible query preparation used by the Purchase smart-search hotfix.
export function normalizeSearchText(value: string, aliases?: SearchAliases): SearchForms {
  return prepareSearchQuery(value, aliases);
}

export function normalizeSearchCode(value: string | undefined) {
  return value?.trim().toLocaleLowerCase('vi') ?? '';
}

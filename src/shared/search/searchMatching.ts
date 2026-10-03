import {
  normalizeSearchCode,
  prepareSearchCandidate,
  prepareSearchQuery,
  type SearchAliases,
  type SearchForms,
} from './searchNormalization';

export interface PreparedSearchQuery {
  text: SearchForms;
  code: string;
}

export interface SearchFields {
  text?: readonly (string | null | undefined)[];
  codes?: readonly (string | null | undefined)[];
}

export function prepareSharedSearchQuery(value: string, aliases?: SearchAliases): PreparedSearchQuery {
  return {
    text: prepareSearchQuery(value, aliases),
    code: normalizeSearchCode(value),
  };
}

export function matchesPreparedSearchText(candidateValue: string, query: SearchForms) {
  if (!query.normalized) return true;

  const candidate = prepareSearchCandidate(candidateValue);
  if (!candidate.normalized) return false;

  const hasEmbeddedQueryExpansion = query.expanded === query.normalized && query.expandedCompact !== query.compact;
  if (!hasEmbeddedQueryExpansion && candidate.expanded.includes(query.expanded)) return true;

  const candidateTokens = new Set(candidate.tokens);
  if (query.tokens.length > 0 && query.tokens.every((token) => candidateTokens.has(token))) {
    return true;
  }

  if (query.expandedCompact && candidate.expandedCompact.includes(query.expandedCompact)) {
    return true;
  }

  const queryCompactWasExpanded = query.expandedCompact !== query.compact;
  return !queryCompactWasExpanded && Boolean(query.compact) && candidate.compact.includes(query.compact);
}

export function matchesPreparedSearchCode(candidateValue: string | undefined, codeQuery: string) {
  if (!codeQuery) return true;
  const candidate = normalizeSearchCode(candidateValue);
  return Boolean(candidate) && candidate.includes(codeQuery);
}

export function matchesPreparedSearchFields(fields: SearchFields, query: PreparedSearchQuery) {
  if (!query.text.normalized && !query.code) return true;

  if ((fields.codes ?? []).some((value) => matchesPreparedSearchCode(value ?? undefined, query.code))) {
    return true;
  }

  return (fields.text ?? []).some((value) => matchesPreparedSearchText(value ?? '', query.text));
}

export function matchesSearchFields(fields: SearchFields, query: string, aliases?: SearchAliases) {
  return matchesPreparedSearchFields(fields, prepareSharedSearchQuery(query, aliases));
}

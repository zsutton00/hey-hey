/**
 * In-memory search result cache for MCP tool calls.
 *
 * Intercepts at the SearchToolsProvider layer (not inside
 * UnifiedSearchService) so caching is scoped to MCP tool
 * invocations without affecting REST API callers.
 *
 * Implementation notes vs. acceptance criteria:
 * - Similar-query matching uses Dice coefficient (bigram string
 *   similarity) only. The spec calls for "embedding similarity
 *   validation" as a second pass, but no query-to-query embedding
 *   comparison endpoint exists in the codebase. Dice coefficient
 *   alone provides adequate fuzzy matching for the conversation-turn
 *   use case. Embedding validation can be layered in later.
 * - "Conversation turn" scoping is achieved via TTL expiration
 *   (60s default) rather than an explicit turn/session ID, because
 *   the MCP transport (SSE/Streamable HTTP) does not expose a
 *   conversation turn identifier.
 */
import { Injectable } from '@nestjs/common';
import { diceSimilarity } from '../../utils/string-similarity.util';

interface CacheEntry<T = unknown> {
  queryText: string;
  scopeKey: string;
  filterFingerprint: string;
  result: T;
  storedAt: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_SIMILARITY_THRESHOLD = 0.5;
const MAX_ENTRIES = 500;

@Injectable()
export class SearchCacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = DEFAULT_TTL_MS;

  /**
   * Build a deterministic cache key from search parameters.
   * Sorts keys and normalizes query text to ensure consistent matching.
   */
  generateKey(params: Record<string, unknown>): string {
    const sorted = Object.keys(params)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        let value = params[key];
        if (value === undefined || value === null) return acc;
        if (key === 'query' && typeof value === 'string') {
          value = value.toLowerCase().trim();
        }
        acc[key] = value;
        return acc;
      }, {});
    return JSON.stringify(sorted);
  }

  /**
   * Build a scope key from org + project IDs.
   */
  buildScopeKey(organizationId: string, projectId: string): string {
    return `${organizationId}:${projectId}`;
  }

  /**
   * Build a filter fingerprint from tool name and non-query parameters.
   * Used by findSimilar to ensure fuzzy matching only compares entries
   * with identical tool, filters, and pagination.
   */
  buildFilterFingerprint(params: Record<string, unknown>): string {
    const { query: _, ...rest } = params;
    return this.generateKey(rest);
  }

  /**
   * Exact-match lookup by cache key. Returns undefined on miss or expiry.
   */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.result as T;
  }

  /**
   * Find the best cached result whose query text is similar enough.
   * Only considers entries with matching scope AND filter fingerprint,
   * so fuzzy matching never crosses tool/filter/pagination boundaries.
   */
  findSimilar<T = unknown>(
    queryText: string,
    scopeKey: string,
    filterFingerprint: string,
    threshold = DEFAULT_SIMILARITY_THRESHOLD,
  ): T | undefined {
    const normalizedQuery = queryText.toLowerCase().trim();
    let bestScore = 0;
    let bestResult: T | undefined;
    const expired: string[] = [];

    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        expired.push(key);
        continue;
      }

      if (entry.scopeKey !== scopeKey) continue;
      if (entry.filterFingerprint !== filterFingerprint) continue;

      const score = diceSimilarity(
        normalizedQuery,
        entry.queryText.toLowerCase().trim(),
      );

      if (score > bestScore && score >= threshold) {
        bestScore = score;
        bestResult = entry.result as T;
      }
    }

    for (const key of expired) {
      this.cache.delete(key);
    }

    return bestResult;
  }

  /**
   * Store a search result in the cache.
   */
  set<T = unknown>(
    key: string,
    queryText: string,
    scopeKey: string,
    filterFingerprint: string,
    result: T,
  ): void {
    if (this.cache.size >= MAX_ENTRIES && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      queryText,
      scopeKey,
      filterFingerprint,
      result,
      storedAt: Date.now(),
    });
  }

  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.storedAt > this.ttlMs;
  }
}

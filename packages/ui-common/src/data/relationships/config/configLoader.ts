import type {
  EntityOperation,
  InvalidationConfig,
  InvalidationRule,
  QueryKeyPattern,
} from "./types";
import { validateConfig } from "./validation";

type RuleIndex = Map<string, InvalidationRule[]>;

interface LoaderState {
  config: InvalidationConfig;
  index: RuleIndex;
}

let state: LoaderState | null = null;
let lastInitSignature: string | null = null;

function buildIndex(rules: InvalidationRule[]): RuleIndex {
  const index: RuleIndex = new Map();
  for (const rule of rules) {
    const existing = index.get(rule.sourceEntity) ?? [];
    existing.push(rule);
    index.set(rule.sourceEntity, existing);
  }
  return index;
}

function toQueryKeyPatterns(rules: InvalidationRule[]): QueryKeyPattern[] {
  const patterns: QueryKeyPattern[] = [];
  for (const rule of rules) {
    for (const collection of rule.targetCollections) {
      patterns.push({
        collection,
        invalidationMode: rule.invalidationMode,
        relationshipPath: rule.relationshipPath,
        lookupField: rule.lookupField,
        cardinality: rule.cardinality,
        sourceFields: rule.sourceFields,
        dataVariantKey: rule.dataVariantKey,
      });
    }
  }
  return patterns;
}

export function loadConfig(raw: unknown): void {
  const config = validateConfig(raw);
  state = { config, index: buildIndex(config.rules) };
}

/**
 * Boot-time entry point for non-React consumers (CLI bootstraps) and the
 * `DataHooksProvider` `relationshipRules` prop. Wraps `loadConfig` with
 * idempotency: calling it twice with the same payload is a no-op, while a
 * second call with a conflicting payload throws so misconfigured boots fail
 * loudly instead of silently swapping the rule set under live consumers.
 */
export function initRelationshipConfig(raw: unknown): void {
  const signature = JSON.stringify(raw);
  if (state !== null) {
    if (lastInitSignature !== null && lastInitSignature === signature) {
      return;
    }
    throw new Error(
      "initRelationshipConfig was called twice with conflicting payloads. " +
        "Call resetConfig() before re-initializing with a different payload."
    );
  }
  loadConfig(raw);
  lastInitSignature = signature;
}

// operation is accepted for forward compatibility with operation-scoped rules
export function getRelatedEntities(
  entityType: string,
  _operation: EntityOperation
): QueryKeyPattern[] {
  if (!state) {
    throw new Error(
      "Invalidation config has not been loaded. Call loadConfig() first."
    );
  }

  const rules = state.index.get(entityType);
  if (!rules) {
    return [];
  }

  return toQueryKeyPatterns(rules);
}

export function getLoadedConfig(): Readonly<InvalidationConfig> | null {
  return state?.config ?? null;
}

export function resetConfig(): void {
  state = null;
  lastInitSignature = null;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    resetConfig();
  });
}

import type { InvalidationConfig, InvalidationRule } from "./types";

const VALID_CARDINALITIES = new Set(["1:1", "1:many"]);
const VALID_INVALIDATION_MODES = new Set(["cascade", "invalidate"]);
const KNOWN_RULE_KEYS = new Set([
  "sourceEntity",
  "sourceFields",
  "targetCollections",
  "relationshipPath",
  "cardinality",
  "lookupField",
  "invalidationMode",
  "dataVariantKey",
]);

function validateRule(rule: unknown, index: number): InvalidationRule {
  if (typeof rule !== "object" || rule === null) {
    throw new Error(`Rule at index ${index} is not an object`);
  }

  const r = rule as Record<string, unknown>;

  requireString(r, "sourceEntity", index);
  requireStringArray(r, "sourceFields", index);
  requireStringArray(r, "targetCollections", index);
  requireString(r, "relationshipPath", index);
  requireString(r, "lookupField", index);

  if (!VALID_CARDINALITIES.has(r.cardinality as string)) {
    throw new Error(
      `Rule at index ${index}: cardinality must be "1:1" or "1:many", got "${String(
        r.cardinality
      )}"`
    );
  }

  if (!VALID_INVALIDATION_MODES.has(r.invalidationMode as string)) {
    throw new Error(
      `Rule at index ${index}: invalidationMode must be "cascade" or "invalidate", got "${String(
        r.invalidationMode
      )}"`
    );
  }

  if (r.dataVariantKey !== undefined) {
    validateDataVariantKey(r.dataVariantKey, index);
  }

  const unknownKeys = Object.keys(r).filter((k) => !KNOWN_RULE_KEYS.has(k));
  if (unknownKeys.length > 0) {
    throw new Error(
      `Rule at index ${index}: unknown keys: ${unknownKeys.join(", ")}`
    );
  }

  return rule as InvalidationRule;
}

function requireString(
  obj: Record<string, unknown>,
  field: string,
  index: number
): void {
  if (typeof obj[field] !== "string" || (obj[field] as string).length === 0) {
    throw new Error(
      `Rule at index ${index}: ${field} must be a non-empty string`
    );
  }
}

function requireStringArray(
  obj: Record<string, unknown>,
  field: string,
  index: number
): void {
  const val = obj[field];
  if (!Array.isArray(val) || val.length === 0) {
    throw new Error(
      `Rule at index ${index}: ${field} must be a non-empty array of strings`
    );
  }
  for (let i = 0; i < val.length; i++) {
    if (typeof val[i] !== "string" || (val[i] as string).length === 0) {
      throw new Error(
        `Rule at index ${index}: ${field}[${i}] must be a non-empty string`
      );
    }
  }
}

function validateDataVariantKey(value: unknown, index: number): void {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Rule at index ${index}: dataVariantKey must be an object`);
  }
  const dvk = value as Record<string, unknown>;
  if (typeof dvk.queryParam !== "string" || dvk.queryParam.length === 0) {
    throw new Error(
      `Rule at index ${index}: dataVariantKey.queryParam must be a non-empty string`
    );
  }
  if (
    dvk.requiredValue !== undefined &&
    typeof dvk.requiredValue !== "string"
  ) {
    throw new Error(
      `Rule at index ${index}: dataVariantKey.requiredValue must be a string if provided`
    );
  }
}

export function validateConfig(raw: unknown): InvalidationConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalidation config must be an object");
  }

  const config = raw as Record<string, unknown>;

  if (typeof config.version !== "string") {
    throw new Error("Invalidation config must have a string 'version' field");
  }

  if (typeof config.generatedAt !== "string") {
    throw new Error(
      "Invalidation config must have a string 'generatedAt' field"
    );
  }

  if (!Array.isArray(config.rules)) {
    throw new Error("Invalidation config must have a 'rules' array");
  }

  const rules = config.rules.map((rule, i) => validateRule(rule, i));

  return {
    version: config.version as string,
    generatedAt: config.generatedAt as string,
    rules,
  };
}

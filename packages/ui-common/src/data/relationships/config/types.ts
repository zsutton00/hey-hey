export type Cardinality = "1:1" | "1:many";
export type InvalidationMode = "cascade" | "invalidate";
export type EntityOperation = "create" | "update" | "delete";

export interface DataVariantKey {
  queryParam: string;
  requiredValue?: string;
}

export interface InvalidationRule {
  sourceEntity: string;
  sourceFields: string[];
  targetCollections: string[];
  relationshipPath: string;
  cardinality: Cardinality;
  lookupField: string;
  invalidationMode: InvalidationMode;
  dataVariantKey?: DataVariantKey;
}

export interface QueryKeyPattern {
  collection: string;
  invalidationMode: InvalidationMode;
  relationshipPath: string;
  lookupField: string;
  cardinality: Cardinality;
  sourceFields: string[];
  dataVariantKey?: DataVariantKey;
}

export interface InvalidationConfig {
  version: string;
  generatedAt: string;
  rules: InvalidationRule[];
}

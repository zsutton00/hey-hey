export {
  loadConfig,
  initRelationshipConfig,
  getRelatedEntities,
  getLoadedConfig,
  resetConfig,
} from "./configLoader";
export { setupHotReload } from "./hotReload";
export { validateConfig } from "./validation";
export type {
  InvalidationRule,
  InvalidationConfig,
  QueryKeyPattern,
  EntityOperation,
  Cardinality,
  InvalidationMode,
  DataVariantKey,
} from "./types";

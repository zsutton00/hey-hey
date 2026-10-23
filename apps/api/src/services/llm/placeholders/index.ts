// Base types and interfaces
export type * from './base/placeholder-types';

// Core classes
export { PlaceholderDefinition } from './base/placeholder-definition';
export { PlaceholderRegistry } from './base/placeholder-registry';
export {
  PlaceholderContextBuilder,
  PlaceholderContextUtils,
} from './base/placeholder-context';

// Services
export { PlaceholderResolver } from './resolver.service';

// Registries
export { StandardPlaceholderRegistry } from './registries/standard-placeholders.registry';
export { InitiativeRefinementPlaceholderRegistry } from './registries/initiative-refinement-placeholders.registry';

// Template helpers
export * from './template-helpers';

// Convenience exports for template migration (Phase 5)
export { StandardPlaceholderRegistry as StandardPlaceholders } from './registries/standard-placeholders.registry';
export { InitiativeRefinementPlaceholderRegistry as InitiativeRefinementPlaceholders } from './registries/initiative-refinement-placeholders.registry';

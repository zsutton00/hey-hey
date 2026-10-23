// Backward-compat shim. Use FeatureSelector for new code.
// The onChange second argument type has changed from InitiativeResponseDto to
// TaskResponseDto since features are now tasks. External consumers using the
// second argument should migrate to FeatureSelector.
export { FeatureSelector as InitiativeSelector } from "./FeatureSelector";
export type { FeatureSelectorProps as InitiativeSelectorProps } from "./FeatureSelector";

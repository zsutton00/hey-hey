import { SecondaryActionConfig } from 'src/generated';

/**
 * Context for filtering which secondary actions are relevant
 * at a given interaction point in the coding session.
 */
export type SecondaryActionContext = {
  /** The UI element identifier where actions will be rendered. */
  uiElement?: string;
  /** The action type to filter by. */
  actionType?: string;
};

/**
 * A secondary action with its associated context metadata.
 * Wraps SecondaryActionConfig with the context keys it applies to,
 * enabling filtering without coupling the generated type.
 */
export type SecondaryActionDefinition = {
  action: SecondaryActionConfig;
  /** UI elements this action is relevant for. Empty excludes it when filtering by uiElement. */
  uiElements: string[];
  /** Action types this action is relevant for. Empty excludes it when filtering by actionType. */
  actionTypes: string[];
};

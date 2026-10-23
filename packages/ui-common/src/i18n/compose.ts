/**
 * I18n composition utilities for building dynamic, terminology-aware strings
 *
 * This module provides functions to compose i18n strings using templates
 * and terminology tokens, enabling easy terminology changes across the app.
 *
 * Usage:
 * - Use compose() to build strings from templates with terminology tokens
 * - Use composeWithData() to include additional interpolation data
 * - Templates can include {{term.initiative}}, {{term.Initiative}}, etc.
 */

import { TERMS, capitalize, titleCase } from "./terminology";

// Template token patterns for terminology
const TERM_TOKEN_PATTERN = /\{\{term\.(\w+)\}\}/g;

// Interface for additional interpolation data
export interface CompositionData {
  [key: string]: string | number | boolean | undefined;
}

// Interface for composition options
export interface ComposeOptions {
  capitalize?: boolean;
  titleCase?: boolean;
}

/**
 * Compose a template string with terminology and optional data
 *
 * @param template - Template string with {{term.xxx}} tokens
 * @param data - Additional interpolation data
 * @param options - Composition options
 * @returns Composed string with terminology and data interpolated
 */
export const compose = (
  template: string,
  data: CompositionData = {},
  options: ComposeOptions = {}
): string => {
  let result = template;

  // Replace terminology tokens
  result = result.replace(TERM_TOKEN_PATTERN, (match, termKey) => {
    const termValue = getTermValue(termKey);
    if (termValue) {
      return termValue;
    }
    console.warn(`Unknown term key: ${termKey}`);
    return match; // Return original token if term not found
  });

  // Replace additional data tokens using simple interpolation
  for (const [key, value] of Object.entries(data)) {
    const tokenPattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(tokenPattern, String(value ?? ""));
  }

  // Apply text transformations
  if (options.capitalize) {
    result = capitalize(result);
  } else if (options.titleCase) {
    result = titleCase(result);
  }

  return result;
};

/**
 * Get terminology value by key from TERMS object
 */
const getTermValue = (key: string): string | undefined => {
  // Use type assertion to access dynamic properties
  const terms = TERMS as Record<string, string>;
  return terms[key];
};

/**
 * Compose with automatic capitalization for sentence starts
 */
export const composeCapitalized = (
  template: string,
  data: CompositionData = {}
): string => {
  return compose(template, data, { capitalize: true });
};

/**
 * Compose with title case for headings
 */
export const composeTitleCase = (
  template: string,
  data: CompositionData = {}
): string => {
  return compose(template, data, { titleCase: true });
};

/**
 * Common composition patterns for frequent use cases
 */
export const patterns = {
  // Entity creation patterns
  createEntity: (entity: string): string =>
    compose(`{{term.Create}} {{term.${entity}}}`),

  newEntity: (entity: string): string =>
    compose(`New {{term.${capitalize(entity)}}}`),

  editEntity: (entity: string): string =>
    compose(`{{term.Edit}} {{term.${capitalize(entity)}}}`),

  deleteEntity: (entity: string): string =>
    compose(`{{term.Delete}} {{term.${capitalize(entity)}}}`),

  // Listing patterns
  noEntitiesFound: (entity: string): string =>
    compose(`No {{term.${entity}}} found`),

  createFirstEntity: (entity: string): string =>
    compose(`{{term.Create}} your first {{term.${entity}}} to get started`),

  totalCount: (entity: string): string =>
    compose(`Total: {{count}} {{term.${entity}}}`, undefined, {
      titleCase: false,
    }),

  // Loading patterns
  loadingEntity: (entity: string): string =>
    compose(`Loading {{term.${entity}}}...`),

  creatingEntity: (entity: string): string =>
    compose(`{{term.Create|title}} {{term.${entity}}}...`),

  // Form patterns
  entityName: (entity: string): string =>
    compose(`{{term.${capitalize(entity)}}} Name`),

  enterEntityName: (entity: string): string =>
    compose(`Enter {{term.${entity}}} name...`),

  describeEntity: (entity: string): string =>
    compose(`Describe what this {{term.${entity}}} aims to achieve...`),

  // Validation patterns
  entityNameRequired: (entity: string): string =>
    compose(`{{term.${capitalize(entity)}}} name is required`),

  entityNameTooShort: (entity: string, minLength: number = 3): string =>
    compose(
      `{{term.${capitalize(entity)}}} name must be at least {{min}} characters`,
      { min: minLength }
    ),

  entityNameTooLong: (entity: string, maxLength: number = 100): string =>
    compose(
      `{{term.${capitalize(
        entity
      )}}} name must be less than {{max}} characters`,
      { max: maxLength }
    ),
};

/**
 * Template builder for creating reusable templates with terminology tokens
 */
export class TemplateBuilder {
  private template = "";

  constructor(initialTemplate = "") {
    this.template = initialTemplate;
  }

  /**
   * Add a terminology token to the template
   */
  addTerm(termKey: string): this {
    this.template += `{{term.${termKey}}}`;
    return this;
  }

  /**
   * Add literal text to the template
   */
  addText(text: string): this {
    this.template += text;
    return this;
  }

  /**
   * Add a data token to the template
   */
  addData(key: string): this {
    this.template += `{{${key}}}`;
    return this;
  }

  /**
   * Build and compose the template
   */
  compose(data: CompositionData = {}, options: ComposeOptions = {}): string {
    return compose(this.template, data, options);
  }

  /**
   * Get the raw template string
   */
  getTemplate(): string {
    return this.template;
  }

  /**
   * Reset the template
   */
  reset(): this {
    this.template = "";
    return this;
  }
}

/**
 * Utility function to create a template builder
 */
export const template = (initialTemplate = ""): TemplateBuilder => {
  return new TemplateBuilder(initialTemplate);
};

/**
 * Pre-built template functions for common patterns
 */
export const templates = {
  // Action on entity templates
  actionEntity: (action: string, entity: string): string =>
    `{{term.${capitalize(action)}}} {{term.${capitalize(entity)}}}`,

  // Article + entity templates
  createAnEntity: (entity: string): string =>
    `{{term.Create}} {{term.an${capitalize(entity)}}}`,

  // Status messages
  entityStatus: (entity: string, _status: string): string =>
    `{{term.${capitalize(entity)}}} is {{status}}`,

  // Count messages
  entityCount: (entity: string): string => `{{count}} {{term.${entity}}}`,

  // Welcome/intro messages
  welcomeToEntity: (entity: string): string =>
    `Welcome to {{term.${capitalize(entity)}}} Editor`,

  // Progress messages
  updatingEntity: (entity: string): string => `Updating {{term.${entity}}}...`,

  savingEntity: (entity: string): string => `Saving {{term.${entity}}}...`,
};

import { errorToLoggable } from '../../../../utils/logging.util';
import type {
  PlaceholderContext,
  PlaceholderResolver,
} from './placeholder-types';

// Primitive types that can be safely converted to strings and cached
type PlaceholderValue = string | number | boolean;

/**
 * Definition of a single placeholder with its resolver logic
 *
 * @template T The return type of the placeholder resolver (constrained to primitives)
 */
export class PlaceholderDefinition<T extends PlaceholderValue = string> {
  constructor(
    public readonly key: string,
    public readonly description: string,
    public readonly resolver: PlaceholderResolver<T>,
    public readonly isContentBlock: boolean = false,
    public readonly requiredContextType?:
      | 'initiative'
      | 'onboarding'
      | 'design-doc'
      | 'any',
  ) {
    if (!key || typeof key !== 'string') {
      throw new Error('Placeholder key must be a non-empty string');
    }
    if (!description || typeof description !== 'string') {
      throw new Error('Placeholder description must be a non-empty string');
    }
    if (typeof resolver !== 'function') {
      throw new Error('Placeholder resolver must be a function');
    }
  }

  /**
   * Resolve this placeholder with the given context and optional options
   */
  async resolve(
    context: PlaceholderContext,
    options?: Record<string, unknown>,
  ): Promise<T> {
    try {
      const result = await this.resolver(context, options);
      return result;
    } catch (error) {
      throw new Error(
        `Failed to resolve placeholder '${this.key}': ${
          error instanceof Error ? error.message : errorToLoggable(error)
        }`,
      );
    }
  }

  /**
   * Check if this placeholder can be used with the given context
   */
  isCompatibleWith(context: PlaceholderContext): boolean {
    if (!this.requiredContextType || this.requiredContextType === 'any') {
      return true;
    }

    switch (this.requiredContextType) {
      case 'initiative':
        return 'initiativeId' in context.flowContext;
      case 'onboarding':
        return context.flowContext.flowId === 'onboarding';
      default:
        return true;
    }
  }

  /**
   * Get the template variable format for this placeholder
   */
  getTemplateVariable(): string {
    return `\${${this.key}}`;
  }

  /**
   * Insert this placeholder into a template with optional options
   */
  insert(
    options?: Record<string, string | boolean | number | string[]>,
  ): string {
    return `${this.getTemplateVariable()}${options ? `::${JSON.stringify(options)}` : ''}`;
  }

  /**
   * Get information about this placeholder for documentation
   */
  getInfo(): {
    key: string;
    description: string;
    isContentBlock: boolean;
    requiredContextType?: string;
    templateVariable: string;
  } {
    return {
      key: this.key,
      description: this.description,
      isContentBlock: this.isContentBlock,
      requiredContextType: this.requiredContextType,
      templateVariable: this.getTemplateVariable(),
    };
  }

  /**
   * Create a typed placeholder definition for simple string values
   */
  static create(
    key: string,
    description: string,
    resolver: PlaceholderResolver<string>,
  ): PlaceholderDefinition<string> {
    return new PlaceholderDefinition(key, description, resolver, false);
  }

  /**
   * Create a typed placeholder definition for content blocks
   */
  static createContentBlock(
    key: string,
    description: string,
    resolver: PlaceholderResolver<string>,
    requiredContextType?: 'initiative' | 'onboarding' | 'design-doc' | 'any',
  ): PlaceholderDefinition<string> {
    return new PlaceholderDefinition(
      key,
      description,
      resolver,
      true,
      requiredContextType,
    );
  }

  /**
   * Create a typed placeholder definition for numeric values
   */
  static createNumber(
    key: string,
    description: string,
    resolver: PlaceholderResolver<number>,
  ): PlaceholderDefinition<number> {
    return new PlaceholderDefinition(key, description, resolver, false);
  }

  /**
   * Create a typed placeholder definition for boolean values
   */
  static createBoolean(
    key: string,
    description: string,
    resolver: PlaceholderResolver<boolean>,
  ): PlaceholderDefinition<boolean> {
    return new PlaceholderDefinition(key, description, resolver, false);
  }
}

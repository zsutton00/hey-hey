import { PlaceholderDefinition } from './placeholder-definition';
import type {
  PlaceholderContext,
  ValidationResult,
  PlaceholderValue,
} from './placeholder-types';

/**
 * Registry that holds and manages placeholder definitions
 */
export class PlaceholderRegistry {
  private placeholders = new Map<
    string,
    PlaceholderDefinition<PlaceholderValue>
  >();
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Register a placeholder definition
   */
  register<T extends PlaceholderValue>(
    definition: PlaceholderDefinition<T>,
  ): this {
    if (this.placeholders.has(definition.key)) {
      throw new Error(
        `Placeholder '${definition.key}' is already registered in registry '${this.name}'`,
      );
    }
    this.placeholders.set(definition.key, definition);
    return this;
  }

  /**
   * Register multiple placeholder definitions
   */
  registerAll(definitions: PlaceholderDefinition<PlaceholderValue>[]): this {
    for (const definition of definitions) {
      this.register(definition);
    }
    return this;
  }

  /**
   * Get a placeholder definition by key
   */
  get<T extends PlaceholderValue = string>(
    key: string,
  ): PlaceholderDefinition<T> | undefined {
    return this.placeholders.get(key) as PlaceholderDefinition<T> | undefined;
  }

  /**
   * Check if a placeholder is registered
   */
  has(key: string): boolean {
    return this.placeholders.has(key);
  }

  /**
   * Get all registered placeholder keys
   */
  getKeys(): string[] {
    return Array.from(this.placeholders.keys()).sort();
  }

  /**
   * Get all placeholder definitions
   */
  getAll(): PlaceholderDefinition<PlaceholderValue>[] {
    return Array.from(this.placeholders.values());
  }

  /**
   * Get placeholders filtered by type
   */
  getContentBlocks(): PlaceholderDefinition<PlaceholderValue>[] {
    return Array.from(this.placeholders.values()).filter(
      (p) => p.isContentBlock,
    );
  }

  /**
   * Get simple value placeholders (non-content blocks)
   */
  getSimplePlaceholders(): PlaceholderDefinition<PlaceholderValue>[] {
    return Array.from(this.placeholders.values()).filter(
      (p) => !p.isContentBlock,
    );
  }

  /**
   * Find all placeholders used in a template
   */
  findUsedPlaceholders(template: string): {
    found: PlaceholderDefinition<PlaceholderValue>[];
    missing: string[];
    all: string[];
  } {
    // Match ${placeholder.key} format
    const placeholderPattern = /\$\{([^}]+)\}/g;
    const matches = Array.from(template.matchAll(placeholderPattern));
    const usedKeys = matches.map((match) => {
      const key = match[1];
      if (!key) {
        throw new Error('Placeholder match missing key');
      }
      return key;
    });
    const uniqueKeys = [...new Set(usedKeys)];

    const found: PlaceholderDefinition<PlaceholderValue>[] = [];
    const missing: string[] = [];

    for (const key of uniqueKeys) {
      const placeholder = this.get(key);
      if (placeholder) {
        found.push(placeholder);
      } else {
        missing.push(key);
      }
    }

    return { found, missing, all: uniqueKeys };
  }

  /**
   * Validate a template against this registry
   */
  validateTemplate(
    template: string,
    context?: PlaceholderContext,
  ): ValidationResult {
    const { found, missing, all } = this.findUsedPlaceholders(template);
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for missing placeholders
    if (missing.length > 0) {
      errors.push(
        `Unknown placeholders: ${missing.join(', ')}. Available: ${this.getKeys().join(', ')}`,
      );
    }

    // Check context compatibility if provided
    if (context) {
      for (const placeholder of found) {
        if (!placeholder.isCompatibleWith(context)) {
          warnings.push(
            `Placeholder '${placeholder.key}' may not be compatible with current context type`,
          );
        }
      }
    }

    // Check for empty template
    if (!template.trim()) {
      warnings.push('Template is empty');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      usedPlaceholders: all,
      missingPlaceholders: missing,
    };
  }

  /**
   * Get documentation for all placeholders in this registry
   */
  getDocumentation(): {
    name: string;
    totalCount: number;
    contentBlocks: number;
    simplePlaceholders: number;
    placeholders: Array<{
      key: string;
      description: string;
      isContentBlock: boolean;
      requiredContextType?: string;
      templateVariable: string;
    }>;
  } {
    const placeholders = this.getAll();
    return {
      name: this.name,
      totalCount: placeholders.length,
      contentBlocks: placeholders.filter((p) => p.isContentBlock).length,
      simplePlaceholders: placeholders.filter((p) => !p.isContentBlock).length,
      placeholders: placeholders
        .map((p) => p.getInfo())
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  /**
   * Create a new registry that extends this one
   */
  extend(name: string): PlaceholderRegistry {
    const extended = new PlaceholderRegistry(name);

    // Copy all placeholders from this registry
    for (const [key, placeholder] of this.placeholders) {
      extended.placeholders.set(key, placeholder);
    }

    return extended;
  }

  /**
   * Merge another registry into this one
   */
  merge(other: PlaceholderRegistry, overwrite: boolean = false): this {
    for (const [key, placeholder] of other.placeholders) {
      if (this.has(key) && !overwrite) {
        throw new Error(
          `Placeholder '${key}' already exists. Use overwrite=true to replace.`,
        );
      }
      this.placeholders.set(key, placeholder);
    }
    return this;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    name: string;
    totalPlaceholders: number;
    contentBlocks: number;
    simplePlaceholders: number;
    contextTypes: Record<string, number>;
  } {
    const placeholders = this.getAll();
    const contextTypes: Record<string, number> = {};

    for (const placeholder of placeholders) {
      const contextType = placeholder.requiredContextType || 'any';
      contextTypes[contextType] = (contextTypes[contextType] || 0) + 1;
    }

    return {
      name: this.name,
      totalPlaceholders: placeholders.length,
      contentBlocks: placeholders.filter((p) => p.isContentBlock).length,
      simplePlaceholders: placeholders.filter((p) => !p.isContentBlock).length,
      contextTypes,
    };
  }

  /**
   * Clear all placeholders
   */
  clear(): this {
    this.placeholders.clear();
    return this;
  }

  /**
   * Get the registry name
   */
  getName(): string {
    return this.name;
  }
}

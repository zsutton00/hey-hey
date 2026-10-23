import { Injectable, Logger } from '@nestjs/common';
import { PlaceholderRegistry } from './base/placeholder-registry';
import { PlaceholderDefinition } from './base/placeholder-definition';
import type {
  CacheEntry,
  PlaceholderContext,
  PlaceholderValue,
  ResolutionOptions,
  ValidationResult,
} from './base/placeholder-types';
import { errorToLoggable } from '../../../utils/logging.util';

/**
 * Service for resolving placeholders in templates
 */
@Injectable()
export class PlaceholderResolver {
  private readonly logger = new Logger(PlaceholderResolver.name);
  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Resolve all placeholders in a template
   */
  async resolve(
    template: string,
    registry: PlaceholderRegistry,
    context: PlaceholderContext,
    options: ResolutionOptions = {},
  ): Promise<string> {
    const {
      enableCaching = true,
      cacheTtl = 30000, // 30 seconds default
      throwOnMissing = true,
      defaultValue = '[PLACEHOLDER_ERROR]',
    } = options;

    this.logger.debug(
      `Resolving template with ${registry.getName()} registry`,
      {
        templateLength: template.length,
        enableCaching,
      },
    );

    // Validate template first
    const validation = registry.validateTemplate(template, context);
    if (!validation.isValid && throwOnMissing) {
      throw new Error(
        `Template validation failed: ${validation.errors.join(', ')}`,
      );
    }

    // Find all placeholders in template
    const { found, missing } = registry.findUsedPlaceholders(template);

    // Log validation warnings
    if (validation.warnings.length > 0) {
      this.logger.warn('Template validation warnings', {
        warnings: validation.warnings,
        registry: registry.getName(),
      });
    }

    // Log missing placeholders
    if (missing.length > 0) {
      this.logger.warn('Missing placeholders in template', {
        missing,
        available: registry.getKeys(),
        registry: registry.getName(),
      });
    }

    let result = template;

    // Resolve each placeholder
    for (const placeholder of found) {
      try {
        this.logger.debug('Attempting to resolve placholder', {
          placeholder,
        });

        // Find all template variables with options for this placeholder
        const basePattern = this.escapeRegex(placeholder.getTemplateVariable());
        const templateVarPattern = basePattern + '(?:::(\\{[^}]*\\}))?';
        const matches = result.match(new RegExp(templateVarPattern, 'g')) || [];

        // Process each match (some may have options, some may not)
        for (const match of matches) {
          const [_, optionsStr] = match.split('::');
          let options: Record<string, unknown> | undefined;

          if (optionsStr) {
            try {
              options = JSON.parse(optionsStr);
              this.logger.debug('Parsed placeholder options', {
                placeholder: placeholder.key,
                options,
              });
            } catch (error) {
              this.logger.warn('Failed to parse placeholder options', {
                placeholder: placeholder.key,
                optionsStr,
                error:
                  error instanceof Error
                    ? error.message
                    : errorToLoggable(error),
              });
            }
          }

          const value = await this.resolveSinglePlaceholder(
            placeholder,
            context,
            { enableCaching, cacheTtl },
            options,
          );

          // Replace this specific occurrence (with or without options)
          result = result.replace(match, String(value));
          this.logger.debug('Resolved placholder', {
            match,
            placeholder: placeholder.key,
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to resolve placeholder '${placeholder.key}'`,
          {
            error:
              error instanceof Error ? error.message : errorToLoggable(error),
            placeholder: placeholder.key,
            registry: registry.getName(),
          },
        );

        if (throwOnMissing) {
          throw error;
        } else {
          // Replace all occurrences of this placeholder with default value
          const basePattern = this.escapeRegex(
            placeholder.getTemplateVariable(),
          );
          const templateVarPattern = basePattern + '(?:::(\\{[^}]*\\}))?';
          result = result.replace(
            new RegExp(templateVarPattern, 'g'),
            defaultValue,
          );
        }
      }
    }

    // Handle missing placeholders
    if (missing.length > 0 && !throwOnMissing) {
      for (const missingKey of missing) {
        const templateVar = `\${${missingKey}}`;
        result = result.replace(
          new RegExp(this.escapeRegex(templateVar), 'g'),
          defaultValue,
        );
      }
    }

    this.logger.debug('Template resolution completed', {
      originalLength: template.length,
      resultLength: result.length,
      resolvedCount: found.length,
      missingCount: missing.length,
    });

    return result;
  }

  /**
   * Resolve a single placeholder
   */
  private async resolveSinglePlaceholder<T extends PlaceholderValue>(
    placeholder: PlaceholderDefinition<T>,
    context: PlaceholderContext,
    cacheOptions: { enableCaching: boolean; cacheTtl: number },
    placeholderOptions?: Record<string, unknown>,
  ): Promise<T> {
    // Include options in cache key if they exist
    const cacheKey = this.generateCacheKey(
      placeholder.key,
      context,
      placeholderOptions,
    );

    // Check cache first
    if (cacheOptions.enableCaching) {
      const cached = this.getFromCache<T>(cacheKey);
      if (cached !== undefined) {
        this.logger.debug(`Cache hit for placeholder '${placeholder.key}'`, {
          hasOptions: !!placeholderOptions,
        });
        return cached;
      }
    }

    // Check context compatibility
    if (!placeholder.isCompatibleWith(context)) {
      throw new Error(
        `Placeholder '${placeholder.key}' is not compatible with current context`,
      );
    }

    // Resolve the placeholder with options
    const startTime = Date.now();
    const value = await placeholder.resolve(context, placeholderOptions);
    const duration = Date.now() - startTime;

    this.logger.debug(`Resolved placeholder '${placeholder.key}'`, {
      duration,
      valueType: typeof value,
      valueLength: typeof value === 'string' ? value.length : undefined,
      hasOptions: !!placeholderOptions,
    });

    // Cache the result
    if (cacheOptions.enableCaching) {
      this.setCache(cacheKey, value, cacheOptions.cacheTtl);
    }

    return value;
  }

  /**
   * Validate a template without resolving it
   */
  validateTemplate(
    template: string,
    registry: PlaceholderRegistry,
    context?: PlaceholderContext,
  ): ValidationResult {
    return registry.validateTemplate(template, context);
  }

  /**
   * Preview what placeholders would be resolved in a template
   */
  preview(
    template: string,
    registry: PlaceholderRegistry,
  ): {
    placeholders: Array<{
      key: string;
      description: string;
      isContentBlock: boolean;
      templateVariable: string;
    }>;
    missing: string[];
    validation: ValidationResult;
  } {
    const { found, missing } = registry.findUsedPlaceholders(template);
    const validation = registry.validateTemplate(template);

    return {
      placeholders: found.map((p) => p.getInfo()),
      missing,
      validation,
    };
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Placeholder cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    hitRate: number;
    entries: Array<{ key: string; timestamp: number; ttl: number }>;
  } {
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      timestamp: entry.timestamp,
      ttl: entry.ttl,
    }));

    return {
      size: this.cache.size,
      hitRate: 0, // TODO: Track hit rate if needed
      entries,
    };
  }

  /**
   * Generate cache key from placeholder key, context, and options
   */
  private generateCacheKey(
    placeholderKey: string,
    context: PlaceholderContext,
    options?: Record<string, unknown>,
  ): string {
    // Create a stable key based on context that affects resolution
    const contextKey = [
      placeholderKey,
      context.flowContext.core.workflowId,
      context.flowContext.core.projectId,
      context.flowContext.core.organizationId,
      context.flowContext.core.conversationId,
      context.flowContext.core.session?.interactionCount || 0,
      // Include options in cache key if provided
      options ? JSON.stringify(options) : '',
    ].join('|');

    return contextKey;
  }

  /**
   * Get value from cache if not expired
   */
  private getFromCache<T extends PlaceholderValue>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Set value in cache
   */
  private setCache<T extends PlaceholderValue>(
    key: string,
    value: T,
    ttl: number,
  ): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl,
    });

    // Simple cleanup: remove expired entries if cache gets large
    if (this.cache.size > 1000) {
      this.cleanupExpiredEntries();
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    if (keysToDelete.length > 0) {
      this.logger.debug(
        `Cleaned up ${keysToDelete.length} expired cache entries`,
      );
    }
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

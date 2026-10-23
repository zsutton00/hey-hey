/**
 * URL Alias Service
 *
 * Handles URL redirects and aliases during the transition to the unified
 * staged content framework. Provides backward compatibility for existing API consumers.
 */

import { Injectable, Logger } from '@nestjs/common';

interface UrlMapping {
  pattern: string;
  replacement: string;
  description: string;
  contentType?: string;
  deprecated?: boolean;
}

@Injectable()
export class UrlAliasService {
  private readonly logger = new Logger(UrlAliasService.name);

  // URL mappings for backward compatibility
  private readonly urlMappings: UrlMapping[] = [
    // Work Item Refinement Controller mappings
    {
      pattern:
        '/api/v1/organizations/:orgId/projects/:projectId/work-items/initiative/:entityId/refinement',
      replacement:
        '/api/v1/organizations/:orgId/projects/:projectId/staged-content/initiative/:entityId',
      description: 'Initiative refinement endpoint',
      contentType: 'initiative',
      deprecated: false,
    },
    {
      pattern:
        '/api/v1/organizations/:orgId/projects/:projectId/work-items/task/:entityId/refinement',
      replacement:
        '/api/v1/organizations/:orgId/projects/:projectId/staged-content/work-item/:entityId',
      description: 'Task refinement endpoint',
      contentType: 'work-item',
      deprecated: false,
    },
    // Initiative Refinement Controller mappings
    {
      pattern:
        '/api/v1/organizations/:orgId/projects/:projectId/initiative-refinement/:entityId',
      replacement:
        '/api/v1/organizations/:orgId/projects/:projectId/staged-content/initiative/:entityId',
      description: 'Legacy initiative refinement endpoint',
      contentType: 'initiative',
      deprecated: true,
    },
    // Task Refinement Controller mappings (if they exist)
    {
      pattern:
        '/api/v1/organizations/:orgId/projects/:projectId/task-refinement/:entityId',
      replacement:
        '/api/v1/organizations/:orgId/projects/:projectId/staged-content/work-item/:entityId',
      description: 'Legacy task refinement endpoint',
      contentType: 'work-item',
      deprecated: true,
    },
  ];

  /**
   * Resolve URL alias to new staged content URL
   * @param originalUrl - The original URL to resolve
   * @returns The mapped URL or the original URL if no mapping exists
   */
  resolveAlias(originalUrl: string): string {
    this.logger.debug(`Resolving URL alias for: ${originalUrl}`);

    for (const mapping of this.urlMappings) {
      const resolvedUrl = this.tryMapUrl(originalUrl, mapping);
      if (resolvedUrl !== originalUrl) {
        this.logger.log(`URL mapped: ${originalUrl} -> ${resolvedUrl}`, {
          mapping: mapping.description,
          contentType: mapping.contentType,
          deprecated: mapping.deprecated,
        });
        return resolvedUrl;
      }
    }

    this.logger.debug(`No URL mapping found for: ${originalUrl}`);
    return originalUrl;
  }

  /**
   * Get mapping information for a URL
   * @param url - The URL to get mapping info for
   * @returns Mapping information or null if no mapping exists
   */
  getMappingInfo(url: string): {
    isAliased: boolean;
    mapping?: UrlMapping;
    newUrl?: string;
  } {
    for (const mapping of this.urlMappings) {
      const resolvedUrl = this.tryMapUrl(url, mapping);
      if (resolvedUrl !== url) {
        return {
          isAliased: true,
          mapping,
          newUrl: resolvedUrl,
        };
      }
    }

    return { isAliased: false };
  }

  /**
   * Check if a URL pattern matches and should be redirected
   * @param url - The URL to check
   * @returns True if the URL has a mapping
   */
  hasMapping(url: string): boolean {
    return this.getMappingInfo(url).isAliased;
  }

  /**
   * Get all deprecated URL patterns
   * @returns Array of deprecated URL mappings
   */
  getDeprecatedMappings(): UrlMapping[] {
    return this.urlMappings.filter((mapping) => mapping.deprecated);
  }

  /**
   * Get all URL mappings for a specific content type
   * @param contentType - The content type to filter by
   * @returns Array of URL mappings for the content type
   */
  getMappingsForContentType(contentType: string): UrlMapping[] {
    return this.urlMappings.filter(
      (mapping) => mapping.contentType === contentType,
    );
  }

  /**
   * Add a new URL mapping (for dynamic registration)
   * @param mapping - The URL mapping to add
   */
  addMapping(mapping: UrlMapping): void {
    this.urlMappings.push(mapping);
    this.logger.log(
      `Added URL mapping: ${mapping.pattern} -> ${mapping.replacement}`,
      {
        description: mapping.description,
        contentType: mapping.contentType,
        deprecated: mapping.deprecated,
      },
    );
  }

  /**
   * Remove a URL mapping
   * @param pattern - The pattern of the mapping to remove
   * @returns True if a mapping was removed
   */
  removeMapping(pattern: string): boolean {
    const index = this.urlMappings.findIndex(
      (mapping) => mapping.pattern === pattern,
    );
    if (index !== -1) {
      const [removed] = this.urlMappings.splice(index, 1);
      if (removed) {
        this.logger.log(`Removed URL mapping: ${pattern}`, {
          description: removed.description,
        });
      }
      return true;
    }
    return false;
  }

  /**
   * Extract path parameters from a URL using a pattern
   * @param url - The URL to extract parameters from
   * @param pattern - The pattern with parameter placeholders
   * @returns Object containing extracted parameters
   */
  extractPathParameters(url: string, pattern: string): Record<string, string> {
    const parameters: Record<string, string> = {};

    // Convert pattern to regex
    const patternRegex = pattern.replace(/:([^/]+)/g, '([^/]+)');
    const regex = new RegExp(`^${patternRegex}$`);

    // Extract parameter names
    const paramNames = (pattern.match(/:([^/]+)/g) || []).map((param) =>
      param.substring(1),
    );

    // Match against URL
    const match = url.match(regex);
    if (match) {
      for (let i = 0; i < paramNames.length; i++) {
        const paramName = paramNames[i];
        const paramValue = match[i + 1];
        if (paramName && paramValue !== undefined) {
          parameters[paramName] = paramValue;
        }
      }
    }

    return parameters;
  }

  /**
   * Try to map a URL using a specific mapping
   * @param url - The URL to map
   * @param mapping - The mapping to apply
   * @returns The mapped URL or the original URL if no match
   */
  private tryMapUrl(url: string, mapping: UrlMapping): string {
    // Check if the URL matches the pattern
    if (!this.matchesPattern(url, mapping.pattern)) {
      return url;
    }

    // Extract parameters from the original URL
    const parameters = this.extractPathParameters(url, mapping.pattern);

    // Replace parameters in the replacement pattern
    let mappedUrl = mapping.replacement;
    for (const [key, value] of Object.entries(parameters)) {
      mappedUrl = mappedUrl.replace(`:${key}`, value);
    }

    return mappedUrl;
  }

  /**
   * Check if a URL matches a pattern
   * @param url - The URL to check
   * @param pattern - The pattern to match against
   * @returns True if the URL matches the pattern
   */
  private matchesPattern(url: string, pattern: string): boolean {
    // Convert pattern to regex
    const patternRegex = pattern.replace(/:([^/]+)/g, '([^/]+)');
    const regex = new RegExp(`^${patternRegex}$`);
    return regex.test(url);
  }

  /**
   * Get statistics about URL mappings
   * @returns Object containing mapping statistics
   */
  getStatistics(): {
    totalMappings: number;
    deprecatedMappings: number;
    byContentType: Record<string, number>;
  } {
    const stats = {
      totalMappings: this.urlMappings.length,
      deprecatedMappings: this.urlMappings.filter((m) => m.deprecated).length,
      byContentType: {} as Record<string, number>,
    };

    // Count by content type
    for (const mapping of this.urlMappings) {
      if (mapping.contentType) {
        stats.byContentType[mapping.contentType] =
          (stats.byContentType[mapping.contentType] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * Validate all URL mappings for correctness
   * @returns Array of validation errors
   */
  validateMappings(): string[] {
    const errors: string[] = [];

    for (const mapping of this.urlMappings) {
      // Check that pattern and replacement have the same parameters
      const patternParams = (mapping.pattern.match(/:([^/]+)/g) || []).map(
        (p) => p.substring(1),
      );
      const replacementParams = (
        mapping.replacement.match(/:([^/]+)/g) || []
      ).map((p) => p.substring(1));

      const missingParams = patternParams.filter(
        (p) => !replacementParams.includes(p),
      );
      const extraParams = replacementParams.filter(
        (p) => !patternParams.includes(p),
      );

      if (missingParams.length > 0) {
        errors.push(
          `Mapping "${mapping.pattern}" missing parameters in replacement: ${missingParams.join(', ')}`,
        );
      }

      if (extraParams.length > 0) {
        errors.push(
          `Mapping "${mapping.pattern}" has extra parameters in replacement: ${extraParams.join(', ')}`,
        );
      }

      // Check for valid URL format
      if (
        !mapping.pattern.startsWith('/') ||
        !mapping.replacement.startsWith('/')
      ) {
        errors.push(`Mapping "${mapping.pattern}" URLs must start with /`);
      }
    }

    return errors;
  }
}

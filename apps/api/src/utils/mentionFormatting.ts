/**
 * Mention Formatting Utilities
 *
 * This module provides utilities for formatting and parsing mention tokens.
 * Mention tokens have the format: @[entityType:entityId|entityName]
 *
 * Example: @[initiative:abc-123|Project Alpha]
 *
 * These utilities are used by both frontend and backend to ensure consistent
 * mention formatting across the system.
 */

export interface EntityMention {
  entityType: string;
  entityId: string;
  entityName: string;
}

/**
 * Regex pattern for matching mention tokens in text
 * Format: @[type:id|name]
 * - type: lowercase letters, underscores, hyphens (e.g., "initiative", "design_doc")
 * - id: lowercase letters, numbers, underscores, hyphens (e.g., "abc-123")
 * - name: any text except closing bracket (e.g., "Project Alpha")
 */
export const MENTION_TOKEN_REGEX =
  /@\\*\[([a-z_-]+):([a-z0-9_-]+)\|([^\]]+)\]/g;
export const MENTION_TOKEN_SINGLE_REGEX =
  /@\\*\[([a-z_-]+):([a-z0-9_-]+)\|([^\]]+)\]/;

/**
 * Format an EntityMention object into a mention token string
 * @param mention The mention object to format
 * @returns The formatted mention token string
 * @example
 * formatMention({ entityType: 'initiative', entityId: 'abc-123', entityName: 'Project Alpha' })
 * // Returns: '@[initiative:abc-123|Project Alpha]'
 */
export function formatMention(mention: EntityMention): string {
  return `@[${mention.entityType}:${mention.entityId}|${mention.entityName}]`;
}

/**
 * Parse a mention token string into an EntityMention object
 * @param token The mention token string to parse
 * @returns The parsed mention object, or null if the token is invalid
 * @example
 * parseMention('@[initiative:abc-123|Project Alpha]')
 * // Returns: { entityType: 'initiative', entityId: 'abc-123', entityName: 'Project Alpha' }
 */
export function parseMention(token: string): EntityMention | null {
  const match = token.match(MENTION_TOKEN_SINGLE_REGEX);
  if (!match) return null;
  const [, entityType, entityId, entityName] = match;
  if (!entityType || !entityId || !entityName) {
    return null;
  }

  return {
    entityType,
    entityId,
    entityName,
  };
}

/**
 * Extract all mention tokens from content text
 * @param content The content text to parse
 * @returns An array of EntityMention objects found in the content
 * @example
 * extractMentions('Check @[task:123|Task A] and @[initiative:abc|Project]')
 * // Returns: [
 * //   { entityType: 'task', entityId: '123', entityName: 'Task A' },
 * //   { entityType: 'initiative', entityId: 'abc', entityName: 'Project' }
 * // ]
 */
export function extractMentions(content: string): EntityMention[] {
  const mentions: EntityMention[] = [];
  const matches = content.matchAll(MENTION_TOKEN_REGEX);

  for (const match of matches) {
    const [, entityType, entityId, entityName] = match;
    if (!entityType || !entityId || !entityName) {
      continue;
    }
    mentions.push({
      entityType,
      entityId,
      entityName,
    });
  }

  return mentions;
}

/**
 * Remove all mention tokens from content, leaving only plain text
 * @param content The content text to clean
 * @returns The content with all mention tokens removed
 * @example
 * stripMentions('Check @[task:123|Task A] out')
 * // Returns: 'Check  out'
 */
export function stripMentions(content: string): string {
  return content.replace(MENTION_TOKEN_REGEX, '');
}

/**
 * Replace a single mention token with its display text
 * @param mention The mention object to render
 * @returns The display text for the mention (e.g., '@Task A')
 * @example
 * renderMentionText({ entityType: 'task', entityId: '123', entityName: 'Task A' })
 * // Returns: '@Task A'
 */
export function renderMentionText(mention: EntityMention): string {
  return `@${mention.entityName}`;
}

/**
 * Replace all mention tokens in content with their display text
 * @param content The content text to render
 * @returns The content with all mention tokens replaced with display text
 * @example
 * renderMentionsAsText('Check @[task:123|Task A] out')
 * // Returns: 'Check @Task A out'
 */
export function renderMentionsAsText(content: string): string {
  return content.replace(MENTION_TOKEN_REGEX, (token) => {
    const mention = parseMention(token);
    return mention ? renderMentionText(mention) : token;
  });
}

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

export interface EntityMentionType {
  entityType: string;
  entityId: string;
  entityName: string;
}

/**
 * Maps mention subtypes to their canonical base entity types.
 *
 * Subtypes (e.g. "feature") are kept in the mention token so that display
 * concerns (icons, paths) remain specific, but data-fetching / preview logic
 * should use the resolved base type.
 */
const ENTITY_SUBTYPE_MAP: Record<string, string> = {
  standard: "task",
  bug: "task",
  feature: "task",
  goal: "task",
  contract: "task",
  diagram: "task",
  diagram_element: "task",
  diagramelement: "task",
  workflow: "task",
  workflow_step: "task",
  workflowstep: "task",
  task_monitor: "task",
  taskmonitor: "task",
};

// These are canonical entities with their own preview data paths. Any other
// mention type is a registry-backed work-item type, including project-defined
// keys, and therefore uses the task detail path.
const NON_WORK_ITEM_ENTITY_TYPES = new Set([
  "artifact",
  "initiative",
  "project",
  "message",
  "conversation",
  "design_doc",
  "agent_session",
  "validation_session",
  "service",
  "plan",
  "report",
  "proposal",
  "plan_stage",
  "plan_step",
  "implementation_hint",
  "user",
]);

/**
 * Resolve a mention entity type to its canonical base type.
 * @param entityType The raw entity type from a mention token
 * @returns The base entity type to use for data fetching / preview logic
 * @example
 * resolveBaseEntityType('feature') // 'task'
 * resolveBaseEntityType('task')    // 'task'
 */
export function resolveBaseEntityType(entityType: string): string {
  const normalizedEntityType = entityType.toLowerCase();
  return ENTITY_SUBTYPE_MAP[normalizedEntityType] ?? normalizedEntityType;
}

/**
 * Resolve the entity type used by shared preview data fetching.
 *
 * Work-item mentions may carry a built-in or project-defined registry key
 * instead of the canonical `task` entity type. Those keys all use the task
 * detail endpoint, while canonical non-work-item entities keep their
 * specialized preview paths.
 */
export function resolvePreviewEntityType(entityType: string): string {
  const normalizedEntityType = entityType.toLowerCase();

  return NON_WORK_ITEM_ENTITY_TYPES.has(normalizedEntityType)
    ? resolveBaseEntityType(normalizedEntityType)
    : "task";
}

export type MentionContentSegment =
  | { type: "text"; text: string }
  | { type: "mention"; mention: EntityMentionType; token: string };

/**
 * Options for parsing/extracting mention tokens.
 *
 * `allowMentionEscapes` opts the consumer into tolerating backslashes before
 * the internal `|` in addition to the always-tolerated backslashes before `[`.
 * Leave it off on user-authored surfaces (we keep authoring pressure on agents
 * to emit canonical tokens) and turn it on for system-authored surfaces where
 * the user can't fix upstream content (SystemMessage bodies, Proposal diffs).
 *
 * Floor (always on, even with the flag off): any number of leading backslashes
 * before `[` are tolerated. With the flag on, the same tolerance extends to
 * backslashes before the `|`.
 */
export interface MentionParseOptions {
  allowMentionEscapes?: boolean;
}

/**
 * Regex pattern for matching mention tokens in text
 * Format: @[type:id|name]
 * - type: letters, numbers, underscores, hyphens (e.g., "initiative", "design_doc", "mockups_v3")
 * - id: lowercase letters, numbers, underscores, hyphens (e.g., "abc-123")
 * - name: any text except closing bracket (e.g., "Project Alpha")
 */
export const MENTION_TOKEN_REGEX =
  /@\\*\[([a-zA-Z0-9_-]+):([a-z0-9_-]+)\|([^\]]+)\]/g;
export const MENTION_TOKEN_SINGLE_REGEX =
  /@\\*\[([a-zA-Z0-9_-]+):([a-z0-9_-]+)\|([^\]]+)\]/;

const MENTION_TOKEN_SOURCE_STRICT =
  "@\\\\*\\[([a-zA-Z0-9_-]+):([a-z0-9_-]+)\\|([^\\]]+)\\]";
const MENTION_TOKEN_SOURCE_RELAXED =
  "@\\\\*\\[([a-zA-Z0-9_-]+):([a-z0-9_-]+)\\\\*\\|([^\\]]+)\\]";

function buildMentionRegex(
  opts: MentionParseOptions | undefined,
  flags: string
): RegExp {
  const source = opts?.allowMentionEscapes
    ? MENTION_TOKEN_SOURCE_RELAXED
    : MENTION_TOKEN_SOURCE_STRICT;
  return new RegExp(source, flags);
}

/**
 * Format an EntityMention object into a mention token string
 * @param mention The mention object to format
 * @returns The formatted mention token string
 * @example
 * formatMention({ entityType: 'initiative', entityId: 'abc-123', entityName: 'Project Alpha' })
 * // Returns: '@[initiative:abc-123|Project Alpha]'
 */
export function formatMention(mention: EntityMentionType): string {
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
export function parseMention(
  token: string,
  opts?: MentionParseOptions
): EntityMentionType | null {
  const match = token.match(buildMentionRegex(opts, ""));
  if (!match) return null;

  return {
    entityType: match[1].toLowerCase(),
    entityId: match[2],
    entityName: match[3],
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
export function extractMentions(
  content: string,
  opts?: MentionParseOptions
): EntityMentionType[] {
  const mentions: EntityMentionType[] = [];
  const matches = content.matchAll(buildMentionRegex(opts, "g"));

  for (const match of matches) {
    mentions.push({
      entityType: match[1],
      entityId: match[2],
      entityName: match[3],
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
export function stripMentions(
  content: string,
  opts?: MentionParseOptions
): string {
  return content.replace(buildMentionRegex(opts, "g"), "");
}

/**
 * Replace a single mention token with its display text
 * @param mention The mention object to render
 * @returns The display text for the mention (e.g., '@Task A')
 * @example
 * renderMentionText({ entityType: 'task', entityId: '123', entityName: 'Task A' })
 * // Returns: '@Task A'
 */
export function renderMentionText(mention: EntityMentionType): string {
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
export function renderMentionsAsText(
  content: string,
  opts?: MentionParseOptions
): string {
  return content.replace(buildMentionRegex(opts, "g"), (token) => {
    const mention = parseMention(token, opts);
    return mention ? renderMentionText(mention) : token;
  });
}

/**
 * Split content into ordered text and mention segments for rich rendering.
 */
export function splitContentByMentions(
  content: string,
  opts?: MentionParseOptions
): MentionContentSegment[] {
  if (!content) {
    return [{ type: "text", text: "" }];
  }

  const mentionRegex = buildMentionRegex(opts, "g");
  const segments: MentionContentSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(mentionRegex)) {
    const [token, entityType, entityId, entityName] = match;
    const start = match.index ?? 0;

    if (start > cursor) {
      segments.push({
        type: "text",
        text: content.slice(cursor, start),
      });
    }

    segments.push({
      type: "mention",
      mention: { entityType, entityId, entityName },
      token,
    });

    cursor = start + token.length;
  }

  if (cursor < content.length) {
    segments.push({
      type: "text",
      text: content.slice(cursor),
    });
  }

  if (segments.length === 0) {
    return [{ type: "text", text: content }];
  }

  return segments;
}

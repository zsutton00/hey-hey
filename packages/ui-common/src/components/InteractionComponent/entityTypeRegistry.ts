import type React from "react";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import {
  EntityType,
  TargetEntityType,
  type AvailableMcpToolDto,
} from "../../api";
import type { OpenItemEntityType } from "../../types/openItems";
import { resolvePreviewEntityType } from "../../utils/mentionFormatting";
import type {
  LineageContext,
  MenuAction,
  MenuContribution,
  MenuContributionContext,
  MenuContributionItem,
  MenuContributionSection,
} from "./types";

/**
 * Describes how an entity type maps onto session/run context fields
 * when launching a conversation.
 *
 * `sessionField` — the key on the AgentSession creation payload
 *                  (e.g. "taskId", "designDocId")
 * `entityType`   — the value for `runContext.entityRef.entityType`
 */
export interface LineageFieldMapping {
  sessionField: string;
  entityType: string;
}

/**
 * A single menu item that can appear in the context menu.
 * Built-in actions (like "discuss") carry only an `action` key.
 * MCP-tool-derived items carry a `toolName` that is forwarded as the action.
 */
export interface EntityMenuItem extends MenuContributionItem {
  action: MenuAction;
}

const MENU_SECTION_ORDER: Record<MenuContributionSection, number> = {
  primary: 0,
  shared: 1,
  secondary: 2,
  removal: 3,
  async: 4,
  provenance: 5,
};

export function composeMenuContributions(
  ...sources: ReadonlyArray<readonly MenuContribution[] | undefined>
): MenuContribution[] {
  return sources
    .flatMap((source) => source ?? [])
    .map((contribution, sourceIndex) => ({ contribution, sourceIndex }))
    .sort(
      (left, right) =>
        MENU_SECTION_ORDER[left.contribution.section] -
          MENU_SECTION_ORDER[right.contribution.section] ||
        left.contribution.order - right.contribution.order ||
        left.contribution.id.localeCompare(right.contribution.id) ||
        left.sourceIndex - right.sourceIndex,
    )
    .map(({ contribution }) => contribution);
}

export type PreviewCapability =
  | {
      kind: "supported";
      entityType: OpenItemEntityType;
    }
  | {
      kind: "unsupported";
    };

export const OPEN_ITEM_INTERACTION_ENTITY_TYPES = {
  initiative: "INITIATIVE",
  task: TargetEntityType.Task,
  goal: "GOAL",
  conversation: TargetEntityType.Conversation,
  design_doc: TargetEntityType.DesignDoc,
  agent_session: TargetEntityType.AgentSession,
  plan: TargetEntityType.Task,
  proposal: "PROPOSAL",
} as const satisfies Record<OpenItemEntityType, string>;

type OpenItemInteractionEntityType =
  (typeof OPEN_ITEM_INTERACTION_ENTITY_TYPES)[OpenItemEntityType];

const previewSupported = (
  entityType: OpenItemEntityType,
): PreviewCapability => ({ kind: "supported", entityType });

const PREVIEW_UNSUPPORTED = {
  kind: "unsupported",
} as const satisfies PreviewCapability;

/**
 * Render props passed to composition slots so they can display
 * entity-aware content.
 */
export interface CompositionSlotProps {
  context: LineageContext;
}

/**
 * Configuration for a single entity type within the interaction system.
 *
 * To register a new entity type, add an entry to `DEFAULT_ENTITY_TYPE_REGISTRY`
 * with the appropriate config, or pass `entityTypeConfig` as a prop override
 * to `InteractionComponent`.
 */
export interface EntityTypeConfig {
  /** Human-readable label for this entity type (e.g. "task", "design doc") */
  displayLabel: string;

  /**
   * Menu items shown in the context menu for this entity type.
   * "Discuss..." is the baseline action included for all types.
   * Additional actions will be derived from MCP tool availability in the future.
   */
  menuItems: EntityMenuItem[];

  /** Whether the consuming application's shared modal can preview this type. */
  previewCapability: PreviewCapability;

  /** Maps entity fields onto session/run context for conversation launch */
  lineageFieldMapping: LineageFieldMapping;

  /**
   * Optional component that wraps children to provide entity-specific context.
   * Receives `CompositionSlotProps` (containing `LineageContext`) plus `children`.
   * When omitted, children render without additional context wrapping.
   *
   * Example: a lineage data provider that fetches influence chains for tasks.
   */
  contextProvider?: React.ComponentType<
    CompositionSlotProps & { children: React.ReactNode }
  >;

  /**
   * Optional component that replaces the default children rendering.
   * Receives `CompositionSlotProps` and renders entity-specific content.
   * When omitted, the interaction component renders `children` as-is.
   *
   * Example: a specialized card renderer for plan stages.
   */
  renderer?: React.ComponentType<CompositionSlotProps>;
}

/** Entity type registry — maps TargetEntityType (or extended string keys) to their config. */
export type EntityTypeRegistry = Partial<
  Record<TargetEntityType | (string & {}), EntityTypeConfig>
>;

// ---------------------------------------------------------------------------
// Built-in configs
// ---------------------------------------------------------------------------

const DISCUSS_ITEM: EntityMenuItem = {
  action: "discuss",
  label: "Discuss...",
  icon: ChatBubbleOutlineIcon,
  testId: "interaction-menu-discuss",
};

const taskConfig: EntityTypeConfig = {
  displayLabel: "task",
  menuItems: [DISCUSS_ITEM],
  previewCapability: previewSupported("task"),
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "task",
  },
};

const goalConfig: EntityTypeConfig = {
  displayLabel: "goal",
  menuItems: [DISCUSS_ITEM],
  previewCapability: previewSupported("goal"),
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "task",
  },
};

const designDocConfig: EntityTypeConfig = {
  displayLabel: "design doc",
  menuItems: [DISCUSS_ITEM],
  previewCapability: previewSupported("design_doc"),
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "design_doc",
  },
};

const planStageConfig: EntityTypeConfig = {
  displayLabel: "plan stage",
  menuItems: [DISCUSS_ITEM],
  previewCapability: PREVIEW_UNSUPPORTED,
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "plan_stage",
  },
};

const initiativeConfig: EntityTypeConfig = {
  displayLabel: "initiative",
  menuItems: [DISCUSS_ITEM],
  previewCapability: previewSupported("initiative"),
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "initiative",
  },
};

const reportConfig: EntityTypeConfig = {
  displayLabel: "report",
  menuItems: [DISCUSS_ITEM],
  previewCapability: PREVIEW_UNSUPPORTED,
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "report",
  },
};

const proposalConfig: EntityTypeConfig = {
  displayLabel: "proposal",
  menuItems: [DISCUSS_ITEM],
  previewCapability: previewSupported("proposal"),
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "proposal",
  },
};

const planConfig: EntityTypeConfig = {
  displayLabel: "plan",
  menuItems: [DISCUSS_ITEM],
  previewCapability: previewSupported("plan"),
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "plan",
  },
};

const serviceConfig: EntityTypeConfig = {
  displayLabel: "service",
  menuItems: [DISCUSS_ITEM],
  previewCapability: PREVIEW_UNSUPPORTED,
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "service",
  },
};

const agentSessionConfig: EntityTypeConfig = {
  displayLabel: "agent session",
  menuItems: [DISCUSS_ITEM],
  previewCapability: previewSupported("agent_session"),
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "agent_session",
  },
};

const conversationConfig: EntityTypeConfig = {
  displayLabel: "conversation",
  menuItems: [DISCUSS_ITEM],
  previewCapability: previewSupported("conversation"),
  lineageFieldMapping: {
    sessionField: "entityId",
    entityType: "conversation",
  },
};

/**
 * Default registry containing configs for all currently supported entity types.
 *
 * ## Adding a new entity type (end-to-end)
 *
 * ### Frontend (this package)
 *
 * 1. Add the new value to `TargetEntityType` in the API contract.
 * 2. Add an `EntityTypeConfig` entry to this registry:
 *    - `displayLabel` — human-readable name shown in menus and modals
 *    - `menuItems` — at minimum `[DISCUSS_ITEM]`; additional items will come
 *      from MCP tool availability in the future
 *    - `previewCapability` — a supported Open Item entity kind or an explicit
 *      unsupported marker; supported kinds must also be present in
 *      `OPEN_ITEM_INTERACTION_ENTITY_TYPES`
 *    - `lineageFieldMapping` — the `sessionField` key used on the
 *      AgentSession creation payload (e.g. "stageId") and the
 *      `entityType` value for `runContext.entityRef` (e.g. "task")
 *    - `contextProvider` (optional) — a React component that wraps children
 *      with entity-specific context (e.g. lineage data fetching)
 *    - `renderer` (optional) — a React component that replaces default
 *      children rendering for custom entity visualization
 * 3. The `InteractionComponent` automatically resolves the new type from
 *    the registry — no changes to core component logic required.
 * 4. For one-off overrides, pass `entityTypeConfig` as a prop to
 *    `InteractionComponent` instead of modifying this registry.
 *
 * ### Backend (entity context service)
 *
 * 5. Add a creation-timestamp resolver entry to the entity context
 *    dispatch table, keyed by the new `TargetEntityType` value.
 * 6. Register any new MCP tools for the entity type in the
 *    viewing-context-keyed tool mapping, declaring the target entity type
 *    on each tool so the frontend can discover available actions.
 */
export const DEFAULT_ENTITY_TYPE_REGISTRY = {
  TASK: taskConfig,
  GOAL: goalConfig,
  DESIGN_DOC: designDocConfig,
  PLAN_STAGE: planStageConfig,
  INITIATIVE: initiativeConfig,
  REPORT: reportConfig,
  PROPOSAL: proposalConfig,
  PLAN: planConfig,
  SERVICE: serviceConfig,
  AGENT_SESSION: agentSessionConfig,
  CONVERSATION: conversationConfig,
} satisfies EntityTypeRegistry &
  Record<OpenItemInteractionEntityType, EntityTypeConfig>;

/**
 * Look up the config for an entity type, falling back to a provided
 * override or the default registry.
 */
export function resolveEntityTypeConfig(
  entityType: string,
  override?: EntityTypeConfig,
  registry: EntityTypeRegistry = DEFAULT_ENTITY_TYPE_REGISTRY,
): EntityTypeConfig | undefined {
  if (override) return override;

  const normalizedEntityType = entityType.toUpperCase();
  const directConfig = registry[entityType] ?? registry[normalizedEntityType];
  if (directConfig) return directConfig;

  const previewEntityType = resolvePreviewEntityType(entityType);
  const baseConfig = registry[previewEntityType.toUpperCase()];
  const displayLabel = entityType.toLowerCase().replace(/_/g, " ");

  if (baseConfig) {
    return {
      ...baseConfig,
      displayLabel,
    };
  }

  return {
    displayLabel,
    menuItems: [DISCUSS_ITEM],
    previewCapability: PREVIEW_UNSUPPORTED,
    lineageFieldMapping: {
      sessionField: "entityId",
      entityType: entityType.toLowerCase(),
    },
  };
}

export function buildDefaultMenuContributions(
  entityType: string,
  context: MenuContributionContext,
  override?: EntityTypeConfig,
): MenuContribution[] {
  const config = resolveEntityTypeConfig(entityType, override);
  if (!config) return [];
  const normalizedEntityType = entityType.trim().toUpperCase();
  const normalizedSubtype = context.entitySubtype?.trim().toUpperCase();
  const displayLabel =
    normalizedEntityType === EntityType.Task && normalizedSubtype
      ? normalizedSubtype === "STANDARD"
        ? config.displayLabel
        : normalizedSubtype.toLowerCase().replace(/_/g, " ")
      : config.displayLabel;
  const label = displayLabel.replace(/\b\w/g, (value) =>
    value.toUpperCase(),
  );
  const discussItem = config.menuItems.find((item) => item.action === "discuss");
  const contributions: MenuContribution[] = discussItem
    ? [
        {
          id: "registry-discuss",
          section: "shared",
          order: 0,
          controller: "discuss",
          items: [{ ...discussItem, label: `Discuss ${label}` }],
        },
      ]
    : [];
  const canonicalType = config.lineageFieldMapping.entityType.toUpperCase();
  if (
    context.organizationId &&
    context.projectId &&
    (Object.values(EntityType) as string[]).includes(canonicalType)
  ) {
    contributions.push({
      id: "registry-star",
      section: "shared",
      order: 10,
      controller: "star",
    });
  }
  return contributions;
}

/**
 * Returns true when `tool` may surface for a host whose task subtype is
 * `entitySubtype`. A tool with no `validTaskTypes` (or an empty list)
 * carries no constraint; a non-empty list restricts the tool to the
 * listed task subtypes.
 */
function toolMatchesEntitySubtype(
  tool: AvailableMcpToolDto,
  entitySubtype?: string,
): boolean {
  const allow = tool.validTaskTypes;
  if (!allow || allow.length === 0) return true;
  if (!entitySubtype) return false;
  return allow.includes(entitySubtype as (typeof allow)[number]);
}

/**
 * Translate MCP tool DTOs into menu items, filtering out tools whose
 * `validTaskTypes` does not include the host's `entitySubtype`. The
 * `toolName` is used as the action identifier so the dispatch map can
 * route each invocation to its registered handler.
 */
export function mcpToolsToMenuItems(
  tools: AvailableMcpToolDto[],
  entitySubtype?: string,
): EntityMenuItem[] {
  return tools
    .filter((tool) => toolMatchesEntitySubtype(tool, entitySubtype))
    .map((tool) => ({
      action: tool.toolName,
      label: tool.label,
      toolName: tool.toolName,
    }));
}

/**
 * Build the final menu item list by appending MCP-tool-derived items
 * after the registry's built-in items (e.g. "Discuss..."). Tools that
 * do not apply to the host's `entitySubtype` are filtered out.
 */
export function buildMenuItems(
  registryItems: EntityMenuItem[],
  availableTools?: AvailableMcpToolDto[],
  entitySubtype?: string,
): EntityMenuItem[] {
  if (!availableTools?.length) return registryItems;
  return [
    ...registryItems,
    ...mcpToolsToMenuItems(availableTools, entitySubtype),
  ];
}

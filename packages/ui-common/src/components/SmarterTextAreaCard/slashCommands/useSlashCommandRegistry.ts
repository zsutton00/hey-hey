import { useMemo } from "react";
import type { WorkItemTypeSummaryDto } from "../../../api";
import { WorkItemTypeLifecycleStatus } from "../../../api";
import { useWorkItemTypes } from "../../../data/hooks/useWorkItemTypes";
import {
  FEATURE_TREE_PICKER,
  type Command,
  type ExecutableSubagentCommand,
  type InlineEntitySearchCommand,
  SKILL_PICKER,
  type SurfaceContext,
  type AttachedAgentComposerContext,
} from "./types";

export interface SlashCommandRegistry {
  heyHey: Command[];
}

export interface UseSlashCommandRegistryOptions {
  surfaceContext: SurfaceContext;
  query: string;
  organizationId: string | null;
  projectId: string | null;
  agentContext?: Pick<AttachedAgentComposerContext, "provider"> | null;
}

const FIXED_HEY_HEY_BUILTINS: Command[] = [
  {
    id: "hey-hey-builtin:service",
    name: "service",
    description: "Insert a service reference",
    kind: "inline-entity-search",
    source: "hey-hey-builtin",
    argShape: "entity",
    typeRef: "SERVICE",
    typeRefKind: "entity-type",
  },
  {
    id: "hey-hey-builtin:plan",
    name: "plan",
    description: "Insert a plan reference",
    kind: "inline-entity-search",
    source: "hey-hey-builtin",
    argShape: "entity",
    typeRef: "PLAN",
    typeRefKind: "entity-type",
  },
  {
    id: "hey-hey-builtin:doc",
    name: "doc",
    description: "Insert a design doc reference",
    kind: "inline-entity-search",
    source: "hey-hey-builtin",
    argShape: "entity",
    typeRef: "DESIGN_DOC",
    typeRefKind: "entity-type",
  },
  {
    id: "hey-hey-builtin:recent",
    name: "recent",
    description: "Insert a recently viewed entity",
    kind: "inline-entity-search",
    source: "hey-hey-builtin",
    argShape: "entity",
  },
  {
    id: "hey-hey-builtin:search",
    name: "search",
    description: "Open advanced search",
    kind: "open-modal",
    source: "hey-hey-builtin",
    argShape: "query",
    modal: "search",
  },
  {
    id: "hey-hey-builtin:feature-tree",
    name: FEATURE_TREE_PICKER,
    description: "Open the feature tree",
    kind: "open-picker",
    source: "hey-hey-builtin",
    argShape: "none",
    picker: FEATURE_TREE_PICKER,
  },
];

const SKILL_COMMAND: Command = {
  id: "hey-hey-builtin:skill",
  name: "skill",
  description: "Use an installed Codex Skill",
  kind: "open-skill-picker",
  source: "hey-hey-builtin",
  argShape: "none",
  picker: SKILL_PICKER,
};

export const SUBAGENT_COMMAND: ExecutableSubagentCommand = {
  id: "hey-hey-builtin:subagent",
  name: "subagent",
  description: "Choose how a research subagent helps",
  kind: "executable-subagent",
  source: "hey-hey-builtin",
  argShape: "query",
  supportedModes: ["foreground", "background"],
  supportedCapabilities: ["research"],
};

const MESSAGE_AGENT_COMMAND: Command = {
  id: "hey-hey-builtin:message-agent",
  name: "message-agent",
  description: "Ask or answer one Agent Session",
  kind: "executable-message-agent",
  source: "hey-hey-builtin",
  argShape: "query",
};

// The work-item-type registry uses `STANDARD` as the key for the base task
// type, but users say "task" — surface the more familiar slug while keeping
// the registry key as the typeRef the search filters on.
const COMMAND_NAME_OVERRIDES: Record<string, string> = {
  STANDARD: "task",
};

const isTypedInlineEntitySearchCommand = (
  command: Command
): command is InlineEntitySearchCommand & { typeRef: string } =>
  command.kind === "inline-entity-search" &&
  typeof command.typeRef === "string" &&
  command.typeRef.trim().length > 0;

const filterCommandsForSurface = (
  commands: ReadonlyArray<Command>,
  commandSurface: SurfaceContext["commandSurface"]
): Command[] => {
  if (commandSurface !== "entity-insertion-only") {
    return [...commands];
  }

  return commands.filter(isTypedInlineEntitySearchCommand);
};

function workItemTypeToCommand(type: WorkItemTypeSummaryDto): Command {
  const { key, name, description } = type.definition;
  return {
    id: `hey-hey-builtin:work-item-type:${key}`,
    name: COMMAND_NAME_OVERRIDES[key] ?? key.toLowerCase(),
    description: description ?? name,
    kind: "inline-entity-search",
    source: "hey-hey-builtin",
    argShape: "entity",
    typeRef: key,
    typeRefKind: "work-item-type",
  };
}

export function useSlashCommandRegistry(
  options: UseSlashCommandRegistryOptions
): SlashCommandRegistry {
  const { organizationId, projectId, surfaceContext, query, agentContext } =
    options;
  const { commandSurface = "general" } = surfaceContext;
  const { workItemTypes } = useWorkItemTypes(organizationId ?? undefined, {
    projectId: projectId ?? undefined,
    status: WorkItemTypeLifecycleStatus.Active,
  });

  return useMemo(() => {
    const normalizedQuery = (
      query.startsWith("/") ? query.slice(1) : query
    ).toLowerCase();
    const matches = (c: Command) => c.name.startsWith(normalizedQuery);

    const derived = workItemTypes.map(workItemTypeToCommand);
    const skillCommand =
      agentContext?.provider === "codex"
        ? SKILL_COMMAND
        : surfaceContext.unavailableSkillCommandReason
        ? {
            ...SKILL_COMMAND,
            availability: {
              state: "disabled" as const,
              reason: surfaceContext.unavailableSkillCommandReason,
            },
          }
        : null;
    const attachedAgentCommands = skillCommand ? [skillCommand] : [];
    const heyHey = filterCommandsForSurface(
      [
        ...derived,
        ...FIXED_HEY_HEY_BUILTINS,
        ...attachedAgentCommands,
        ...(surfaceContext.subagentCommandAvailable ? [SUBAGENT_COMMAND] : []),
        ...(surfaceContext.messageAgentCommandAvailable
          ? [MESSAGE_AGENT_COMMAND]
          : []),
      ].filter(matches),
      commandSurface
    );

    return { heyHey };
  }, [
    agentContext?.provider,
    workItemTypes,
    commandSurface,
    query,
    surfaceContext.unavailableSkillCommandReason,
    surfaceContext.subagentCommandAvailable,
    surfaceContext.messageAgentCommandAvailable,
  ]);
}

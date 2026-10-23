import type {
  AgentSkillProvider,
  AgentSkillCatalogContext,
  AgentSkillSelection,
  EntityType,
} from "../../../api";
import type { EntityMention, SearchEntity } from "../types";

export const FEATURE_TREE_PICKER = "feature-tree" as const;
export const SKILL_PICKER = "skill-picker" as const;

interface CommandBase {
  id: string;
  name: string; // no leading slash
  description: string;
  source: "hey-hey-builtin";
  availability?: { state: "enabled" } | { state: "disabled"; reason: string };
  scope?: {
    featureId?: string;
    projectId?: string;
    [key: string]: string | undefined;
  }; // reserved V2
}

type InlineEntitySearchTypeRef =
  | {
      typeRef?: undefined;
      typeRefKind?: undefined;
    }
  | {
      typeRef: string;
      typeRefKind: "entity-type" | "work-item-type";
    };

export type InlineEntitySearchCommand = CommandBase &
  InlineEntitySearchTypeRef & {
    kind: "inline-entity-search";
    argShape: "entity";
  };

interface OpenModalCommand extends CommandBase {
  kind: "open-modal";
  argShape: "query";
  modal: "search";
}

interface OpenPickerCommand extends CommandBase {
  kind: "open-picker";
  argShape: "none";
  picker: typeof FEATURE_TREE_PICKER;
}

interface OpenSkillPickerCommand extends CommandBase {
  kind: "open-skill-picker";
  argShape: "none";
  picker: typeof SKILL_PICKER;
}

export interface ExecutableSubagentCommand extends CommandBase {
  kind: "executable-subagent";
  argShape: "query";
  supportedModes: readonly ["foreground", "background"];
  supportedCapabilities: readonly ["research"];
}

interface ExecutableMessageAgentCommand extends CommandBase {
  kind: "executable-message-agent";
  argShape: "query";
}

export type Command =
  | InlineEntitySearchCommand
  | OpenModalCommand
  | OpenPickerCommand
  | OpenSkillPickerCommand
  | ExecutableSubagentCommand
  | ExecutableMessageAgentCommand;

export const isCommandDisabled = (command: Command): boolean =>
  command.availability?.state === "disabled";

export type SlashFocalEntityState =
  | { kind: "none" }
  | { kind: "entity"; entityType: EntityType; entityId: string };

export const NO_SLASH_FOCAL_ENTITY: SlashFocalEntityState = {
  kind: "none",
};

export const NO_CACHED_CONVERSATION_MENTION_OPTIONS: readonly SearchEntity[] =
  [];

export interface SurfaceContext {
  commandSurface?: "general" | "entity-insertion-only";
  subagentCommandAvailable?: boolean;
  messageAgentCommandAvailable?: boolean;
  focalEntity: SlashFocalEntityState;
  cachedConversationMentionOptions: readonly SearchEntity[];
  /**
   * Pre-run surfaces may show `/skill` as disabled so the user understands
   * that Skills become available after an attached Codex session exists.
   */
  unavailableSkillCommandReason?: string;
}

/** Context that makes the provider-owned Skill catalog available to a composer. */
export interface AttachedAgentComposerContext {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  runId: string;
  machineId: string;
  provider: AgentSkillProvider;
  selectedSkill: AgentSkillSelection | null;
  onSkillSelected: (selection: AgentSkillSelection) => void;
}

export interface PreRunAgentComposerContext {
  organizationId: string;
  projectId: string;
  machineId: string;
  provider: AgentSkillProvider;
  catalogContext: AgentSkillCatalogContext;
  selectedSkill: AgentSkillSelection | null;
  onSkillSelected: (selection: AgentSkillSelection) => void;
}

export type AgentComposerContext =
  AttachedAgentComposerContext | PreRunAgentComposerContext;

export interface PickerReplacementRange {
  nodeKey: string;
  sliceStart: number;
  cursorOffset: number;
}

interface PickerAnchorPosition {
  top?: number;
  bottom?: number;
  left: number;
}

export type EntitySelectionTarget =
  | { kind: "entity-type"; entityType: EntityType }
  | { kind: "work-item-type"; workItemTypeKey: string };

export type PickerEmit =
  | {
      type: "openEntitySelection";
      target: EntitySelectionTarget;
      replacementRange: PickerReplacementRange;
    }
  | {
      type: "insertMention";
      entityRef: EntityMention;
      replacementRange: PickerReplacementRange;
    }
  | {
      type: "openPicker";
      picker: typeof FEATURE_TREE_PICKER;
      replacementRange: PickerReplacementRange;
      anchorPosition: PickerAnchorPosition;
    }
  | {
      type: "openSkillPicker";
      picker: typeof SKILL_PICKER;
      replacementRange: PickerReplacementRange;
    }
  | { type: "openModal"; modal: "search"; prefill: string }
  | {
      type: "insertText";
      text: string;
      replacementRange: PickerReplacementRange;
    };

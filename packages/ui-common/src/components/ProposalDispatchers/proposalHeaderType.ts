import type { ComponentType } from "react";
import type { SvgIconProps } from "@mui/material";
import {
  TargetEntityType,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeEffectiveSource,
} from "../../api";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import {
  getFallbackEntityColors,
  getEntityColors,
  getEntityIcon,
  resolveWorkItemIconPresentation,
  type EntityColors,
} from "../../utils/entityIcons";
import { resolveEntityTypeConfig } from "../InteractionComponent";
import type { ProposalHeaderTypePresentation } from "./ProposalHeader";
import {
  isArchiveWorkItemTypeUpdates,
  isCreateTaskUpdates,
  isCreateWorkItemTypeUpdates,
  isUpdateWorkItemTypeUpdates,
} from "./types";

export type ProposalHeaderTaskTypeSource =
  | { kind: "create"; proposedType: string | undefined }
  | { kind: "existing"; loadedType: string | undefined };

/**
 * CREATE proposals describe the type in their updates; UPDATE and DELETE
 * proposals must use the type of the loaded task. Keeping that distinction in
 * one function prevents a proposal's stale target metadata from winning.
 */
export const resolveEffectiveTaskType = (
  source: ProposalHeaderTaskTypeSource
): string | undefined =>
  source.kind === "create"
    ? source.proposedType ?? "STANDARD"
    : source.loadedType;

export const resolveProposalTaskType = (
  proposal: ProposalResponseDto,
  loadedType?: string
): string | undefined => {
  if (isCreateTaskUpdates(proposal)) {
    return resolveEffectiveTaskType({
      kind: "create",
      proposedType: proposal.updates.type,
    });
  }

  return resolveEffectiveTaskType({ kind: "existing", loadedType });
};

export const resolveProposalWorkItemTypeKey = (
  proposal: ProposalResponseDto
): string | undefined => {
  if (isCreateWorkItemTypeUpdates(proposal)) {
    return proposal.updates.key;
  }
  if (isUpdateWorkItemTypeUpdates(proposal)) {
    return proposal.updates.definition.key;
  }
  if (isArchiveWorkItemTypeUpdates(proposal)) {
    return proposal.targetEntityId;
  }
  return undefined;
};

export const resolveWorkItemTypeColors = (
  taskType: string,
  definition?: WorkItemTypeDefinitionDto,
  effectiveSource?: WorkItemTypeEffectiveSource
): EntityColors =>
  resolveWorkItemIconPresentation(taskType, definition, effectiveSource)
    ?.colors ?? getFallbackEntityColors();

export type ProposalHeaderTypeTarget =
  | {
      kind: "task";
      taskType: string | undefined;
    }
  | {
      kind: "entity";
      entityType: TargetEntityType | string;
    };

export interface ProposalHeaderTypeResolution {
  presentation: ProposalHeaderTypePresentation;
  definition: WorkItemTypeDefinitionDto | undefined;
  isLoading: boolean;
  error: Error | null;
}

const titleCase = (value: string): string => {
  const normalized = value.toLowerCase().replace(/_/g, " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

type AvailableProposalHeaderTypePresentation = Extract<
  ProposalHeaderTypePresentation,
  { kind: "available" }
>;

const entityPresentation = (
  entityType: TargetEntityType | string
): AvailableProposalHeaderTypePresentation => {
  const config = resolveEntityTypeConfig(entityType);
  return {
    kind: "available",
    label: titleCase(config?.displayLabel ?? entityType),
    Icon: getEntityIcon(entityType),
    colors: getEntityColors(entityType),
  };
};

/**
 * Resolve a proposal header presentation from an entity type without loading
 * the target entity or its work-item definition.
 */
export const staticProposalEntityTypePresentation = (
  entityType: TargetEntityType | string
): ProposalHeaderTypePresentation => entityPresentation(entityType);

const taskFallbackPresentation = (
  taskType: string
): AvailableProposalHeaderTypePresentation =>
  taskType.toLowerCase() === "standard"
    ? entityPresentation(TargetEntityType.Task)
    : {
        kind: "available",
        label: titleCase(taskType),
        Icon: getEntityIcon("task"),
      };

export function useProposalHeaderTypeResolution(
  organizationId: string | undefined,
  projectId: string | undefined,
  target: ProposalHeaderTypeTarget
): ProposalHeaderTypeResolution {
  const taskType = target.kind === "task" ? target.taskType : undefined;
  const registry = useWorkItemTypeByKey(organizationId, projectId, taskType);

  if (target.kind === "entity") {
    return {
      presentation: entityPresentation(target.entityType),
      definition: undefined,
      isLoading: false,
      error: null,
    };
  }

  if (!taskType) {
    return {
      presentation: taskFallbackPresentation(TargetEntityType.Task),
      definition: registry.workItemTypeDefinition,
      isLoading: false,
      error: registry.error,
    };
  }

  if (registry.isLoading) {
    return {
      presentation: { kind: "loading" },
      definition: registry.workItemTypeDefinition,
      isLoading: registry.isLoading,
      error: registry.error,
    };
  }

  const definition = registry.workItemTypeDefinition;
  if (!registry.error && definition?.key === taskType) {
    const iconPresentation = resolveWorkItemIconPresentation(
      taskType,
      definition,
      registry.workItemTypeSummary?.effectiveSource
    );
    return {
      presentation: {
        kind: "available",
        label: definition.name,
        Icon: iconPresentation?.Icon ?? getEntityIcon("task"),
        colors: iconPresentation?.colors,
      },
      definition,
      isLoading: false,
      error: null,
    };
  }

  return {
    presentation: taskFallbackPresentation(taskType),
    definition,
    isLoading: false,
    error: registry.error,
  };
}

export const staticProposalTypePresentation = (
  label: string,
  Icon: ComponentType<SvgIconProps> = getEntityIcon("task"),
  colors?: EntityColors
): ProposalHeaderTypePresentation => ({
  kind: "available",
  label,
  Icon,
  colors,
});

export const resolveWorkItemTypePresentation = (
  taskType: string,
  definition: WorkItemTypeDefinitionDto | undefined,
  effectiveSource?: WorkItemTypeEffectiveSource
): ProposalHeaderTypePresentation => {
  if (definition?.key !== taskType) {
    return taskFallbackPresentation(taskType);
  }

  const iconPresentation = resolveWorkItemIconPresentation(
    taskType,
    definition,
    effectiveSource
  );
  return {
    kind: "available",
    label: definition.name,
    Icon: iconPresentation?.Icon ?? getEntityIcon("task"),
    colors: iconPresentation?.colors,
  };
};

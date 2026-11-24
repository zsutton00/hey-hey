import { Box, Tooltip } from "@mui/material";
import React from "react";
import type {
  WorkItemTypeDefinitionDto,
  WorkItemTypeEffectiveSource,
} from "../../api";
import type {
  EntityActivationType,
  EntityPresentationSnapshot,
} from "../../contexts/EntityActivationContext";
import {
  getBuiltInWorkItemIconKey,
  resolveWorkItemIconPresentation,
} from "../../utils";
import { EntityIcon } from "./EntityIcon";

/** The project's work-item type registry, as Open Items icons read it. */
export interface WorkItemIconRegistry {
  definitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>;
  sources: ReadonlyMap<string, WorkItemTypeEffectiveSource>;
}

export interface OpenItemIconProps {
  entityType: EntityActivationType;
  presentation: EntityPresentationSnapshot | undefined;
  registry: WorkItemIconRegistry;
}

const ICON_SIZE = 24;

/**
 * The icon an Open Items row shows. Work items take their icon from the
 * registry definition and show none while it is unavailable; Agent Sessions
 * take coding or conversation from their recorded session type. Every
 * surface that draws Open Items rows uses this, so they cannot drift apart.
 */
export const OpenItemIcon: React.FC<OpenItemIconProps> = ({
  entityType,
  presentation,
  registry,
}) => {
  const taskType =
    presentation?.kind === "task" ? presentation.taskType : undefined;

  if (entityType === "task" && taskType) {
    const definition = registry.definitions.get(taskType);
    const builtInIconKey = getBuiltInWorkItemIconKey(taskType, definition);
    const iconDefinition =
      definition && builtInIconKey
        ? { ...definition, iconKey: builtInIconKey }
        : definition;
    const resolved = resolveWorkItemIconPresentation(
      taskType,
      iconDefinition,
      registry.sources.get(taskType),
    );
    if (!resolved) {
      return null;
    }

    const { Icon, colors } = resolved;
    return (
      <Tooltip title={taskType}>
        <Box
          data-testid={`open-item-registry-icon-${taskType}`}
          data-entity-type={taskType}
          sx={{
            width: ICON_SIZE,
            height: ICON_SIZE,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: colors.background,
            borderRadius: "2px",
            color: colors.color,
            flex: `0 0 ${ICON_SIZE}px`,
          }}
        >
          <Icon sx={{ fontSize: 16 }} />
        </Box>
      </Tooltip>
    );
  }

  return (
    <EntityIcon
      entityType={entityType}
      agentSessionType={
        presentation?.kind === "agent_session"
          ? presentation.sessionType
          : undefined
      }
      size={ICON_SIZE}
    />
  );
};

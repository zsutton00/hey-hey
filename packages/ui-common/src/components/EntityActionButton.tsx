import React from "react";
import {
  Button,
  type ButtonProps,
  CircularProgress,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import type { AgentSessionType } from "../api";
import type { WorkItemIconIdentity } from "../utils/entityIcons";
import { EntityIcon } from "./Entity/EntityIcon";

export type EntityActionVerb = "create" | "start";

const VERB_LABELS: Record<EntityActionVerb, string> = {
  create: "Create",
  start: "Start",
};

const DEFAULT_ICONS: Record<EntityActionVerb, React.ReactNode> = {
  create: <AddIcon />,
  start: <PlayArrowIcon />,
};

export interface EntityActionButtonProps extends Omit<ButtonProps, "children"> {
  verb: EntityActionVerb;
  /** Already-resolved display noun (TERMS or a work-item type name). */
  noun: string;
  /** Entity type the action creates or starts; its icon shows at `≤ md`. */
  entityType: string;
  /** Registry identity for work-item types (task, feature, plan, ...). */
  workItemIcon?: WorkItemIconIdentity;
  /** Subtype for agent sessions. */
  agentSessionType?: AgentSessionType;
  /** Replaces the visible label while a pending action runs. */
  loadingLabel?: string;
  loading?: boolean;
}

/**
 * Shared create/start action. Shows "<Verb> <Noun>" above `md` and only
 * "<Verb>" plus the entity type's icon at `≤ md`; the accessible name is
 * always the full label.
 */
export const EntityActionButton = ({
  verb,
  noun,
  entityType,
  workItemIcon,
  agentSessionType,
  loadingLabel,
  loading = false,
  startIcon,
  sx,
  ...buttonProps
}: EntityActionButtonProps) => {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down("md"));
  const verbLabel = VERB_LABELS[verb];
  const fullLabel = `${verbLabel} ${noun}`;
  const visibleLabel =
    loading && loadingLabel ? loadingLabel : isCompact ? verbLabel : fullLabel;
  // Work-item type icons come from the registry; withhold them until the
  // definition is available rather than showing a guessed icon.
  const typeIconAvailable =
    workItemIcon === undefined || workItemIcon.definition !== undefined;
  const typeIcon = typeIconAvailable ? (
    <EntityIcon
      entityType={entityType}
      workItemIcon={workItemIcon}
      agentSessionType={agentSessionType}
      size={20}
      round={false}
      aria-hidden
      sx={{ bgcolor: "transparent", color: "inherit" }}
    />
  ) : undefined;
  const resolvedStartIcon = loading ? (
    <CircularProgress size={16} color="inherit" />
  ) : isCompact ? (
    typeIcon
  ) : (
    (startIcon ?? DEFAULT_ICONS[verb])
  );

  return (
    <Button
      aria-label={fullLabel}
      startIcon={resolvedStartIcon}
      sx={[
        { whiteSpace: "nowrap", flexShrink: 0 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...buttonProps}
    >
      {visibleLabel}
    </Button>
  );
};

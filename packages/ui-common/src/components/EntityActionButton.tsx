import React from "react";
import {
  Button,
  type ButtonProps,
  CircularProgress,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import type { AgentSessionType } from "../api";
import type { WorkItemIconIdentity } from "../utils/entityIcons";
import { EntityIcon } from "./Entity/EntityIcon";

export type EntityActionVerb = "create" | "start";

const VERB_LABELS: Record<EntityActionVerb | "quick", string> = {
  create: "Create",
  start: "Start",
  quick: "Quick",
};

const DEFAULT_ICONS: Record<EntityActionVerb | "quick", React.ReactNode> = {
  create: <AddIcon />,
  start: <PlayArrowIcon />,
  quick: null,
};

type EntityActionTarget =
  | {
      verb: EntityActionVerb;
      /** Entity type the action creates or starts; its icon shows at `≤ md`. */
      entityType: string;
      /** Registry identity for work-item types (task, feature, plan, ...). */
      workItemIcon?: WorkItemIconIdentity;
      /** Subtype for agent sessions. */
      agentSessionType?: AgentSessionType;
    }
  | {
      /** A quick ask creates no entity of its own: `≤ md` shows a question mark. */
      verb: "quick";
      entityType?: never;
      workItemIcon?: never;
      agentSessionType?: never;
    };

export type EntityActionButtonProps = Omit<ButtonProps, "children"> &
  EntityActionTarget & {
    /** Already-resolved display noun (TERMS or a work-item type name). */
    noun: string;
    /** Replaces the visible label while a pending action runs. */
    loadingLabel?: string;
    /** While loading, shows only a spinner with this accessible name. */
    loadingSpinnerName?: string;
    loading?: boolean;
  };

/**
 * Shared create/start action. Shows "<Verb> <Noun>" above `md` and only
 * "<Verb>" plus an icon for what it acts on at `≤ md`; the accessible name is
 * the full label unless the caller names a state. Pass `startIcon={null}` for
 * a text-only button above `md`.
 */
export const EntityActionButton = ({
  verb,
  noun,
  entityType,
  workItemIcon,
  agentSessionType,
  loadingLabel,
  loadingSpinnerName,
  loading = false,
  startIcon,
  sx,
  "aria-label": ariaLabel,
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
  const typeIcon =
    entityType !== undefined && typeIconAvailable ? (
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
  const compactIcon = verb === "quick" ? <HelpOutlineIcon /> : typeIcon;
  const wideIcon = startIcon === undefined ? DEFAULT_ICONS[verb] : startIcon;
  const showsSpinnerOnly = loading && loadingSpinnerName !== undefined;

  let resolvedStartIcon = isCompact ? compactIcon : wideIcon;
  if (showsSpinnerOnly) {
    resolvedStartIcon = undefined;
  } else if (loading) {
    resolvedStartIcon = <CircularProgress size={16} color="inherit" />;
  }

  return (
    <Button
      aria-label={ariaLabel ?? fullLabel}
      startIcon={resolvedStartIcon}
      sx={[
        { whiteSpace: "nowrap", flexShrink: 0 },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...buttonProps}
    >
      {showsSpinnerOnly ? (
        <CircularProgress
          size={18}
          color="inherit"
          aria-label={loadingSpinnerName}
        />
      ) : (
        visibleLabel
      )}
    </Button>
  );
};

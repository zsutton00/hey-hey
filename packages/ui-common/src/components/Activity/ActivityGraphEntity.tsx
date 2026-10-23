import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { EntityType } from "../../api";
import { useOrganization, usePathService } from "../../contexts";
import { useCanHover } from "../../hooks/useCanHover";
import { EntityIcon } from "../Entity";
import { EntityHoverCard } from "../shared/EntityHoverCard";
import { getStatusColorMapping } from "../../utils/statusUtils";
import {
  ActivityGanttDerivedEntityType,
  ActivityGanttRelationshipType,
  ActivityGanttViewMode,
  getActivityGanttProgressPercent,
  getActivityGanttRelationshipLabel,
  getActivityGanttStatusLabel,
  type ActivityGanttEntityNode,
  type ActivityGanttPlanScope,
  type ActivityGanttRelationshipType as ActivityGanttRelationshipTypeType,
  type ActivityGanttViewMode as ActivityGanttViewModeType,
} from "./activityGanttPrimitives";
import { resolveActivityGraphEntityHref } from "./activityGraphLinkResolver";

const getStatusChipColor = (
  status: ActivityGanttEntityNode["status"]
): ReturnType<typeof getStatusColorMapping> => {
  return getStatusColorMapping(status);
};

const getSignalChipColor = (
  signalType: ActivityGanttRelationshipTypeType
): "default" | "primary" | "info" => {
  switch (signalType) {
    case ActivityGanttRelationshipType.Blocking:
      return "default";
    case ActivityGanttRelationshipType.Concurrent:
      return "info";
    case ActivityGanttRelationshipType.Report:
      return "primary";
    default:
      return "default";
  }
};

const getProgressLabel = (progress: {
  completedUnits: number;
  totalUnits: number;
}): string => {
  return `${progress.completedUnits}/${progress.totalUnits}`;
};

const shouldRenderEntityIcon = (
  entityType: ActivityGanttEntityNode["entityType"]
): boolean => {
  if (
    entityType === ActivityGanttDerivedEntityType.VerificationRecommendation
  ) {
    return false;
  }

  return true;
};

const HOVER_PREVIEW_SUPPORTED_TYPES = new Set<string>([
  EntityType.Task,
  EntityType.Initiative,
  EntityType.DesignDoc,
  EntityType.Service,
  EntityType.Message,
  EntityType.Conversation,
  EntityType.AgentSession,
]);

export interface ActivityGraphEntityProps {
  entity: ActivityGanttEntityNode;
  signals?: ActivityGanttRelationshipTypeType[];
  view?: ActivityGanttViewModeType;
  emphasis?: boolean;
  contrastChips?: boolean;
  projectId?: string;
  planScope?: ActivityGanttPlanScope;
  testIdPrefix?: string;
}

export const ActivityGraphEntity: React.FC<ActivityGraphEntityProps> = ({
  entity,
  signals = [],
  view = ActivityGanttViewMode.Full,
  emphasis = false,
  contrastChips = false,
  projectId,
  planScope,
  testIdPrefix = "activity-gantt-entity-card",
}) => {
  const pathService = usePathService();
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;
  const isCompact = view === ActivityGanttViewMode.Compact;
  const testId = `${testIdPrefix}-${entity.id}`;
  const href = resolveActivityGraphEntityHref({
    entityId: entity.entityId,
    entityType: entity.entityType,
    laneRole: entity.laneRole,
    projectId,
    planScope,
    pathService,
  });

  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const isOverPopoverRef = useRef(false);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      if (!isOverPopoverRef.current) {
        setHoverAnchor(null);
      }
    }, 100);
  }, [clearCloseTimeout]);

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      clearCloseTimeout();
      isOverPopoverRef.current = false;
      const target = event.currentTarget;
      hoverTimeoutRef.current = window.setTimeout(() => {
        setHoverAnchor(target);
      }, 500);
    },
    [clearCloseTimeout]
  );

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    scheduleClose();
  }, [scheduleClose]);

  const handlePopoverMouseEnter = useCallback(() => {
    isOverPopoverRef.current = true;
    clearCloseTimeout();
  }, [clearCloseTimeout]);

  const handlePopoverMouseLeave = useCallback(() => {
    isOverPopoverRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const canHover = useCanHover();
  const isHoverSupported = HOVER_PREVIEW_SUPPORTED_TYPES.has(entity.entityType);
  const hoverEntityType = entity.entityType.toLowerCase();

  const contrastChipSx = contrastChips
    ? {
        bgcolor: "rgba(255, 255, 255, 0.2)",
        color: "inherit",
        borderColor: "rgba(255, 255, 255, 0.4)",
      }
    : undefined;

  return (
    <Paper
      component={href ? RouterLink : "div"}
      data-testid={testId}
      onMouseEnter={canHover ? handleMouseEnter : undefined}
      onMouseLeave={canHover ? handleMouseLeave : undefined}
      to={href}
      sx={{
        p: emphasis ? 2 : isCompact ? 1 : 1.5,
        ...(href
          ? {
              color: "inherit",
              cursor: "pointer",
              display: "block",
              pointerEvents: "all",
              textDecoration: "none",
            }
          : {}),
      }}
      variant="outlined"
    >
      <Stack spacing={isCompact ? 0.75 : 1}>
        <Stack
          alignItems={{ xs: "flex-start", sm: "center" }}
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          spacing={0.75}
        >
          <Box alignItems="center" display="flex" gap={0.75} minWidth={0}>
            {shouldRenderEntityIcon(entity.entityType) ? (
              <EntityIcon
                entityType={
                  (entity.displayIconEntityType ??
                    entity.entityType) as EntityType
                }
                size={isCompact ? 16 : 18}
                sx={{ borderRadius: "4px" }}
              />
            ) : null}
            <Typography
              data-testid={`${testId}-title`}
              sx={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontWeight: emphasis ? 700 : 600,
              }}
              variant={isCompact ? "body2" : "subtitle2"}
            >
              {entity.title}
            </Typography>
          </Box>
          {entity.entityType !== ActivityGanttDerivedEntityType.Report ? (
            <Chip
              data-testid={`${testId}-status`}
              color={
                contrastChips ? undefined : getStatusChipColor(entity.status)
              }
              label={getActivityGanttStatusLabel(entity.status)}
              size="small"
              sx={contrastChipSx}
            />
          ) : null}
        </Stack>

        {signals.length > 0 ? (
          <Stack direction="row" flexWrap="wrap" gap={0.75}>
            {signals.map((signalType) => (
              <Chip
                color={
                  contrastChips ? undefined : getSignalChipColor(signalType)
                }
                data-testid={`${testId}-signal-${signalType}`}
                key={`${testId}-${signalType}`}
                label={getActivityGanttRelationshipLabel(signalType)}
                size="small"
                variant="outlined"
                sx={contrastChipSx}
              />
            ))}
          </Stack>
        ) : null}

        {entity.progress ? (
          <Stack spacing={0.5}>
            <Stack direction="row" justifyContent="space-between" spacing={1}>
              <Typography
                data-testid={`${testId}-progress-label`}
                variant="caption"
              >
                Progress
              </Typography>
              <Typography
                data-testid={`${testId}-progress-value`}
                variant="caption"
              >
                {getProgressLabel(entity.progress)}
              </Typography>
            </Stack>
            <LinearProgress
              data-testid={`${testId}-progress-bar`}
              value={getActivityGanttProgressPercent(entity.progress)}
              variant="determinate"
            />
          </Stack>
        ) : null}

        {!isCompact ? (
          <Stack spacing={0.25}>
            <Typography
              color={contrastChips ? "inherit" : "text.secondary"}
              data-testid={`${testId}-duration`}
              sx={{
                fontSize: "0.75rem",
                textAlign: "left",
                ...(contrastChips ? { opacity: 0.85 } : {}),
              }}
              variant="caption"
            >
              {entity.durationLabel}
            </Typography>
            {entity.detailText ? (
              <Typography
                color={contrastChips ? "inherit" : "text.secondary"}
                data-testid={`${testId}-detail`}
                variant="caption"
                sx={contrastChips ? { opacity: 0.85 } : undefined}
              >
                {entity.detailText}
              </Typography>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
      {canHover && hoverAnchor && organizationId && isHoverSupported ? (
        <EntityHoverCard
          entityId={entity.entityId}
          entityType={hoverEntityType}
          organizationId={organizationId}
          projectId={projectId}
          anchorEl={hoverAnchor}
          onPopoverMouseEnter={handlePopoverMouseEnter}
          onPopoverMouseLeave={handlePopoverMouseLeave}
        />
      ) : null}
    </Paper>
  );
};

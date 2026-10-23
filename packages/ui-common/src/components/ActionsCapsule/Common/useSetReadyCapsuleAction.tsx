/**
 * Hook for status transition CapsuleAction integration
 *
 * Provides status transition actions for work items based on current status:
 * - REFINING_ACCEPTANCE_CRITERIA → ACTIVE (Set Active)
 * - BACKLOG → ACTIVE (Set Active)
 * - ACTIVE → COMPLETE (Complete)
 * Works for both tasks and initiatives.
 */

import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import { WorkStatus } from "../../../api";
import type { UpdateTaskDto } from "../../../api";
import { useWorkItems } from "../../../data/hooks/useWorkItems";
import {
  isTask,
  type WorkItemResponseDto,
} from "../../../data/collections/workItems";
import { useActionsCapsule } from "../ActionsCapsuleContext";
import { KEYS } from "../../../i18n/keys";
import type { Stable } from "../../../types";

/**
 * Describes a status transition: from → to
 */
export interface StatusTransition {
  from: WorkStatus;
  to: WorkStatus;
  actionId: string;
}

/**
 * Props for useSetReadyCapsuleAction hook
 */
export interface UseSetReadyCapsuleActionProps {
  /** Work item (task or initiative) to update */
  workItem: WorkItemResponseDto;
  /** Organization ID for API calls */
  organizationId: string;
  /** Project ID for API calls */
  projectId: string;
  /** Custom action ID overrides (uses automatic determination by default) */
  actionIds?: Record<string, string>;
  /** Custom labels (uses i18n by default) */
  labels?: Record<string, string>;
  /** Custom titles (uses i18n by default) */
  titles?: Record<string, string>;
  /** Callback after successful status update */
  onSuccess?: Stable<() => void>;
  /** Callback on error */
  onError?: Stable<(error: Error) => void>;
  /** Renders additional UI inside the expand panel (e.g. selectors) */
  renderExtraContent?: Stable<() => React.ReactNode>;
  /** Returns extra fields merged into the task update payload at confirm time */
  getExtraUpdateFields?: Stable<() => Partial<UpdateTaskDto>>;
  /** Async side-effect called after the status PATCH succeeds */
  onAfterStatusUpdate?: Stable<() => Promise<void>>;
}

/**
 * Return type for useSetReadyCapsuleAction hook.
 * For set-ready and set-active: returns "click" when task already has
 * assignee + service (direct update), or "expand" when those are missing
 * (shows confirmation panel with selectors).
 */
export interface UseSetReadyCapsuleActionExpandResult {
  behavior: "expand";
  actionId: string;
  label: string;
  title: string;
  renderContent: Stable<() => React.ReactNode>;
  inProgress: boolean;
  resumable: boolean;
  expandable: boolean;
  disabled: boolean;
}

export interface UseSetReadyCapsuleActionClickResult {
  behavior: "click";
  actionId: string;
  label: string;
  onClick: Stable<() => void>;
  inProgress: boolean;
  disabled: boolean;
}

export type UseSetReadyCapsuleActionResult =
  | UseSetReadyCapsuleActionExpandResult
  | UseSetReadyCapsuleActionClickResult;

/**
 * Standard tasks: any refining/generating status moves to Backlog (Set Ready);
 * Backlog moves to Active (Set Active); Active moves to Completed (Complete).
 */
const REFINING_TO_BACKLOG_STATUSES: WorkStatus[] = [
  WorkStatus.RefiningDescription,
  WorkStatus.RefiningDetails,
  WorkStatus.RefiningAcceptanceCriteria,
  WorkStatus.GeneratingDescription,
  WorkStatus.GeneratingDetails,
  WorkStatus.GeneratingDescriptionAndDetails,
  WorkStatus.GeneratingAcceptanceCriteria,
  WorkStatus.GeneratingAll,
];

const STATUS_TRANSITIONS: Partial<Record<WorkStatus, StatusTransition>> =
  Object.fromEntries(
    REFINING_TO_BACKLOG_STATUSES.map((status) => [
      status,
      {
        from: status,
        to: WorkStatus.Backlog,
        actionId: "set-ready",
      } as StatusTransition,
    ])
  );

STATUS_TRANSITIONS[WorkStatus.Backlog] = {
  from: WorkStatus.Backlog,
  to: WorkStatus.Active,
  actionId: "set-active",
};

STATUS_TRANSITIONS[WorkStatus.Active] = {
  from: WorkStatus.Active,
  to: WorkStatus.Completed,
  actionId: "set-complete",
};

/**
 * Complete integration hook for status transition CapsuleAction registration.
 *
 * Handles status transitions based on current work item status:
 * - Tasks: REFINING_ACCEPTANCE_CRITERIA → BACKLOG (Set Ready), BACKLOG → ACTIVE, ACTIVE → COMPLETE
 * - Features: any REFINING/GENERATING status → ACTIVE (Set Ready); no further transitions
 * Works for both tasks and initiatives.
 *
 * Example:
 * ```tsx
 * const statusAction = useSetReadyCapsuleAction({
 *   workItem: task,
 *   organizationId,
 *   onSuccess: () => console.log('Status updated'),
 * });
 *
 * <CapsuleAction {...statusAction} />
 * ```
 */
export const useSetReadyCapsuleAction = (
  props: UseSetReadyCapsuleActionProps
): UseSetReadyCapsuleActionResult => {
  const {
    workItem,
    organizationId,
    projectId,
    actionIds,
    labels,
    titles,
    onSuccess,
    onError,
    renderExtraContent,
    getExtraUpdateFields,
    onAfterStatusUpdate,
  } = props;

  const { t } = useTranslation();
  const { collapseAction } = useActionsCapsule();
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Get update functions from the data layer
  const { updateTask } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    { enabled: false }
  );

  // Feature tasks follow a simple REFINING → READY (Active) flow only
  const isFeatureTask = isTask(workItem) && workItem.type === "FEATURE";

  // Determine which transition applies to the current status
  const transition = useMemo(() => {
    if (isFeatureTask) {
      const featureRefiningStatuses: WorkStatus[] = [
        WorkStatus.RefiningDescription,
        WorkStatus.RefiningDetails,
        WorkStatus.RefiningAcceptanceCriteria,
        WorkStatus.GeneratingDescription,
        WorkStatus.GeneratingDetails,
        WorkStatus.GeneratingDescriptionAndDetails,
        WorkStatus.GeneratingAcceptanceCriteria,
        WorkStatus.GeneratingAll,
      ];
      if (featureRefiningStatuses.includes(workItem.status)) {
        return {
          from: workItem.status,
          to: WorkStatus.Active,
          actionId: "set-ready",
        };
      }
      // Features have no further transitions once ready or archived
      return undefined;
    }
    return STATUS_TRANSITIONS[workItem.status];
  }, [workItem.status, isFeatureTask]);

  // Action is disabled if no transition is available (e.g., Complete status)
  const disabled = !transition || transition.actionId === "";

  // For "set-ready" / "set-active", skip expand panel when task has assignee + service
  const canDirectUpdate = useMemo(() => {
    if (
      transition?.actionId !== "set-ready" &&
      transition?.actionId !== "set-active"
    )
      return false;
    if (!isTask(workItem)) return false;
    const hasAssignee = !!workItem.assigneeId;
    const hasService =
      !!workItem.serviceRelations && workItem.serviceRelations.length > 0;
    return hasAssignee && hasService;
  }, [transition, workItem]);

  // Resolve label and title from custom overrides or i18n
  const resolveLabel = useCallback((): string => {
    if (labels && transition) {
      return labels[transition.actionId] || "";
    }

    switch (transition?.actionId) {
      case "set-ready":
        return t(KEYS.workItems.actions.setReady);
      case "set-active":
        return t(KEYS.workItems.actions.setActive);
      case "set-complete":
        return t(KEYS.workItems.actions.setComplete);
      default:
        return "";
    }
  }, [labels, t, transition]);

  const resolveTitle = useCallback((): string => {
    if (titles && transition) {
      return titles[transition.actionId] || "";
    }

    switch (transition?.actionId) {
      case "set-ready":
        return t(KEYS.workItems.actions.setReadyTitle);
      case "set-active":
        return t(KEYS.workItems.actions.setActiveTitle);
      case "set-complete":
        return t(KEYS.workItems.actions.setCompleteTitle);
      default:
        return "";
    }
  }, [t, titles, transition]);

  const resolveActionId = (): string => {
    if (actionIds && transition) {
      return actionIds[transition.actionId] || transition.actionId;
    }
    return transition?.actionId || "";
  };

  // Handle status update
  const handleStatusTransition = useCallback(async (): Promise<void> => {
    if (!transition) return;

    setIsUpdating(true);
    setError(null);

    try {
      const extraFields = getExtraUpdateFields?.() ?? {};
      await updateTask(
        workItem.id,
        { status: transition.to, ...extraFields },
        {
          onError: (err) => {
            onError?.(err);
            setError(err.message);
          },
        }
      );
      if (onAfterStatusUpdate) {
        await onAfterStatusUpdate();
      }
      onSuccess?.();
      collapseAction();
    } catch (err) {
      const error = err as Error;
      onError?.(error);
      setError(error.message);
    } finally {
      setIsUpdating(false);
    }
  }, [
    transition,
    workItem,
    updateTask,
    onSuccess,
    onError,
    collapseAction,
    getExtraUpdateFields,
    onAfterStatusUpdate,
  ]);

  // Render the confirmation UI
  const renderContent = useCallback((): React.ReactNode => {
    if (!transition) {
      return (
        <Box sx={{ p: 2 }}>
          <Typography color="text.secondary">
            No status transition available
          </Typography>
        </Box>
      );
    }

    const getStatusLabel = (status: WorkStatus): string => {
      if (isFeatureTask && status === WorkStatus.Active) return "Ready";
      switch (status) {
        case WorkStatus.RefiningAcceptanceCriteria:
          return t(KEYS.workItems.status.refiningAcceptanceCriteria);
        case WorkStatus.Backlog:
          return t(KEYS.workItems.status.ready) || "Backlog";
        case WorkStatus.Active:
          return t(KEYS.workItems.status.active) || "Active";
        case WorkStatus.Completed:
          return t(KEYS.workItems.status.completed) || "Completed";
        default:
          return status;
      }
    };

    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          {resolveTitle()}
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {transition.actionId === "set-ready"
            ? t(KEYS.workItems.actions.setBacklogDescription)
            : transition.actionId === "set-active"
            ? t(KEYS.workItems.actions.setActiveDescription)
            : `Update to ${getStatusLabel(transition.to)}`}
        </Typography>

        {/* Current status */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t(KEYS.workItems.status.current)}
          </Typography>
          <Typography variant="body1">
            {getStatusLabel(transition.from)}
          </Typography>
        </Box>

        {/* Target status */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" color="text.secondary">
            {t(KEYS.workItems.status.newStatus)}
          </Typography>
          <Typography variant="body1" color="primary">
            {getStatusLabel(transition.to)}
          </Typography>
        </Box>

        {/* Extra content for set-ready/set-active (e.g. assignee/service selectors) */}
        {(transition.actionId === "set-ready" ||
          transition.actionId === "set-active") &&
          renderExtraContent && (
            <Box sx={{ mb: 2 }}>{renderExtraContent()}</Box>
          )}

        {/* Error display */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Action buttons */}
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button onClick={() => collapseAction()} disabled={isUpdating}>
            {t(KEYS.common.cancel)}
          </Button>
          <Button
            variant="contained"
            onClick={handleStatusTransition}
            disabled={isUpdating}
            startIcon={isUpdating ? <CircularProgress size={16} /> : undefined}
          >
            {isUpdating ? t(KEYS.common.processing) : resolveLabel()}
          </Button>
        </Box>
      </Box>
    );
  }, [
    t,
    error,
    isUpdating,
    handleStatusTransition,
    collapseAction,
    transition,
    resolveTitle,
    resolveLabel,
    renderExtraContent,
  ]);

  // Direct click when task already has assignee + service
  if (canDirectUpdate) {
    return {
      behavior: "click" as const,
      actionId: resolveActionId(),
      label: resolveLabel(),
      onClick: handleStatusTransition,
      inProgress: isUpdating,
      disabled,
    };
  }

  return {
    behavior: "expand" as const,
    actionId: resolveActionId(),
    label: resolveLabel(),
    title: resolveTitle(),
    renderContent,
    inProgress: isUpdating,
    resumable: false,
    expandable: false,
    disabled,
  };
};

import {
  CapsuleAction,
  useActionsCapsule,
  useSetReadyCapsuleAction,
  AssigneeSelector,
  ServiceSelector,
  useWorkItemUnsavedChanges,
} from "@hey-hey/ui-common/components";
import { unifiedApiClient } from "@hey-hey/ui-common/clients";
import ReadyIcon from "@mui/icons-material/CheckCircleOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";
import { keyframes } from "@mui/material/styles";
import type { TaskResponseDto, UpdateTaskDto } from "@hey-hey/ui-common/api";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import React from "react";

const statusActionPulse = keyframes`
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.08);
    opacity: 0.86;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const SET_READY_LABELS = {
  "set-ready": "Set Ready",
  "set-active": "To Active",
  "set-complete": "Complete",
} as const;

const SET_READY_TITLES = {
  "set-ready": "Set Ready",
  "set-active": "Start Task",
  "set-complete": "Complete Task",
} as const;

export const SetReadyActionCapsule = ({
  organizationId,
  projectId,
  task,
  pulse = false,
}: {
  organizationId: string;
  projectId: string;
  task: TaskResponseDto;
  pulse?: boolean;
}) => {
  const initialServiceIds = useMemo(
    () => task.serviceRelations?.map((relation) => relation.serviceId) ?? [],
    [task.serviceRelations],
  );

  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string | null>(
    task.assigneeId ?? null,
  );
  const [selectedServiceIds, setSelectedServiceIds] =
    useState<string[]>(initialServiceIds);

  // Sync state once when serviceRelations first loads (it's undefined on the
  // initial render when the detail query is still in flight).
  const serviceRelationsLoadedRef = useRef(task.serviceRelations !== undefined);
  useEffect(() => {
    if (!serviceRelationsLoadedRef.current && task.serviceRelations !== undefined) {
      serviceRelationsLoadedRef.current = true;
      setSelectedServiceIds(task.serviceRelations.map((r) => r.serviceId));
    }
  }, [task.serviceRelations]);

  // Refs so stable callbacks read latest state without being in deps
  const assigneeRef = useRef(selectedAssigneeId);
  assigneeRef.current = selectedAssigneeId;
  const serviceIdsRef = useRef(selectedServiceIds);
  serviceIdsRef.current = selectedServiceIds;

  const renderExtraContent = useCallback((): React.ReactNode => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <AssigneeSelector
        organizationId={organizationId}
        value={selectedAssigneeId}
        onChange={setSelectedAssigneeId}
        fullWidth
        size="small"
        enableAssignToMe
      />
      <ServiceSelector
        organizationId={organizationId}
        projectId={projectId}
        multiple
        value={selectedServiceIds}
        onChange={(ids) => setSelectedServiceIds(ids)}
        fullWidth
        size="small"
      />
    </Box>
  ), [organizationId, projectId, selectedAssigneeId, selectedServiceIds]);

  const getExtraUpdateFields = useCallback(
    (): Partial<UpdateTaskDto> => ({
      assigneeId: assigneeRef.current ?? undefined,
    }),
    [],
  );

  const onAfterStatusUpdate = useCallback(async (): Promise<void> => {
    const alreadyLinked = new Set(
      task.serviceRelations?.map((relation) => relation.serviceId) ?? [],
    );
    const newServiceIds = serviceIdsRef.current.filter(
      (serviceId) => !alreadyLinked.has(serviceId),
    );
    if (!newServiceIds.length) return;
    await Promise.all(
      newServiceIds.map((serviceId) =>
        unifiedApiClient.client.createServiceLink(
          {
            organizationId,
            serviceId,
            serviceLinkDto: { entityType: "task", entityId: task.id },
          },
        ),
      ),
    );
  }, [organizationId, task.id, task.serviceRelations]);

  const setReadyAction = useSetReadyCapsuleAction({
    workItem: task,
    organizationId,
    projectId,
    labels: SET_READY_LABELS,
    titles: SET_READY_TITLES,
    renderExtraContent,
    getExtraUpdateFields,
    onAfterStatusUpdate,
  });

  const isStartAction = setReadyAction.actionId === "set-active";
  const iconStyle = useMemo<CSSProperties | undefined>(
    () =>
      pulse
        ? {
            backgroundColor: isStartAction ? "#0A7A55" : "#0E7490",
            color: "#fff",
            animation: `${statusActionPulse} 1.8s ease-in-out infinite`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transformOrigin: "center center",
            width: "40px",
            height: "40px",
            boxSizing: "border-box",
          }
        : undefined,
    [pulse, isStartAction],
  );

  const unsavedChanges = useWorkItemUnsavedChanges();
  const { expandAction } = useActionsCapsule();
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [isResolvingUnsaved, setIsResolvingUnsaved] = useState(false);

  const capsuleId = `${setReadyAction.actionId}-task-${task.id}`;
  const shouldGuardUnsaved =
    isStartAction && !!unsavedChanges?.hasUnsavedChanges;

  const proceedWithAction = useCallback(() => {
    if (setReadyAction.behavior === "click") {
      setReadyAction.onClick();
      return;
    }
    expandAction(capsuleId);
  }, [setReadyAction, expandAction, capsuleId]);

  const handleSaveAndContinue = useCallback(async () => {
    if (!unsavedChanges) {
      return;
    }
    setIsResolvingUnsaved(true);
    try {
      const saved = await unsavedChanges.save();
      if (!saved) {
        return;
      }
      setUnsavedDialogOpen(false);
      proceedWithAction();
    } finally {
      setIsResolvingUnsaved(false);
    }
  }, [unsavedChanges, proceedWithAction]);

  const handleDiscardAndContinue = useCallback(() => {
    unsavedChanges?.discard();
    setUnsavedDialogOpen(false);
    proceedWithAction();
  }, [unsavedChanges, proceedWithAction]);

  const handleKeepEditing = useCallback(() => {
    if (isResolvingUnsaved) {
      return;
    }
    setUnsavedDialogOpen(false);
  }, [isResolvingUnsaved]);

  const handleGuardedClick = useCallback(() => {
    setUnsavedDialogOpen(true);
  }, []);

  if (setReadyAction.disabled) {
    return null;
  }

  const capsuleProps = shouldGuardUnsaved
    ? {
        behavior: "click" as const,
        actionId: setReadyAction.actionId,
        label: setReadyAction.label,
        onClick: handleGuardedClick,
        inProgress: setReadyAction.inProgress,
        disabled: setReadyAction.disabled,
      }
    : setReadyAction;

  return (
    <>
      <CapsuleAction
        id={capsuleId}
        {...capsuleProps}
        actionGroup="page"
        tier="page"
        order={101}
        icon={isStartAction ? PlayArrowIcon : ReadyIcon}
        iconStyle={iconStyle}
      />
      <Dialog
        open={unsavedDialogOpen}
        onClose={handleKeepEditing}
        aria-labelledby="set-active-unsaved-dialog-title"
        aria-describedby="set-active-unsaved-dialog-description"
        data-testid="set-active-unsaved-dialog"
      >
        <DialogTitle id="set-active-unsaved-dialog-title">
          Save before continuing?
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="set-active-unsaved-dialog-description">
            You have unsaved edits. Save them before marking this task as
            active?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleKeepEditing}
            disabled={isResolvingUnsaved}
            data-testid="set-active-unsaved-keep-editing"
          >
            Keep editing
          </Button>
          <Button
            onClick={handleDiscardAndContinue}
            color="warning"
            disabled={isResolvingUnsaved}
            data-testid="set-active-unsaved-discard"
          >
            Discard &amp; continue
          </Button>
          <Button
            onClick={handleSaveAndContinue}
            variant="contained"
            disabled={isResolvingUnsaved}
            data-testid="set-active-unsaved-save"
          >
            {isResolvingUnsaved ? "Saving..." : "Save & continue"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

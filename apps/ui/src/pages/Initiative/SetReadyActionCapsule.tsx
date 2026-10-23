import { CapsuleAction } from "@hey-hey/ui-common/components";
import ReadyIcon from "@mui/icons-material/CheckCircleOutline";
import {
  WorkStatus,
  type InitiativeResponseDto,
} from "@hey-hey/ui-common/api";
import { useCallback, useState } from "react";

const SET_READY_LABELS = {
  "set-ready": "To Backlog",
  "set-active": "Start",
  "set-complete": "Complete",
} as const;

const SET_READY_TITLES = {
  "set-ready": "Move to Backlog",
  "set-active": "Start Initiative",
  "set-complete": "Complete Initiative",
} as const;

export const SetReadyActionCapsule = ({
  initiative,
  onStatusChange,
  disabled = false,
}: {
  initiative: InitiativeResponseDto;
  onStatusChange: (status: WorkStatus) => Promise<void>;
  disabled?: boolean;
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const transition = (() => {
    switch (initiative.status) {
      case WorkStatus.RefiningDescription:
      case WorkStatus.RefiningDetails:
      case WorkStatus.RefiningAcceptanceCriteria:
      case WorkStatus.GeneratingDescription:
      case WorkStatus.GeneratingDetails:
      case WorkStatus.GeneratingDescriptionAndDetails:
      case WorkStatus.GeneratingAcceptanceCriteria:
      case WorkStatus.GeneratingAll:
        return { actionId: "set-ready", status: WorkStatus.Backlog } as const;
      case WorkStatus.Backlog:
        return { actionId: "set-active", status: WorkStatus.Active } as const;
      case WorkStatus.Active:
        return {
          actionId: "set-complete",
          status: WorkStatus.Completed,
        } as const;
      default:
        return undefined;
    }
  })();

  const handleClick = useCallback(async () => {
    if (!transition) return;

    setIsUpdating(true);
    try {
      await onStatusChange(transition.status);
    } finally {
      setIsUpdating(false);
    }
  }, [onStatusChange, transition]);

  if (!transition) {
    return null;
  }

  return (
    <CapsuleAction
      id={`set-initiative-ready-${initiative.id}`}
      behavior="click"
      label={SET_READY_LABELS[transition.actionId]}
      title={SET_READY_TITLES[transition.actionId]}
      onClick={handleClick}
      inProgress={isUpdating}
      disabled={disabled || isUpdating}
      actionGroup="page"
      tier="page"
      order={99}
      icon={ReadyIcon}
    />
  );
};

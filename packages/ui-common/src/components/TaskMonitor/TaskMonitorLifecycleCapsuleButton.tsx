import { useCallback } from "react";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useCapsuleScreenButton } from "../ActionsCapsule/useCapsuleScreenButton";
import { useOptionalActionsCapsule } from "../ActionsCapsule/ActionsCapsuleContext";
import type { TaskMonitorStartPresentation } from "./taskMonitorStartPresentation";
import type { TaskMonitorPauseResumeAction } from "./useTaskMonitorPauseResume";

export interface TaskMonitorLifecycleAvailability {
  setup: boolean;
  start: boolean;
  pause: boolean;
  /** True when the last committed snapshot advertises Pause, even if now stale. */
  showsPause: boolean;
}

interface Props {
  monitorId: string;
  availability: TaskMonitorLifecycleAvailability;
  pendingLifecycleAction: TaskMonitorPauseResumeAction | null;
  startPresentation: TaskMonitorStartPresentation;
  /** True while the coordinator is being bound to the selected machine. */
  binding: boolean;
  /** Setup prerequisites that are not met, such as no machine selected. */
  controlsDisabled: boolean;
  onStart: () => void;
  onPause: () => void;
}

function disabledReason({
  pending,
  controlsDisabled,
  advertised,
}: {
  pending: boolean;
  controlsDisabled: boolean;
  advertised: boolean;
}): string | undefined {
  if (pending) {
    return "Waiting for the monitor to confirm the command.";
  }
  if (controlsDisabled) {
    return "Not ready to start. The Task Monitor pane says what is missing.";
  }
  if (!advertised) {
    return "The monitor is not offering this action right now.";
  }
  return undefined;
}

export type TaskMonitorLifecycleButtonInput = Pick<
  Props,
  | "availability"
  | "pendingLifecycleAction"
  | "startPresentation"
  | "binding"
  | "controlsDisabled"
>;

/**
 * Whether the lifecycle button shows Pause or Start and whether it can be
 * pressed. Every Start button in the workspace reads this one answer, so they
 * can never disagree.
 */
export function resolveTaskMonitorLifecycleButton({
  availability,
  pendingLifecycleAction,
  startPresentation,
  binding,
  controlsDisabled,
}: TaskMonitorLifecycleButtonInput) {
  const pausing = availability.showsPause;
  const advertised = pausing ? availability.pause : availability.start;
  const pending =
    binding ||
    startPresentation.status === "starting" ||
    pendingLifecycleAction !== null;

  return {
    pausing,
    advertised,
    pending,
    disabled: !advertised || controlsDisabled || pending,
  };
}

function RegisteredLifecycleButton({
  monitorId,
  onStart,
  onPause,
  ...input
}: Props) {
  const { pausing, advertised, pending, disabled } =
    resolveTaskMonitorLifecycleButton(input);
  const { controlsDisabled } = input;
  const label = pausing ? "Pause" : "Start";
  const handleClick = useCallback(() => {
    if (pausing) {
      onPause();
      return;
    }
    onStart();
  }, [pausing, onPause, onStart]);

  useCapsuleScreenButton({
    key: `task-monitor-lifecycle:${monitorId}`,
    label,
    icon: pausing ? PauseIcon : PlayArrowIcon,
    accessibleName: label,
    tooltip: disabled
      ? disabledReason({ pending, controlsDisabled, advertised })
      : `${label} the Task Monitor`,
    disabled,
    pending,
    keepMenuOpen: true,
    onClick: handleClick,
  });
  return null;
}

export function TaskMonitorLifecycleCapsuleButton(props: Props) {
  const capsule = useOptionalActionsCapsule();
  return capsule ? <RegisteredLifecycleButton {...props} /> : null;
}

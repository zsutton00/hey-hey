import { useCallback } from "react";
import { useCapsuleScreenButton } from "../ActionsCapsule/useCapsuleScreenButton";
import { useOptionalActionsCapsule } from "../ActionsCapsule/ActionsCapsuleContext";
import type { CapsuleScreenButton } from "../ActionsCapsule/types";
import type { MonitorPhase } from "./useTaskMonitorPresentation";

interface Props {
  monitorId: string;
  name: string;
  progress: string;
  phase: MonitorPhase;
  freshness: string;
  onOpen: () => void;
}

function RegisteredMonitorButton({
  monitorId,
  name,
  progress,
  phase,
  freshness,
  onOpen,
}: Props) {
  const handleClick = useCallback(() => onOpen(), [onOpen]);
  const state: NonNullable<CapsuleScreenButton["status"]>["state"] =
    Boolean(freshness) ||
    phase === "attention" ||
    phase === "halted" ||
    phase === "unknown"
      ? "needs-you"
      : phase === "done"
        ? "done"
        : phase === "paused"
          ? "paused"
          : "running";
  useCapsuleScreenButton({
    key: `task-monitor:${monitorId}`,
    label: freshness ? "Stale" : "TM",
    accessibleName: `${name}: ${phase}, ${progress}${freshness ? `, ${freshness}` : ""}. Open Task Monitor`,
    status: { state, text: progress },
    onClick: handleClick,
  });
  return null;
}

export function TaskMonitorCapsuleButton(props: Props) {
  const capsule = useOptionalActionsCapsule();
  return capsule ? <RegisteredMonitorButton {...props} /> : null;
}

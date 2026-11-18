import { useCallback, useEffect, useState } from "react";
import type { TaskMonitorStateProjection } from "../../api";

export type MonitorPhase =
  "setup" | "running" | "paused" | "attention" | "done" | "halted" | "unknown";
export type MonitorPane = "steps" | "monitor" | "session";

export function monitorPhase(
  snapshot: TaskMonitorStateProjection | null,
  initialSetup: boolean,
): MonitorPhase {
  if (!snapshot) {
    return initialSetup ? "setup" : "unknown";
  }
  const { execution, failure } = snapshot;
  if (execution.lifecycle === "COMPLETED") {
    return "done";
  }
  if (execution.lifecycle === "HALTED") {
    return "halted";
  }
  if (execution.lifecycle === "ABSENT") {
    return initialSetup ? "setup" : "unknown";
  }
  if (
    failure ||
    execution.intervention === "PENDING" ||
    execution.intervention === "APPLICATION_FAILED" ||
    execution.intervention === "APPLICATION_STALE" ||
    execution.intervention === "APPLICATION_UNCERTAIN" ||
    execution.work === "LAUNCH_JUDGMENT" ||
    execution.work === "OUTCOME_JUDGMENT"
  ) {
    return "attention";
  }
  if (execution.control === "PAUSED" || execution.control === "PAUSING") {
    return "paused";
  }
  return "running";
}

const defaultPanes = (phase: MonitorPhase): Record<MonitorPane, boolean> => ({
  steps: true,
  monitor: phase === "setup" || phase === "unknown",
  session: phase !== "setup" && phase !== "done",
});

/** Only viewing preferences are retained here; canonical status stays live. */
export function useTaskMonitorPresentation(
  phase: MonitorPhase,
  composing: boolean,
  initialPane: MonitorPane = "monitor",
) {
  const [presentation, setPresentation] = useState<{
    phase: MonitorPhase;
    panes: Record<MonitorPane, boolean>;
    compactPane: MonitorPane;
  }>(() => ({
    phase,
    panes: defaultPanes(phase),
    compactPane: phase === "setup" ? "monitor" : initialPane,
  }));

  useEffect(() => {
    if (composing) {
      return;
    }
    setPresentation((previous) => {
      if (phase === "unknown" || previous.phase === phase) {
        return previous;
      }
      // Attention is a signal only. Never reopen or resize on its arrival.
      if (phase === "attention") {
        if (previous.phase === "setup") {
          return {
            phase,
            panes: defaultPanes("running"),
            compactPane: "session",
          };
        }
        return { ...previous, phase };
      }
      return {
        phase,
        panes: defaultPanes(phase),
        compactPane:
          phase === "done"
            ? "steps"
            : phase === "setup"
              ? "monitor"
              : "session",
      };
    });
  }, [phase, composing]);

  const openPane = useCallback(
    (pane: MonitorPane) =>
      setPresentation((previous) => ({
        ...previous,
        phase,
        compactPane: pane,
        panes:
          pane === "monitor" && phase !== "setup"
            ? { steps: false, monitor: true, session: true }
            : { ...previous.panes, [pane]: true },
      })),
    [phase],
  );
  const closePane = useCallback(
    (pane: MonitorPane) =>
      setPresentation((previous) => {
        const panes =
          pane === "monitor"
            ? { ...defaultPanes(phase), monitor: false }
            : { ...previous.panes, [pane]: false };
        if (!panes.steps && !panes.monitor && !panes.session) {
          panes.steps = true;
        }
        const compactPane = panes.session
          ? "session"
          : panes.monitor
            ? "monitor"
            : "steps";
        return { phase, panes, compactPane };
      }),
    [phase],
  );

  return { ...presentation, openPane, closePane };
}

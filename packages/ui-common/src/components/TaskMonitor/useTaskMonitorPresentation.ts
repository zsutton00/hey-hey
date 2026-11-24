import { useCallback, useEffect, useState } from "react";
import type { TaskMonitorStateProjection } from "../../api";

export type MonitorPhase =
  "setup" | "running" | "paused" | "attention" | "done" | "halted" | "unknown";
export type MonitorPane = "steps" | "monitor" | "session";

/** Panes always appear in this order. */
export const MONITOR_PANES: readonly MonitorPane[] = [
  "steps",
  "monitor",
  "session",
];

/** The monitor waits on a person: a judgment or an intervention. */
export function monitorNeedsFeedback(
  snapshot: TaskMonitorStateProjection,
): boolean {
  const { execution } = snapshot;

  return (
    execution.intervention === "PENDING" ||
    execution.intervention === "APPLICATION_FAILED" ||
    execution.intervention === "APPLICATION_STALE" ||
    execution.intervention === "APPLICATION_UNCERTAIN" ||
    execution.work === "LAUNCH_JUDGMENT" ||
    execution.work === "OUTCOME_JUDGMENT"
  );
}

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
  if (failure || monitorNeedsFeedback(snapshot)) {
    return "attention";
  }
  if (execution.control === "PAUSED" || execution.control === "PAUSING") {
    return "paused";
  }
  return "running";
}

type Panes = Record<MonitorPane, boolean>;

interface PresentationState {
  /** The phase whose layout is applied; it lags the live phase while composing. */
  phase: MonitorPhase;
  /** Wide-screen choices; each pane is shown or hidden on its own. */
  panes: Panes;
  /** Narrow-screen choice; exactly one pane is shown. */
  compactPane: MonitorPane;
  /** Whether Active Session is offered, applied with the rest of the layout. */
  sessionOffered: boolean;
  /** The task list's state before opening guidance collapsed it. */
  stepsBeforeGuidance: boolean | null;
}

const defaultPanes = (phase: MonitorPhase): Panes => ({
  steps: true,
  monitor: phase === "setup" || phase === "unknown",
  session: phase !== "setup" && phase !== "done",
});

const defaultCompactPane = (phase: MonitorPhase): MonitorPane => {
  if (phase === "setup" || phase === "unknown") {
    return "monitor";
  }
  if (phase === "done") {
    return "steps";
  }
  return "session";
};

const layoutFor = (phase: MonitorPhase): PresentationState => ({
  phase,
  panes: defaultPanes(phase),
  compactPane: defaultCompactPane(phase),
  sessionOffered: false,
  stepsBeforeGuidance: null,
});

const offeredPanes = (state: PresentationState): MonitorPane[] =>
  MONITOR_PANES.filter((pane) => pane !== "session" || state.sessionOffered);

/** Wide-screen panes on screen; never empty. */
const visiblePanes = (state: PresentationState): MonitorPane[] => {
  const visible = offeredPanes(state).filter((pane) => state.panes[pane]);
  return visible.length > 0 ? visible : ["steps"];
};

const effectiveCompactPane = (state: PresentationState): MonitorPane =>
  offeredPanes(state).includes(state.compactPane) ? state.compactPane : "steps";

/**
 * Only viewing preferences are kept here; canonical status stays live.
 * Lifecycle changes reset the layout, except while the person is composing:
 * then they wait, and explicit pane and Capsule actions still apply.
 */
export function useTaskMonitorPresentation({
  phase,
  composing,
  sessionAvailable,
}: {
  phase: MonitorPhase;
  composing: boolean;
  sessionAvailable: boolean;
}) {
  const [state, setState] = useState<PresentationState>(() => ({
    ...layoutFor(phase),
    sessionOffered: sessionAvailable && phase !== "setup",
  }));

  useEffect(() => {
    if (composing) {
      return;
    }
    setState((previous) => {
      let next = previous;
      if (phase !== "unknown" && previous.phase !== phase) {
        // Attention is a signal only. Never reopen or resize on its arrival.
        if (phase === "attention") {
          next =
            previous.phase === "setup"
              ? { ...layoutFor("running"), phase }
              : { ...previous, phase };
        } else {
          next = layoutFor(phase);
        }
      }
      const sessionOffered = sessionAvailable && next.phase !== "setup";
      return next.sessionOffered === sessionOffered
        ? next
        : { ...next, sessionOffered };
    });
  }, [phase, composing, sessionAvailable]);

  const openMonitor = useCallback(
    () =>
      setState((previous) => {
        // Opening a pending request puts the monitor beside the session and
        // collapses the task list to its rail.
        const guidance = phase === "attention" && previous.sessionOffered;
        if (!guidance) {
          return {
            ...previous,
            compactPane: "monitor",
            panes: { ...previous.panes, monitor: true },
          };
        }
        return {
          ...previous,
          compactPane: "monitor",
          panes: { steps: false, monitor: true, session: true },
          stepsBeforeGuidance:
            previous.stepsBeforeGuidance ?? previous.panes.steps,
        };
      }),
    [phase],
  );

  const dockMonitor = useCallback(
    () =>
      setState((previous) => {
        const panes: Panes = {
          ...previous.panes,
          monitor: false,
          steps: previous.stepsBeforeGuidance ?? previous.panes.steps,
        };
        const docked: PresentationState = {
          ...previous,
          panes,
          stepsBeforeGuidance: null,
        };
        if (!offeredPanes(docked).some((pane) => panes[pane])) {
          panes.steps = true;
        }
        if (previous.compactPane === "monitor") {
          docked.compactPane = defaultCompactPane(previous.phase);
        }
        return docked;
      }),
    [],
  );

  const showWidePanes = useCallback(
    (next: readonly MonitorPane[]) => {
      const visible = visiblePanes(state);
      const changed = MONITOR_PANES.find(
        (pane) => visible.includes(pane) !== next.includes(pane),
      );
      if (!changed) {
        return;
      }
      const shown = next.includes(changed);
      if (changed === "monitor") {
        if (shown) {
          openMonitor();
        } else {
          dockMonitor();
        }
        return;
      }
      setState((previous) => {
        const panes = { ...previous.panes, [changed]: shown };
        const remaining = MONITOR_PANES.filter(
          (pane) => offeredPanes(previous).includes(pane) && panes[pane],
        );
        const compactPane = shown
          ? changed
          : previous.compactPane === changed
            ? (remaining.at(-1) ?? "steps")
            : previous.compactPane;
        return {
          ...previous,
          panes,
          compactPane,
          stepsBeforeGuidance:
            changed === "steps" ? null : previous.stepsBeforeGuidance,
        };
      });
    },
    [state, openMonitor, dockMonitor],
  );

  const showCompactPane = useCallback(
    (pane: MonitorPane) => {
      if (pane === "monitor") {
        openMonitor();
        return;
      }
      // Choosing another pane on a narrow screen docks the monitor.
      dockMonitor();
      setState((previous) => ({ ...previous, compactPane: pane }));
    },
    [openMonitor, dockMonitor],
  );

  /** Choosing a task shows its session alongside whatever else is open. */
  const revealSession = useCallback(
    () =>
      setState((previous) =>
        previous.sessionOffered
          ? {
              ...previous,
              compactPane: "session",
              panes: { ...previous.panes, session: true },
            }
          : previous,
      ),
    [],
  );

  const visible = visiblePanes(state);

  return {
    phase: state.phase,
    offered: offeredPanes(state),
    visible,
    compactPane: effectiveCompactPane(state),
    monitorOpen: visible.includes("monitor"),
    openMonitor,
    dockMonitor,
    showWidePanes,
    showCompactPane,
    revealSession,
  };
}

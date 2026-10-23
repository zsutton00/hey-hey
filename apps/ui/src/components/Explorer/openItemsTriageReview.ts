/**
 * One transient Open Items triage review: help → resolving → session
 * (running ↔ results), and Run Again back through resolving to a new session,
 * plus the close gates every dismissal path goes through.
 * A review lives for exactly one modal opening; reopening starts a new one.
 * The mode and guidance chosen at Run belong to the review: Run Again and Try
 * again reuse them, so every phase after help carries them.
 */

import type { OpenItemsTriageRunOptions } from "@hey-hey/ui-common/components";

export type TriageActivity = "running" | "results";

type TriageReviewPhase =
  | { kind: "help" }
  | { kind: "resolving"; options: OpenItemsTriageRunOptions }
  | {
      kind: "resolveError";
      message: string;
      options: OpenItemsTriageRunOptions;
    }
  | {
      kind: "session";
      options: OpenItemsTriageRunOptions;
      agentSessionId: string;
      activity: TriageActivity;
      /** Authoritative: a request is pending or the run is active. */
      runActive: boolean;
    };

export type TriageCloseGate =
  | { kind: "none" }
  | { kind: "confirmDiscard" }
  | { kind: "confirmCancel" }
  /** Stop submitted; `admitted` once the platform accepted it. */
  | { kind: "stopping"; admitted: boolean }
  | { kind: "stopFailed"; message: string };

export interface TriageReviewState {
  phase: TriageReviewPhase;
  gate: TriageCloseGate;
  /**
   * Request message ids this review submitted (the current fresh pass and its
   * follow-ups) — the only requests whose replies it may render.
   */
  requestMessageIds: readonly string[];
  closed: boolean;
}

export type TriageReviewEvent =
  /** The start screen's Tidy up / Spring cleaning with the typed guidance. */
  | { type: "run"; options: OpenItemsTriageRunOptions }
  /** Run Again and Try again: a new session with the review's own options. */
  | { type: "rerun" }
  | { type: "resolved"; agentSessionId: string }
  | { type: "resolveFailed"; message: string }
  /** The resolved session could not be loaded or has no conversation. */
  | { type: "sessionFailed"; message: string }
  | { type: "freshPassSubmitted"; messageId: string }
  | { type: "followUpSubmitted"; messageId: string }
  | { type: "activity"; activity: TriageActivity; runActive: boolean }
  | { type: "requestClose" }
  | { type: "keepReviewing" }
  | { type: "confirmClose" }
  | { type: "stopAdmitted" }
  | { type: "stopFailed"; message: string };

export type TriageStopResult = { ok: true } | { ok: false; error: string };

export const initialTriageReview: TriageReviewState = {
  phase: { kind: "help" },
  gate: { kind: "none" },
  requestMessageIds: [],
  closed: false,
};

const close = (state: TriageReviewState): TriageReviewState => ({
  ...state,
  gate: { kind: "none" },
  closed: true,
});

function reduceActivity(
  state: TriageReviewState,
  activity: TriageActivity,
  runActive: boolean,
): TriageReviewState {
  if (state.phase.kind !== "session") return state;
  const next = { ...state, phase: { ...state.phase, activity, runActive } };
  switch (state.gate.kind) {
    case "stopping":
      // Closing waits for authoritative state, never the stop request alone.
      return state.gate.admitted && !runActive ? close(next) : next;
    case "confirmCancel":
    case "stopFailed":
      // The run finished on its own: closing now discards results instead.
      return activity === "results" && !runActive
        ? { ...next, gate: { kind: "confirmDiscard" } }
        : next;
    default:
      return next;
  }
}

export function reduceTriageReview(
  state: TriageReviewState,
  event: TriageReviewEvent,
): TriageReviewState {
  if (state.closed) return state;
  switch (event.type) {
    case "run":
      return state.phase.kind === "help"
        ? {
            ...state,
            phase: { kind: "resolving", options: event.options },
            requestMessageIds: [],
          }
        : state;
    case "rerun":
      // Run Again creates a new session; it is only admitted once the current
      // session's run has finished.
      return state.phase.kind === "resolveError" ||
        (state.phase.kind === "session" &&
          !state.phase.runActive &&
          state.phase.activity === "results" &&
          state.gate.kind === "none")
        ? {
            ...state,
            phase: { kind: "resolving", options: state.phase.options },
            requestMessageIds: [],
          }
        : state;
    case "resolved":
      return state.phase.kind === "resolving"
        ? {
            ...state,
            phase: {
              kind: "session",
              options: state.phase.options,
              agentSessionId: event.agentSessionId,
              activity: "running",
              runActive: false,
            },
          }
        : state;
    case "resolveFailed":
      return state.phase.kind === "resolving"
        ? {
            ...state,
            phase: {
              kind: "resolveError",
              message: event.message,
              options: state.phase.options,
            },
          }
        : state;
    case "sessionFailed":
      return state.phase.kind === "session"
        ? {
            ...state,
            phase: {
              kind: "resolveError",
              message: event.message,
              options: state.phase.options,
            },
            gate: { kind: "none" },
          }
        : state;
    case "freshPassSubmitted":
      // A fresh pass (Run or Run Again) replaces the review's correlation set.
      return { ...state, requestMessageIds: [event.messageId] };
    case "followUpSubmitted":
      return {
        ...state,
        requestMessageIds: [...state.requestMessageIds, event.messageId],
      };
    case "activity":
      return reduceActivity(state, event.activity, event.runActive);
    case "requestClose":
      switch (state.gate.kind) {
        case "stopping":
          return state;
        case "confirmDiscard":
        case "confirmCancel":
        case "stopFailed":
          // Dismissing a confirmation keeps the review.
          return { ...state, gate: { kind: "none" } };
        case "none":
          // Nothing submitted and nothing running: there is no review to lose.
          if (
            state.phase.kind !== "session" ||
            (!state.phase.runActive && state.requestMessageIds.length === 0)
          )
            return close(state);
          return {
            ...state,
            gate:
              state.phase.activity === "running"
                ? { kind: "confirmCancel" }
                : { kind: "confirmDiscard" },
          };
      }
      return state;
    case "keepReviewing":
      return state.gate.kind === "stopping"
        ? state
        : { ...state, gate: { kind: "none" } };
    case "confirmClose":
      if (state.gate.kind === "confirmDiscard") return close(state);
      if (
        state.gate.kind === "confirmCancel" ||
        state.gate.kind === "stopFailed"
      )
        return { ...state, gate: { kind: "stopping", admitted: false } };
      return state;
    case "stopAdmitted":
      if (state.gate.kind !== "stopping") return state;
      // An already-finished run is a no-op stop: close straight away.
      return state.phase.kind === "session" && state.phase.runActive
        ? { ...state, gate: { kind: "stopping", admitted: true } }
        : close(state);
    case "stopFailed":
      return state.gate.kind === "stopping"
        ? { ...state, gate: { kind: "stopFailed", message: event.message } }
        : state;
  }
}

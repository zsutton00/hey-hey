import { describe, expect, it } from "vitest";
import { OpenItemsTriageMode } from "@hey-hey/ui-common/api";
import type { OpenItemsTriageRunOptions } from "@hey-hey/ui-common/components";
import {
  initialTriageReview,
  reduceTriageReview,
  type TriageReviewEvent,
  type TriageReviewState,
} from "./openItemsTriageReview";

const options: OpenItemsTriageRunOptions = {
  mode: OpenItemsTriageMode.SpringCleaning,
  guidance: "Focus on stale bugs",
};
const run: TriageReviewEvent = { type: "run", options };

const play = (...events: TriageReviewEvent[]): TriageReviewState =>
  events.reduce(reduceTriageReview, initialTriageReview);

const running: TriageReviewEvent[] = [
  run,
  { type: "resolved", agentSessionId: "session" },
  { type: "freshPassSubmitted", messageId: "fresh" },
  { type: "activity", activity: "running", runActive: true },
];
const results: TriageReviewEvent[] = [
  ...running,
  { type: "activity", activity: "results", runActive: false },
];

describe("triage review lifecycle", () => {
  it("starts at help and only resolves on Run", () => {
    expect(initialTriageReview.phase).toEqual({ kind: "help" });
    expect(play(run).phase).toEqual({ kind: "resolving", options });
    expect(play(run, { type: "resolved", agentSessionId: "s" }).phase).toEqual({
      kind: "session",
      options,
      agentSessionId: "s",
      activity: "running",
      runActive: false,
    });
  });

  it("shows a resolve failure and allows Run to retry", () => {
    const failed = play(run, { type: "resolveFailed", message: "Nope" });
    expect(failed.phase).toEqual({
      kind: "resolveError",
      message: "Nope",
      options,
    });
    expect(reduceTriageReview(failed, { type: "rerun" }).phase).toEqual({
      kind: "resolving",
      options,
    });
  });

  it("keeps the mode and guidance chosen at Run through every later phase", () => {
    expect(
      play(
        ...results,
        { type: "rerun" },
        { type: "resolveFailed", message: "x" },
      ).phase,
    ).toMatchObject({ kind: "resolveError", options });
    expect(play(...results).phase).toMatchObject({ kind: "session", options });
  });

  it("admits the start screen's Run only from help", () => {
    const started = play(run);
    const other: TriageReviewEvent = {
      type: "run",
      options: { mode: OpenItemsTriageMode.TidyUp, guidance: "" },
    };
    expect(reduceTriageReview(started, other)).toBe(started);
  });

  it("ignores a resolution that lands outside resolving", () => {
    expect(play({ type: "resolved", agentSessionId: "late" }).phase.kind).toBe(
      "help",
    );
  });

  it("closes directly from help, resolving and resolve errors", () => {
    expect(play({ type: "requestClose" }).closed).toBe(true);
    expect(play(run, { type: "requestClose" }).closed).toBe(true);
    expect(
      play(
        run,
        { type: "resolveFailed", message: "x" },
        { type: "requestClose" },
      ).closed,
    ).toBe(true);
  });

  it("closes directly from a session that has not submitted or started anything", () => {
    expect(
      play(
        run,
        { type: "resolved", agentSessionId: "s" },
        { type: "requestClose" },
      ).closed,
    ).toBe(true);
  });

  it("asks to cancel while the first request is still being submitted", () => {
    expect(
      play(
        run,
        { type: "resolved", agentSessionId: "s" },
        { type: "activity", activity: "running", runActive: true },
        { type: "requestClose" },
      ).gate,
    ).toEqual({ kind: "confirmCancel" });
  });

  it("turns a session load failure into a retryable error", () => {
    const failed = play(
      run,
      { type: "resolved", agentSessionId: "s" },
      { type: "sessionFailed", message: "Gone" },
    );
    expect(failed.phase).toEqual({
      kind: "resolveError",
      message: "Gone",
      options,
    });
    expect(reduceTriageReview(failed, { type: "rerun" }).phase.kind).toBe(
      "resolving",
    );
  });

  it("replaces the correlation set on a fresh pass and extends it on follow-ups", () => {
    const state = play(...results, {
      type: "followUpSubmitted",
      messageId: "follow",
    });
    expect(state.requestMessageIds).toEqual(["fresh", "follow"]);
    expect(
      reduceTriageReview(state, {
        type: "freshPassSubmitted",
        messageId: "again",
      }).requestMessageIds,
    ).toEqual(["again"]);
  });

  it("runs again into a new session with no earlier-review requests, only once finished", () => {
    expect(reduceTriageReview(play(...running), { type: "rerun" })).toEqual(
      play(...running),
    );
    const again = play(
      ...results,
      { type: "rerun" },
      { type: "resolved", agentSessionId: "session-2" },
    );
    expect(again.phase).toEqual({
      kind: "session",
      options,
      agentSessionId: "session-2",
      activity: "running",
      runActive: false,
    });
    expect(again.requestMessageIds).toEqual([]);
  });

  describe("at results", () => {
    it("asks to discard, and Keep reviewing leaves results intact", () => {
      const gated = play(...results, { type: "requestClose" });
      expect(gated.gate).toEqual({ kind: "confirmDiscard" });
      expect(gated.closed).toBe(false);
      const kept = reduceTriageReview(gated, { type: "keepReviewing" });
      expect(kept.gate).toEqual({ kind: "none" });
      expect(kept.phase).toEqual(play(...results).phase);
      expect(kept.requestMessageIds).toEqual(["fresh"]);
    });

    it("dismissing the confirmation again keeps reviewing", () => {
      expect(
        play(...results, { type: "requestClose" }, { type: "requestClose" })
          .gate,
      ).toEqual({ kind: "none" });
    });

    it("Discard and close closes without stopping anything", () => {
      const closed = play(
        ...results,
        { type: "requestClose" },
        { type: "confirmClose" },
      );
      expect(closed.closed).toBe(true);
      expect(closed.gate).toEqual({ kind: "none" });
    });
  });

  describe("during progress", () => {
    it("asks to cancel, and declining leaves the run running", () => {
      const gated = play(...running, { type: "requestClose" });
      expect(gated.gate).toEqual({ kind: "confirmCancel" });
      const kept = reduceTriageReview(gated, { type: "keepReviewing" });
      expect(kept.gate).toEqual({ kind: "none" });
      expect(kept.phase).toMatchObject({
        activity: "running",
        runActive: true,
      });
    });

    it("confirming stops and closes only once authoritative state is inactive", () => {
      const stopping = play(
        ...running,
        { type: "requestClose" },
        { type: "confirmClose" },
      );
      expect(stopping.gate).toEqual({ kind: "stopping", admitted: false });
      // Close requests are ignored while stopping.
      expect(reduceTriageReview(stopping, { type: "requestClose" })).toBe(
        stopping,
      );
      const admitted = reduceTriageReview(stopping, { type: "stopAdmitted" });
      expect(admitted.gate).toEqual({ kind: "stopping", admitted: true });
      expect(admitted.closed).toBe(false);
      const stopped = reduceTriageReview(admitted, {
        type: "activity",
        activity: "results",
        runActive: false,
      });
      expect(stopped.closed).toBe(true);
    });

    it("an inactive state before admission does not close", () => {
      const stopping = play(
        ...running,
        { type: "requestClose" },
        { type: "confirmClose" },
        { type: "activity", activity: "running", runActive: false },
      );
      expect(stopping.closed).toBe(false);
      expect(stopping.gate).toEqual({ kind: "stopping", admitted: false });
      expect(
        reduceTriageReview(stopping, { type: "stopAdmitted" }).closed,
      ).toBe(true);
    });

    it("treats an already-finished run's no-op stop as closed", () => {
      const state = play(
        ...running,
        { type: "requestClose" },
        { type: "confirmClose" },
        { type: "activity", activity: "running", runActive: false },
        { type: "stopAdmitted" },
      );
      expect(state.closed).toBe(true);
    });

    it("keeps the modal open with the failure, then retries or keeps reviewing", () => {
      const failed = play(
        ...running,
        { type: "requestClose" },
        { type: "confirmClose" },
        { type: "stopFailed", message: "Stop rejected" },
      );
      expect(failed.gate).toEqual({
        kind: "stopFailed",
        message: "Stop rejected",
      });
      expect(failed.closed).toBe(false);
      expect(reduceTriageReview(failed, { type: "confirmClose" }).gate).toEqual(
        { kind: "stopping", admitted: false },
      );
      expect(
        reduceTriageReview(failed, { type: "keepReviewing" }).gate,
      ).toEqual({ kind: "none" });
    });

    it("switches to the discard warning when the run finishes under the confirmation", () => {
      expect(
        play(
          ...running,
          { type: "requestClose" },
          { type: "activity", activity: "results", runActive: false },
        ).gate,
      ).toEqual({ kind: "confirmDiscard" });
    });
  });

  it("ignores every event once closed", () => {
    const closed = play({ type: "requestClose" });
    expect(reduceTriageReview(closed, run)).toBe(closed);
    expect(reduceTriageReview(closed, { type: "rerun" })).toBe(closed);
  });
});

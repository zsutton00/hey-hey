import { describe, expect, it } from "vitest";
import {
  EvalAttemptStatus,
  EvalAttemptStopReason,
  type EvalRunSettings,
} from "@hey-hey/ui-common/api";
import type { EvalAttemptReport } from "@hey-hey/ui-common/data";

import {
  attemptCellView,
  defaultRunSettings,
  isProjectAssistantEnabled,
  formatElapsed,
  progressEntries,
  toConfiguration,
  toLaunchSettings,
} from "./evalRunView";

const settings: EvalRunSettings = {
  maxConcurrentAttempts: 3,
  attemptTimeLimitSeconds: 900,
  attemptTokenLimit: 200_000,
};

const attempt = (
  id: string,
  payload: Partial<EvalAttemptReport["payload"]>,
): EvalAttemptReport =>
  ({
    id,
    createdAt: "2026-10-22T10:00:00.000Z",
    payload: {
      reportType: "EVAL_ATTEMPT",
      caseInputId: "case-1",
      configuration: {
        id: "setup-a",
        target: { provider: "claude", model: "m" },
      },
      status: EvalAttemptStatus.Queued,
      measurements: [],
      targetSessionId: "target-session",
      ...payload,
    },
  }) as unknown as EvalAttemptReport;

const NOW = Date.parse("2026-10-22T10:10:00.000Z");

describe("toConfiguration", () => {
  it("assigns distinct UUID identities while preserving the chosen target", () => {
    const target = {
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "medium",
    };
    const first = toConfiguration(target, true);
    const second = toConfiguration(target, true);
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(first.id).toMatch(uuid);
    expect(second.id).toMatch(uuid);
    expect(first.id).not.toBe(second.id);
    expect(first.target).toEqual(target);
  });

  it("records Project Assistant off on the target and leaves it out while on", () => {
    const target = { provider: "claude", model: "claude-opus-5-5" };
    const off = toConfiguration(target, false);

    expect(toConfiguration(target, true).target).toEqual(target);
    expect(off.target).toEqual({
      ...target,
      handlerConfig: { projectAssistant: { enabled: false } },
    });
    expect(isProjectAssistantEnabled([off])).toBe(false);
    expect(isProjectAssistantEnabled([toConfiguration(target, true)])).toBe(
      true,
    );
  });
});

describe("toLaunchSettings", () => {
  it("defaults to 3 at once and leaves both limits out (no limit)", () => {
    expect(toLaunchSettings(defaultRunSettings())).toEqual({
      maxConcurrentAttempts: 3,
    });
  });

  it("records presets and custom values in seconds and tokens", () => {
    expect(
      toLaunchSettings({
        concurrency: 2,
        timeLimit: { kind: "preset", value: 15 },
        tokenLimit: { kind: "custom", value: 50_000 },
      }),
    ).toEqual({
      maxConcurrentAttempts: 2,
      attemptTimeLimitSeconds: 900,
      attemptTokenLimit: 50_000,
    });
  });

  it("is incomplete while a custom limit or concurrency is unset", () => {
    expect(
      toLaunchSettings({
        ...defaultRunSettings(),
        timeLimit: { kind: "custom", value: null },
      }),
    ).toBeNull();
    expect(
      toLaunchSettings({ ...defaultRunSettings(), concurrency: null }),
    ).toBeNull();
  });
});

describe("attemptCellView", () => {
  it("shows running attempts with elapsed time and phase", () => {
    expect(
      attemptCellView(
        attempt("a", {
          status: EvalAttemptStatus.Preparing,
          startedAt: "2026-10-22T10:03:50.000Z",
        }),
        settings,
        NOW,
        null,
      ),
    ).toEqual({ kind: "running", elapsedMs: 370_000, phase: "preparing" });
  });

  it("shows finished elapsed time from recorded start and end", () => {
    expect(
      attemptCellView(
        attempt("a", {
          status: EvalAttemptStatus.Completed,
          startedAt: "2026-10-22T10:00:00.000Z",
          completedAt: "2026-10-22T10:02:41.000Z",
        }),
        settings,
        NOW,
        null,
      ),
    ).toEqual({ kind: "finished", elapsedMs: 161_000 });
  });

  it("leaves unrecorded elapsed time unavailable, never zero", () => {
    expect(
      attemptCellView(
        attempt("a", { status: EvalAttemptStatus.Completed }),
        settings,
        NOW,
        null,
      ),
    ).toEqual({ kind: "finished", elapsedMs: null });
  });

  it("names the limit that stopped an attempt", () => {
    const time = attemptCellView(
      attempt("a", {
        status: EvalAttemptStatus.Stopped,
        stopReason: EvalAttemptStopReason.TimeLimit,
      }),
      settings,
      NOW,
      null,
    );
    const tokens = attemptCellView(
      attempt("b", {
        status: EvalAttemptStatus.Stopped,
        stopReason: EvalAttemptStopReason.TokenLimit,
      }),
      settings,
      NOW,
      null,
    );
    expect(time).toEqual({
      kind: "stopped",
      stop: { reason: "TIME_LIMIT", limit: "15 min" },
    });
    expect(tokens).toEqual({
      kind: "stopped",
      stop: { reason: "TOKEN_LIMIT", limit: "200k" },
    });
  });

  it("shows a user stop as stopped, not failed", () => {
    expect(
      attemptCellView(
        attempt("a", {
          status: EvalAttemptStatus.Stopped,
          stopReason: EvalAttemptStopReason.User,
        }),
        settings,
        NOW,
        null,
      ).kind,
    ).toBe("stopped");
  });

  it("shows an error with its message and the attempt's session", () => {
    expect(
      attemptCellView(
        attempt("a", {
          status: EvalAttemptStatus.Error,
          error: { message: "provider unavailable" },
        }),
        settings,
        NOW,
        "coordinator",
      ),
    ).toEqual({
      kind: "error",
      message: "provider unavailable",
      sessionId: "target-session",
    });
  });

  it("falls back to the run's session when the attempt recorded none", () => {
    const view = attemptCellView(
      attempt("a", { status: EvalAttemptStatus.Error, targetSessionId: null }),
      settings,
      NOW,
      "coordinator",
    );
    expect(view).toMatchObject({ kind: "error", sessionId: "coordinator" });
  });
});

describe("progressEntries", () => {
  it("logs each start and end in time order", () => {
    const entries = progressEntries(
      [
        attempt("a", {
          status: EvalAttemptStatus.Completed,
          startedAt: "2026-10-22T10:00:00.000Z",
          completedAt: "2026-10-22T10:05:00.000Z",
        }),
        attempt("b", {
          status: EvalAttemptStatus.Error,
          startedAt: "2026-10-22T10:00:01.000Z",
          completedAt: "2026-10-22T10:01:00.000Z",
          error: { message: "boom" },
        }),
        attempt("c", {
          status: EvalAttemptStatus.Stopped,
          stopReason: EvalAttemptStopReason.TimeLimit,
          startedAt: "2026-10-22T10:00:02.000Z",
          completedAt: "2026-10-22T10:15:02.000Z",
        }),
        attempt("d", { status: EvalAttemptStatus.Queued }),
      ],
      settings,
    );
    expect(entries.map((e) => `${e.kind}:${e.attempt.id}`)).toEqual([
      "started:a",
      "started:b",
      "started:c",
      "error:b",
      "finished:a",
      "stopped:c",
    ]);
  });

  it("keeps an end without a recorded time after its start", () => {
    const entries = progressEntries(
      [
        attempt("a", {
          status: EvalAttemptStatus.Stopped,
          stopReason: EvalAttemptStopReason.User,
          startedAt: "2026-10-22T10:00:00.000Z",
        }),
      ],
      settings,
    );
    expect(entries.map((e) => e.kind)).toEqual(["started", "stopped"]);
  });
});

describe("formatElapsed", () => {
  it("formats minutes and seconds", () => {
    expect(formatElapsed(161_000)).toBe("2m 41s");
    expect(formatElapsed(9_000)).toBe("9s");
    expect(formatElapsed(3_900_000)).toBe("1h 5m");
  });
});

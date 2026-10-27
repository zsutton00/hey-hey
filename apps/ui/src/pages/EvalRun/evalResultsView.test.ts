import { describe, expect, it } from "vitest";
import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

import { caseRow, groupCasesBySetup, rowMeasure } from "./evalResultsView";

const setupA = {
  id: "a",
  target: { provider: "claude", model: "opus", reasoningEffort: "high" },
};
const setupB = {
  id: "b",
  target: { provider: "codex", model: "gpt", reasoningEffort: "low" },
};

const run = {
  id: "run-1",
  payload: {
    reportType: "EVAL_RUN",
    configurations: [setupB, setupA],
    cases: [
      {
        id: "case-1",
        evalCaseId: "eval-case-1",
        title: "New field",
        grading: { expectations: " Find the events. ", checks: [], rubric: [] },
      },
      {
        id: "case-2",
        evalCaseId: "eval-case-2",
        title: "Desktop app",
        grading: { checks: [], rubric: [] },
      },
    ],
  },
} as unknown as EvalRunReport;

const attempt = (
  id: string,
  configuration: typeof setupA,
  caseInputId: string,
  payload: Record<string, unknown> = {},
): EvalAttemptReport =>
  ({
    id,
    payload: {
      reportType: "EVAL_ATTEMPT",
      caseInputId,
      configuration,
      status: "COMPLETED",
      measurements: [],
      targetSessionId: `session-${id}`,
      ...payload,
    },
  }) as unknown as EvalAttemptReport;

const prep = (extra: Record<string, unknown>) => ({
  scope: "TARGET_PREPARATION",
  ...extra,
});
const handler = (extra: Record<string, unknown>) => ({
  scope: "TARGET_HANDLER",
  ...extra,
});

describe("rowMeasure", () => {
  const read = (entry: { toolCalls?: number } | undefined) => entry?.toolCalls;

  it("adds preparation and handler work", () => {
    const a = attempt("x", setupA, "case-1", {
      measurements: [prep({ toolCalls: 5 }), handler({ toolCalls: 12 })],
    });
    expect(rowMeasure(a, read)).toEqual({ value: 17, partial: false });
  });

  it("marks a total built from one scope as part reported", () => {
    const a = attempt("x", setupA, "case-1", {
      measurements: [prep({ toolCalls: 5 })],
    });
    expect(rowMeasure(a, read)).toEqual({ value: 5, partial: true });
  });

  it("reads null, never 0, when neither scope reported", () => {
    const a = attempt("x", setupA, "case-1", {
      measurements: [prep({ elapsedMs: 1 }), handler({})],
    });
    expect(rowMeasure(a, read)).toEqual({ value: null, partial: false });
  });
});

describe("caseRow", () => {
  it("keys the session and Eval Case links off the row's own attempt and case", () => {
    const row = caseRow("p1", run, attempt("x", setupA, "case-2"));
    expect(row.sessionHref).toBe(
      "/projects/p1/resolve-agent-session-by-id/session-x",
    );
    expect(row.evalCaseHref).toBe("/projects/p1/tasks/eval-case-2");
    expect(row.title).toBe("Desktop app");
    expect(row.attemptId).toBe("x");
  });

  it("has no session link when no session was recorded", () => {
    const row = caseRow(
      "p1",
      run,
      attempt("x", setupA, "case-1", { targetSessionId: null }),
    );
    expect(row.sessionHref).toBeNull();
  });

  it("trims the recorded expectation and leaves it null when absent", () => {
    expect(caseRow("p1", run, attempt("x", setupA, "case-1")).expectation).toBe(
      "Find the events.",
    );
    expect(
      caseRow("p1", run, attempt("y", setupA, "case-2")).expectation,
    ).toBeNull();
  });

  it("reads recognition, quality and checks from the saved assessment unchanged", () => {
    const row = caseRow(
      "p1",
      run,
      attempt("x", setupA, "case-1", {
        automatedAssessment: {
          checkResults: [
            { checkId: "c1", passed: true },
            { checkId: "c2", passed: false },
          ],
          recognition: { recognized: false, explanation: "Missed the events." },
          quality: [
            { key: "g", name: "G", score: 4, explanation: "" },
            { key: "u", name: "U", explanation: "" },
          ],
          createdAt: "2026-10-22T10:20:00.000Z",
        },
      }),
    );
    expect(row.recognition).toBe("missed");
    expect(row.recognitionExplanation).toBe("Missed the events.");
    expect(row.quality).toBe(4);
    expect(row.checks).toEqual({ passed: 1, total: 2 });
  });

  it("marks an errored attempt and keeps what it measured", () => {
    const row = caseRow(
      "p1",
      run,
      attempt("x", setupA, "case-1", {
        status: "ERROR",
        measurements: [prep({ elapsedMs: 22_000, inputTokens: 5_000 })],
      }),
    );
    expect(row.errored).toBe(true);
    expect(row.recognition).toBe("pending");
    expect(row.elapsedMs).toEqual({ value: 22_000, partial: true });
    expect(row.tokens).toEqual({ value: 5_000, partial: true });
    expect(row.toolCalls.value).toBeNull();
  });

  it("splits the work into preparing context and the handler", () => {
    const row = caseRow(
      "p1",
      run,
      attempt("x", setupA, "case-1", {
        measurements: [
          prep({ elapsedMs: 41_000, inputTokens: 15_000, outputTokens: 5_000 }),
          handler({ elapsedMs: 160_000, toolCalls: 12 }),
        ],
      }),
    );
    expect(row.breakdown).toEqual([
      {
        scope: "TARGET_PREPARATION",
        elapsedMs: 41_000,
        tokens: 20_000,
        toolCalls: null,
      },
      {
        scope: "TARGET_HANDLER",
        elapsedMs: 160_000,
        tokens: null,
        toolCalls: 12,
      },
    ]);
  });
});

describe("groupCasesBySetup", () => {
  it("lists each setup in the run's order with one row per attempt it ran", () => {
    const groups = groupCasesBySetup("p1", run, [
      attempt("a1", setupA, "case-1"),
      attempt("b1", setupB, "case-1"),
      attempt("a2", setupA, "case-2"),
    ]);
    expect(groups.map((group) => group.configuration.id)).toEqual(["b", "a"]);
    expect(groups[0].rows.map((row) => row.attemptId)).toEqual(["b1"]);
    expect(groups[1].rows.map((row) => row.attemptId)).toEqual(["a1", "a2"]);
  });
});

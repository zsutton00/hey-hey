import { describe, expect, it } from "vitest";
import type { EvalAttemptReport, EvalRunReport } from "@hey-hey/ui-common/data";

import {
  caseRow,
  compareSetup,
  groupCasesBySetup,
  rowMeasure,
  measuredTokens,
} from "./evalResultsView";

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

  it("ignores legacy preparation when measuring the tested agent", () => {
    const a = attempt("x", setupA, "case-1", {
      measurements: [prep({ toolCalls: 5 }), handler({ toolCalls: 12 })],
    });
    expect(rowMeasure(a, read)).toEqual({ value: 12, partial: false });
  });

  it("does not substitute legacy preparation for missing handler work", () => {
    const a = attempt("x", setupA, "case-1", {
      measurements: [prep({ toolCalls: 5 })],
    });
    expect(rowMeasure(a, read)).toEqual({ value: null, partial: false });
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
    expect(row.elapsedMs).toEqual({ value: null, partial: false });
    expect(row.tokens).toEqual({ value: null, partial: false });
    expect(row.toolCalls.value).toBeNull();
  });

  it("shows a separate research agent only when it actually prepares the tested agent", () => {
    const row = caseRow(
      "p1",
      run,
      attempt("x", setupA, "case-1", {
        execution: {
          handler: "entity_conversation",
          projectAssistantPrepares: true,
          assessedOutput: "HANDLER_REPLY",
        },
        measurements: [
          prep({ elapsedMs: 41_000, inputTokens: 15_000, outputTokens: 5_000 }),
          handler({ elapsedMs: 160_000, toolCalls: 12 }),
        ],
      }),
    );
    expect(row.breakdown).toMatchObject([
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

describe("fresh input headline", () => {
  it("requires both measured halves and preserves reported zero", () => {
    expect(
      measuredTokens({ scope: "TARGET_HANDLER", outputTokens: 8 }),
    ).toBeUndefined();
    expect(
      measuredTokens({
        scope: "TARGET_HANDLER",
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(0);
  });

  it("excludes preparation, judging and cache reads from the attempt headline", () => {
    const own = attempt("x", setupA, "case-1", {
      measurements: [
        prep({ inputTokens: 500, outputTokens: 20 }),
        handler({
          inputTokens: 100,
          outputTokens: 8,
          cacheReadInputTokens: 500000,
          cacheCreationInputTokens: 0,
        }),
        { scope: "JUDGE", inputTokens: 50, outputTokens: 10 },
      ],
    });
    const row = caseRow("p1", run, own);
    expect(row.tokens).toEqual({ value: 108, partial: false });
    expect(row.breakdown[0]).toMatchObject({
      cacheReadInputTokens: 500000,
      cacheCreationInputTokens: 0,
    });
  });
});

describe("cost", () => {
  const cost = (state: string, amount?: number) => ({
    state,
    ...(amount === undefined ? {} : { amount, currency: "USD" }),
  });

  it("averages only fully reported costs, counts the rest, and labels partial", () => {
    const attempts = [
      attempt("a", setupA, "case-1", {
        measurements: [handler({ cost: cost("available", 1) })],
      }),
      attempt("b", setupA, "case-2", {
        measurements: [handler({ cost: cost("available", 3) })],
      }),
      attempt("c", setupA, "case-3", {
        measurements: [handler({ cost: cost("unavailable") })],
      }),
      attempt("d", setupA, "case-4", {
        measurements: [handler({ cost: cost("partial", 0.2) })],
      }),
    ];

    expect(compareSetup(setupA, attempts).cost).toEqual({
      value: 2,
      reported: 2,
      total: 4,
    });
    expect(caseRow("p1", run, attempts[3]!).cost).toEqual({
      value: 0.2,
      partial: true,
    });
    expect(caseRow("p1", run, attempts[2]!).cost).toEqual({
      value: null,
      partial: false,
    });
  });

  it("reads costs stored before the available/partial/unavailable shape as not reported", () => {
    const legacy = attempt("old", setupA, "case-1", {
      measurements: [
        handler({ cost: { amount: 2, currency: "USD", basis: "estimated" } }),
      ],
    });

    expect(caseRow("p1", run, legacy).cost.value).toBeNull();
    expect(compareSetup(setupA, [legacy]).cost.value).toBeNull();
  });

  it("keeps research cost on its own row, out of the tested figure", () => {
    const row = caseRow(
      "p1",
      run,
      attempt("x", setupA, "case-1", {
        execution: { projectAssistantPrepares: true },
        measurements: [
          prep({ cost: cost("available", 0.5) }),
          handler({ cost: cost("available", 1.4) }),
        ],
      }),
    );

    expect(row.cost.value).toBe(1.4);
    expect(row.breakdown.map(({ scope, cost: c }) => [scope, c])).toEqual([
      ["TARGET_PREPARATION", 0.5],
      ["TARGET_HANDLER", 1.4],
    ]);
  });
});

describe("coding attempts", () => {
  const codingRun = {
    id: "run-2",
    payload: {
      ...run.payload,
      cases: [
        {
          id: "coding-case",
          title: "Add a field",
          grading: { checks: [], rubric: [] },
          coding: {
            serviceId: "svc-1",
            pinnedCommit: { sha: "abcdef1234567", shortMessage: "Start here" },
          },
        },
      ],
    },
  } as unknown as EvalRunReport;
  const changes = {
    files: [
      {
        path: "a.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
        patch: "",
      },
    ],
  };
  // Attempts recorded before the runner stopped running tests still carry these.
  const historicalTestChecks = [
    { command: "ok", passed: true },
    { command: "bad", passed: false },
  ];

  it("shows what the attempt saved and where it started", () => {
    const row = caseRow(
      "p1",
      codingRun,
      attempt("x", setupA, "coding-case", {
        recordedChanges: changes,
        ...({ testChecks: historicalTestChecks } as object),
        error: { message: "boom" },
      }),
    );

    expect(row.coding).toEqual({
      changes,
      ended: true,
      startPoint: {
        serviceId: "svc-1",
        sha: "abcdef1234567",
        shortMessage: "Start here",
      },
    });
    expect(row.errorMessage).toBe("boom");
  });

  it("does not treat a running attempt's missing changes as final", () => {
    const running = attempt("x", setupA, "coding-case", { status: "RUNNING" });

    expect(caseRow("p1", codingRun, running).coding?.ended).toBe(false);
  });

  it("maps checklist hits and regressions for an updated Mockup", () => {
    const checklistRun = {
      ...codingRun,
      payload: {
        ...codingRun.payload,
        cases: [
          {
            ...codingRun.payload.cases[0],
            coding: {
              ...codingRun.payload.cases[0].coding,
              mockupChecklist: {
                kind: "UPDATE",
                items: [
                  { id: "a", description: "Shows it" },
                  { id: "b", description: "Clears it" },
                ],
              },
            },
          },
        ],
      },
    } as unknown as EvalRunReport;
    const judged = attempt("x", setupA, "coding-case", {
      automatedAssessment: {
        checkResults: [],
        recognition: { recognized: true, explanation: "" },
        quality: [],
        checklistResults: [
          { itemId: "a", hit: true, explanation: "added" },
          { itemId: "b", hit: false, explanation: "missing" },
        ],
        regressions: ["Sorting broke"],
        createdAt: "2026-10-22T10:20:00.000Z",
      },
    });

    const row = caseRow("p1", checklistRun, judged);

    expect(row.checklist).toMatchObject({
      kind: "UPDATE",
      hits: 1,
      regressions: ["Sorting broke"],
    });
    expect(row.checklist?.items.map((item) => item.hit)).toEqual([true, false]);

    const pending = caseRow(
      "p1",
      checklistRun,
      attempt("y", setupA, "coding-case"),
    );
    expect(pending.checklist?.hits).toBeNull();
    expect(caseRow("p1", codingRun, judged).checklist).toBeNull();
  });

  it("leaves non-coding attempts alone", () => {
    const row = caseRow("p1", run, attempt("x", setupA, "case-1"));

    expect(row.coding).toBeNull();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { setCapabilityCatalogForTests } from "../AgentSession/capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../test/capabilityCatalogFixture";
import type {
  ProjectReportPreviewRow,
  ProjectReportRequestDto,
} from "../../api";
import { ActivityCorrelationSource, ProjectReportStatus } from "../../api";
import {
  PROJECT_REPORT_PRESETS,
  buildCreateRequest,
  buildLaunchConfig,
  buildPreviewRequest,
  createProjectReportRequestState,
  projectReportRequestReducer as reduce,
  resolveProjectReportScope,
  selectExcludedPage,
  selectLaunchStatusView,
  selectNextBlocker,
  selectSubmitBlocker,
  type ProjectReportRequestState,
} from "./projectReportRequestState";

const NOW = new Date("2026-09-27T19:30:00.000Z");
const context = {
  projectId: "project-1",
  currentUserId: "user-1",
  timeZone: "America/Los_Angeles",
};

const row = (id: string, title = `Entity ${id}`): ProjectReportPreviewRow => ({
  subject: { entityType: "TASK", entityId: id },
  title,
  matchingActivityCount: 2,
  explanation: "Updated twice",
  excluded: false,
});

const agent = {
  provider: "claude" as const,
  model: "opus",
  reasoningEffort: "medium" as const,
  fastMode: false,
};

const initial = (): ProjectReportRequestState =>
  createProjectReportRequestState(context, NOW, agent);

const launch = {
  machineId: "machine-1",
  provider: "claude" as const,
  model: "opus",
  effort: "medium" as const,
};

const okCounts = {
  matchingSubjectCount: 3,
  includedSubjectCount: 3,
  excludedSubjectCount: 0,
};

describe("resolveProjectReportScope", () => {
  it("resolves relative periods to fixed start-inclusive/end-exclusive bounds", () => {
    const result = resolveProjectReportScope(
      {
        period: { kind: "last7Days" },
        people: "me",
        activity: ActivityCorrelationSource.AgentSession,
      },
      context,
      NOW,
    );
    expect(result).toEqual({
      ok: true,
      scope: {
        projectId: "project-1",
        windowStart: "2026-09-20T19:30:00.000Z",
        windowEnd: "2026-09-27T19:30:00.000Z",
        timeZone: "America/Los_Angeles",
        userId: "user-1",
        sources: ["AGENT_SESSION"],
      },
    });
  });

  it("rejects an inverted custom range", () => {
    const result = resolveProjectReportScope(
      {
        period: {
          kind: "custom",
          start: "2026-09-02T00:00",
          end: "2026-09-01T00:00",
        },
        people: "everyone",
        activity: "all",
      },
      context,
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      reason: "The end must be after the start.",
    });
  });
});

describe("presets and question edits", () => {
  it("outline guides preserve the question and record provenance", () => {
    const preset = PROJECT_REPORT_PRESETS[1];
    const state = reduce(initial(), { type: "applyPreset", preset });
    expect(state.question).toBe(initial().question);
    expect(state.outline).toBe(preset.outline);
    expect(state.preset?.key).toBe(preset.key);
  });

  it("question edits preserve exclusions and scope", () => {
    let state = reduce(initial(), { type: "toggleSubject", row: row("a") });
    const scope = state.scope;
    state = reduce(state, { type: "editQuestion", question: "What changed?" });
    expect(state.exclusions).toHaveLength(1);
    expect(state.scope).toBe(scope);
  });
});

describe("release notes repository selection", () => {
  it("seeds the kind question while guides only change its outline", () => {
    let state = reduce(initial(), { type: "setKind", kind: "RELEASE_NOTES" });
    expect(state.question).toContain("shipped");
    state = reduce(state, {
      type: "editQuestion",
      question: "What did customers receive?",
    });
    state = reduce(state, {
      type: "applyPreset",
      preset: PROJECT_REPORT_PRESETS[1],
    });
    expect(state.question).toBe("What did customers receive?");
  });

  it("defaults on machine changes, preserves exclusions on binding updates and submits the chosen subset", () => {
    let state = reduce(initial(), { type: "setKind", kind: "RELEASE_NOTES" });
    expect(selectNextBlocker(state, "machine-1")).toEqual({
      kind: "noRepositories",
    });
    state = reduce(state, {
      type: "reconcileRepositories",
      machineId: "machine-1",
      availableServiceIds: ["a", "b"],
    });
    expect(state.serviceIds).toEqual(["a", "b"]);
    state = reduce(state, { type: "selectRepositories", serviceIds: ["b"] });
    state = reduce(state, {
      type: "reconcileRepositories",
      machineId: "machine-1",
      availableServiceIds: ["a", "b", "c"],
    });
    expect(state.serviceIds).toEqual(["b"]);
    expect(buildCreateRequest(state, launch, "key")?.serviceIds).toEqual(["b"]);
    state = reduce(state, {
      type: "reconcileRepositories",
      machineId: "machine-2",
      availableServiceIds: ["c"],
    });
    expect(state.serviceIds).toEqual(["c"]);
    expect(selectNextBlocker(state, "machine-1")).toEqual({
      kind: "noRepositories",
    });
    state = reduce(state, {
      type: "reconcileRepositories",
      machineId: "machine-2",
      availableServiceIds: [],
    });
    expect(state.serviceIds).toEqual([]);
    expect(selectNextBlocker(state, "machine-2")).toEqual({
      kind: "noRepositories",
    });
  });
});

describe("exclusions", () => {
  it("toggling excludes and restores a subject", () => {
    let state = reduce(initial(), { type: "toggleSubject", row: row("a") });
    expect(state.exclusions.map((e) => e.subject.entityId)).toEqual(["a"]);
    state = reduce(state, { type: "toggleSubject", row: row("a") });
    expect(state.exclusions).toEqual([]);
  });

  it("excludes only the given page rows without duplicating existing exclusions", () => {
    let state = reduce(initial(), { type: "toggleSubject", row: row("a") });
    state = reduce(state, {
      type: "excludeRows",
      rows: [row("a"), row("b"), row("c")],
    });
    expect(state.exclusions.map((e) => e.subject.entityId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("paging and search keep exclusions; search does not enter scope", () => {
    let state = reduce(initial(), { type: "toggleSubject", row: row("a") });
    state = reduce(state, { type: "setOffset", offset: 10 });
    state = reduce(state, { type: "setSearch", search: " nav " });
    expect(state.exclusions).toHaveLength(1);
    expect(state.offset).toBe(0);
    const request = buildPreviewRequest(state);
    expect(request?.search).toBe("nav");
    expect(request?.scope).not.toHaveProperty("search");
  });

  it("scope changes clear exclusions and record a visible reset count", () => {
    let state = reduce(initial(), {
      type: "excludeRows",
      rows: [row("a"), row("b")],
    });
    state = reduce(state, {
      type: "changeScope",
      selection: { ...state.selection, period: { kind: "last7Days" } },
      context,
      now: NOW,
    });
    expect(state.exclusions).toEqual([]);
    expect(state.scopeResetExclusionCount).toBe(2);
  });

  it("excluded view pages and searches local exclusions with titles", () => {
    let state = reduce(initial(), {
      type: "excludeRows",
      rows: [row("a", "Release checklist"), row("b", "Navigation")],
    });
    state = reduce(state, { type: "setView", view: "excluded" });
    state = reduce(state, { type: "setSearch", search: "release" });
    expect(selectExcludedPage(state)).toEqual({
      rows: [{ subject: row("a").subject, title: "Release checklist" }],
      total: 1,
    });
    // Server read for counts ignores preview-only search in excluded view.
    expect(buildPreviewRequest(state)?.search).toBeUndefined();
  });

  it("clear exclusions restores all matches", () => {
    let state = reduce(initial(), { type: "excludeRows", rows: [row("a")] });
    state = reduce(state, { type: "clearExclusions" });
    expect(state.exclusions).toEqual([]);
  });
});

describe("question wording", () => {
  it("never blocks submission on time words that differ from the selected period", () => {
    const input = { counts: okCounts, machineId: "m", hasEffort: true };
    for (const question of [
      "What happened today?",
      "Recap last week",
      "What happened last month?",
    ]) {
      const state = reduce(initial(), { type: "editQuestion", question });
      expect(selectSubmitBlocker(state, input)).toBeNull();
    }
  });
});

describe("submission", () => {
  it("omits outline-guide provenance when the optional outline is cleared", () => {
    const state = reduce(initial(), { type: "editOutline", outline: "" });
    expect(buildCreateRequest(state, launch, "key-1")).not.toHaveProperty(
      "preset",
    );
  });
  const ready = { machineId: "m", hasEffort: true };

  it("blocks empty, all-excluded, and not-current populations", () => {
    const state = initial();
    expect(selectSubmitBlocker(state, { ...ready, counts: null })?.kind).toBe(
      "previewUnavailable",
    );
    expect(
      selectSubmitBlocker(state, {
        ...ready,
        counts: {
          ...okCounts,
          matchingSubjectCount: 0,
          includedSubjectCount: 0,
        },
      })?.kind,
    ).toBe("emptyPopulation");
    expect(
      selectSubmitBlocker(state, {
        ...ready,
        counts: {
          ...okCounts,
          includedSubjectCount: 0,
          excludedSubjectCount: 3,
        },
      })?.kind,
    ).toBe("allExcluded");
    expect(
      selectSubmitBlocker(state, {
        counts: okCounts,
        machineId: null,
        hasEffort: true,
      })?.kind,
    ).toBe("noMachine");
  });

  it("submits the chosen report kind and treats a kind change as a content edit", () => {
    let state = reduce(initial(), { type: "toggleSubject", row: row("a") });
    state = reduce(state, {
      type: "editOutline",
      outline: "Customer benefits\nCoverage",
    });
    state = { ...state, idempotencyKey: "kept" };
    state = reduce(state, { type: "setKind", kind: "RELEASE_NOTES" });
    expect(state.idempotencyKey).toBeNull();
    state = reduce(state, {
      type: "reconcileRepositories",
      machineId: launch.machineId,
      availableServiceIds: ["a"],
    });
    expect(buildCreateRequest(state, launch, "key-1")?.kind).toBe(
      "RELEASE_NOTES",
    );
    expect(buildCreateRequest(state, launch, "key-1")?.preset?.outline).toBe(
      "Customer benefits\nCoverage",
    );
  });

  it("carries question, preset provenance with edited outline, scope, exclusions, launch, and key unchanged", () => {
    let state = reduce(initial(), { type: "toggleSubject", row: row("a") });
    state = reduce(state, {
      type: "editQuestion",
      question: "Edited question",
    });
    state = reduce(state, { type: "editOutline", outline: "Only this" });
    const body = buildCreateRequest(state, launch, "key-1");
    expect(body).toEqual({
      kind: "PROJECT_REPORT",
      question: "Edited question",
      preset: {
        ...state.preset,
        prompt: "Edited question",
        outline: "Only this",
      },
      scope: state.scope.ok ? state.scope.scope : null,
      exclusions: [row("a").subject],
      launch,
      idempotencyKey: "key-1",
    });
  });

  it("guards duplicate starts and reuses the key after failure until content changes", () => {
    let state = reduce(initial(), {
      type: "submitStarted",
      idempotencyKey: "k1",
    });
    expect(reduce(state, { type: "submitStarted", idempotencyKey: "k2" })).toBe(
      state,
    );
    expect(
      selectSubmitBlocker(state, { ...ready, counts: okCounts })?.kind,
    ).toBe("inFlight");
    state = reduce(state, { type: "submitFailed", message: "Network" });
    expect(state.idempotencyKey).toBe("k1");
    expect(state.question).toBe(initial().question);
    state = reduce(state, { type: "toggleSubject", row: row("a") });
    expect(state.idempotencyKey).toBeNull();
    expect(state.submission).toEqual({ status: "idle" });
  });

  it("freezes edits once the request is durable", () => {
    let state = reduce(initial(), {
      type: "submitStarted",
      idempotencyKey: "k1",
    });
    state = reduce(state, { type: "submitSucceeded", requestId: "req-1" });
    expect(reduce(state, { type: "editQuestion", question: "x" })).toBe(state);
  });
});

describe("steps", () => {
  it("starts on report questions and moves to scope only with a question", () => {
    expect(initial().step).toBe("questions");
    const empty = reduce(initial(), { type: "editQuestion", question: "   " });
    expect(reduce(empty, { type: "next" })).toBe(empty);
    expect(reduce(initial(), { type: "next" }).step).toBe("scope");
  });

  it("requires a question, a machine, and an effort before Next", () => {
    const state = reduce(initial(), {
      type: "editQuestion",
      question: "What happened last month?",
    });
    expect(selectNextBlocker(state, "m")).toBeNull();
    expect(selectNextBlocker(state, null)?.kind).toBe("noMachine");
    expect(
      selectNextBlocker(
        reduce(state, { type: "editQuestion", question: "" }),
        "m",
      )?.kind,
    ).toBe("emptyQuestion");
    expect(
      selectNextBlocker(
        reduce(state, { type: "editAgent", patch: { reasoningEffort: null } }),
        "m",
      )?.kind,
    ).toBe("noEffort");
  });

  it("preserves question, outline, agent, scope, and exclusions across Back and Next", () => {
    let state = reduce(initial(), { type: "editQuestion", question: "Mine" });
    state = reduce(state, { type: "editOutline", outline: "Only this" });
    state = reduce(state, {
      type: "editAgent",
      patch: { model: "sonnet", fastMode: true },
    });
    state = reduce(state, { type: "next" });
    state = reduce(state, {
      type: "changeScope",
      selection: { ...state.selection, people: "me" },
      context,
      now: NOW,
    });
    state = reduce(state, { type: "toggleSubject", row: row("a") });
    const scoped = state;
    state = reduce(state, { type: "back" });
    expect(state.step).toBe("questions");
    state = reduce(state, { type: "editOutline", outline: "Still this" });
    state = reduce(state, { type: "next" });
    expect(state).toMatchObject({
      step: "scope",
      question: "Mine",
      outline: "Still this",
      agent: { ...agent, model: "sonnet", fastMode: true },
      selection: scoped.selection,
      exclusions: scoped.exclusions,
    });
  });

  it("stays on scope after a failed submission and cannot go back while locked", () => {
    let state = reduce(reduce(initial(), { type: "next" }), {
      type: "submitStarted",
      idempotencyKey: "k1",
    });
    expect(reduce(state, { type: "back" })).toBe(state);
    state = reduce(state, { type: "submitFailed", message: "Network" });
    expect(state.step).toBe("scope");
    expect(reduce(state, { type: "back" }).step).toBe("questions");
  });
});

describe("agent selection", () => {
  afterEach(() => setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG));

  it.each([false, true])(
    "preserves supported Codex Fast mode (%s) and omits it after switching to Claude",
    (fastMode) => {
      setCapabilityCatalogForTests([
        {
          provider: "codex",
          models: [
            {
              id: "fast-model",
              label: "Fast model",
              efforts: ["medium"],
              serviceTiers: ["priority"],
            },
          ],
        },
      ]);
      let state = createProjectReportRequestState(context, NOW, {
        ...agent,
        provider: "codex",
        model: "fast-model",
        fastMode,
      });
      expect(buildLaunchConfig(state.agent, "m")?.fastMode).toBe(fastMode);
      state = reduce(state, {
        type: "editAgent",
        patch: { provider: "claude" },
      });
      state = reduce(state, { type: "editAgent", patch: { model: "opus" } });
      state = reduce(state, { type: "editAgent", patch: { fastMode: false } });
      expect(buildLaunchConfig(state.agent, "m")).toEqual({
        machineId: "m",
        provider: "claude",
        model: "opus",
        effort: "medium",
      });
      expect(
        buildLaunchConfig(
          { ...state.agent, provider: "codex", model: "unsupported" },
          "m",
        ),
      ).not.toHaveProperty("fastMode");
    },
  );
  it("clears the idempotency key when the agent changes, but not on a no-op", () => {
    let state = reduce(initial(), {
      type: "submitStarted",
      idempotencyKey: "k1",
    });
    state = reduce(state, { type: "submitFailed", message: "Network" });
    expect(reduce(state, { type: "editAgent", patch: { model: "opus" } })).toBe(
      state,
    );
    const changed = reduce(state, {
      type: "editAgent",
      patch: { fastMode: true },
    });
    expect(changed.idempotencyKey).toBeNull();
    expect(changed.submission).toEqual({ status: "idle" });
  });

  it("holds no agent until the surface seeds one from the machine's catalog", () => {
    const empty = createProjectReportRequestState(context, NOW, null);
    expect(empty.agent).toBeNull();
    expect(selectNextBlocker(empty, "m")?.kind).toBe("noAgent");
    expect(
      selectSubmitBlocker(empty, {
        counts: okCounts,
        machineId: "m",
        hasEffort: true,
      })?.kind,
    ).toBe("noAgent");
    expect(
      reduce(empty, { type: "editAgent", patch: { model: "sonnet" } }),
    ).toBe(empty);

    const seeded = reduce(empty, { type: "setAgent", agent });
    expect(seeded.agent).toEqual(agent);
    expect(selectNextBlocker(seeded, "m")).toBeNull();
    // A seed never replaces a choice that is already held.
    expect(
      reduce(seeded, {
        type: "setAgent",
        agent: { ...agent, model: "sonnet" },
      }),
    ).toBe(seeded);
  });

  it("omits retained Fast mode for Claude launches", () => {
    expect(buildLaunchConfig({ ...agent, fastMode: true }, "m")).toEqual({
      machineId: "m",
      provider: "claude",
      model: "opus",
      effort: "medium",
    });
    expect(
      buildLaunchConfig({ ...agent, reasoningEffort: null }, "m"),
    ).toBeNull();
  });
});

describe("selectLaunchStatusView", () => {
  const request = (
    status: ProjectReportRequestDto["status"],
    attempts: ProjectReportRequestDto["attempts"] = [],
  ) => ({ status, attempts }) as unknown as ProjectReportRequestDto;
  const attempt = (n: number, extra: object = {}) => ({
    id: `attempt-${n}`,
    attemptNumber: n,
    status: ProjectReportStatus.Failed,
    idempotencyKey: `k${n}`,
    createdAt: NOW.toISOString(),
    ...extra,
  });

  it("distinguishes queued, running, completed, and failed", () => {
    expect(selectLaunchStatusView(request("QUEUED")).kind).toBe("queued");
    expect(selectLaunchStatusView(request("RUNNING")).kind).toBe("running");
    expect(
      selectLaunchStatusView(
        request("COMPLETED", [attempt(1, { reportId: "r1" })]),
      ),
    ).toEqual({ kind: "completed", reportId: "r1" });
    expect(
      selectLaunchStatusView(
        request("FAILED", [
          attempt(1),
          attempt(2, {
            failure: {
              stage: "GENERATION",
              code: "x",
              message: "Boom",
              retryable: true,
            },
          }),
        ]),
      ),
    ).toEqual({
      kind: "failed",
      message: "Boom",
      retryable: true,
      attemptId: "attempt-2",
    });
  });
});

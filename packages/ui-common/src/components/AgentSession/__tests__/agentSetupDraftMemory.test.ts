import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_SETUP_DRAFT_LIMIT,
  getAgentSetupDraftStorageKey,
  readAgentSetupDraft,
  removeAgentSetupDraft,
  upsertAgentSetupDraft,
  type AgentSetupDraftInput,
} from "../agentSetupDraftMemory";

const buildDraft = (
  setupContextKey: string,
  overrides: Partial<AgentSetupDraftInput> = {},
): AgentSetupDraftInput => ({
  setupContextKey,
  sessionMethod: "plan",
  projectModeSelection: null,
  serviceIds: ["service-1"],
  launchServiceId: "service-1",
  worktreeBranch: null,
  provider: "claude",
  model: "claude-opus-4-7",
  reasoningEffort: "medium",
  ...overrides,
});

describe("agentSetupDraftMemory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips drafts in a user-scoped versioned collection", () => {
    upsertAgentSetupDraft(
      "user-1",
      buildDraft("org-1:project-1:session-1"),
      "2026-08-23T10:00:00.000Z",
    );

    expect(
      readAgentSetupDraft("user-1", "org-1:project-1:session-1"),
    ).toMatchObject({
      setupContextKey: "org-1:project-1:session-1",
      version: 2,
      lastEditedAt: "2026-08-23T10:00:00.000Z",
    });
    expect(
      readAgentSetupDraft("user-2", "org-1:project-1:session-1"),
    ).toBeNull();

    const stored = localStorage.getItem(getAgentSetupDraftStorageKey("user-1"));
    expect(stored).toContain('"version":2');
  });

  it("ignores malformed collection entries without affecting valid drafts", () => {
    localStorage.setItem(
      getAgentSetupDraftStorageKey("user-1"),
      JSON.stringify({
        version: 2,
        drafts: [
          { setupContextKey: "invalid", provider: "unknown" },
          {
            ...buildDraft("valid"),
            version: 2,
            lastEditedAt: "2026-08-23T10:00:00.000Z",
          },
        ],
      }),
    );

    expect(readAgentSetupDraft("user-1", "invalid")).toBeNull();
    expect(readAgentSetupDraft("user-1", "valid")).not.toBeNull();
  });

  it("evicts older drafts after the fifth most recently edited context", () => {
    for (let index = 0; index < AGENT_SETUP_DRAFT_LIMIT + 1; index += 1) {
      upsertAgentSetupDraft(
        "user-1",
        buildDraft(`context-${index}`),
        `2026-08-23T10:0${index}:00.000Z`,
      );
    }

    expect(readAgentSetupDraft("user-1", "context-0")).toBeNull();
    expect(readAgentSetupDraft("user-1", "context-1")).not.toBeNull();
    expect(readAgentSetupDraft("user-1", "context-5")).not.toBeNull();
    expect(
      JSON.parse(
        localStorage.getItem(getAgentSetupDraftStorageKey("user-1")) ?? "{}",
      ).drafts,
    ).toHaveLength(AGENT_SETUP_DRAFT_LIMIT);
  });

  it("updates recency and replaces only the matching context", () => {
    upsertAgentSetupDraft(
      "user-1",
      buildDraft("context-1", { model: "old-model" }),
      "2026-08-23T10:00:00.000Z",
    );
    upsertAgentSetupDraft(
      "user-1",
      buildDraft("context-2"),
      "2026-08-23T10:01:00.000Z",
    );
    upsertAgentSetupDraft(
      "user-1",
      buildDraft("context-1", { model: "new-model" }),
      "2026-08-23T10:02:00.000Z",
    );

    expect(readAgentSetupDraft("user-1", "context-1")?.model).toBe(
      "new-model",
    );
    expect(readAgentSetupDraft("user-1", "context-2")).not.toBeNull();
  });

  it("removes only the matching context and never stores prompt text", () => {
    upsertAgentSetupDraft(
      "user-1",
      buildDraft("context-1"),
      "2026-08-23T10:00:00.000Z",
    );
    upsertAgentSetupDraft(
      "user-1",
      buildDraft("context-2"),
      "2026-08-23T10:01:00.000Z",
    );

    expect(
      localStorage.getItem(getAgentSetupDraftStorageKey("user-1")),
    ).not.toContain("initial prompt");

    removeAgentSetupDraft("user-1", "context-1");
    expect(readAgentSetupDraft("user-1", "context-1")).toBeNull();
    expect(readAgentSetupDraft("user-1", "context-2")).not.toBeNull();
  });
});

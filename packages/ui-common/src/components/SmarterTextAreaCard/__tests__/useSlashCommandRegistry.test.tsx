import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkItemTypeLifecycleStatus,
  WorkStatus,
  type WorkItemTypeSummaryDto,
} from "../../../api";
import { useSlashCommandRegistry } from "../slashCommands/useSlashCommandRegistry";

const workItemTypesMock = vi.hoisted(() => ({
  workItemTypes: [] as WorkItemTypeSummaryDto[],
}));

vi.mock("../../../hooks/useEditorContext", () => ({
  useProjectIds: () => ({ organizationId: "org-1", projectId: "proj-1" }),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypes: () => ({ workItemTypes: workItemTypesMock.workItemTypes }),
}));

const makeWorkItemType = (
  key: string,
  name: string
): WorkItemTypeSummaryDto => ({
  definition: {
    key,
    name,
    description: `${name} description`,
    sections: [],
    allowedStatuses: [WorkStatus.Backlog],
  },
  isSystem: true,
  status: WorkItemTypeLifecycleStatus.Active,
  projectId: null,
});

describe("useSlashCommandRegistry", () => {
  beforeEach(() => {
    workItemTypesMock.workItemTypes = [];
  });

  it("registers feature-tree as a Hey Hey built-in", () => {
    const { result } = renderHook(() =>
      useSlashCommandRegistry({
        organizationId: "org-1",
        projectId: "proj-1",
        surfaceContext: {
          commandSurface: "general",
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        },
        query: "feature",
      })
    );

    expect(result.current.heyHey).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "hey-hey-builtin:feature-tree",
          name: "feature-tree",
          kind: "open-picker",
          picker: "feature-tree",
        }),
      ])
    );
  });

  it("offers the Skill picker only to an attached Codex composer", () => {
    const { result: codexResult } = renderHook(() =>
      useSlashCommandRegistry({
        organizationId: "org-1",
        projectId: "proj-1",
        agentContext: { provider: "codex" },
        surfaceContext: {
          commandSurface: "general",
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        },
        query: "skill",
      })
    );

    expect(codexResult.current.heyHey).toEqual([
      expect.objectContaining({
        name: "skill",
        kind: "open-skill-picker",
        picker: "skill-picker",
      }),
    ]);

    const { result: claudeResult } = renderHook(() =>
      useSlashCommandRegistry({
        organizationId: "org-1",
        projectId: "proj-1",
        agentContext: { provider: "claude" },
        surfaceContext: {
          commandSurface: "general",
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        },
        query: "skill",
      })
    );

    expect(claudeResult.current.heyHey).toEqual([]);
  });

  it("shows Skill as disabled when a pre-run surface provides an explanation", () => {
    const { result } = renderHook(() =>
      useSlashCommandRegistry({
        organizationId: "org-1",
        projectId: "proj-1",
        surfaceContext: {
          commandSurface: "general",
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
          unavailableSkillCommandReason:
            "Start a Codex conversation to browse installed Skills.",
        },
        query: "skill",
      })
    );

    expect(result.current.heyHey).toEqual([
      expect.objectContaining({
        name: "skill",
        kind: "open-skill-picker",
        availability: {
          state: "disabled",
          reason: "Start a Codex conversation to browse installed Skills.",
        },
      }),
    ]);
  });

  it("includes active work-item types alongside fixed Hey Hey commands", () => {
    workItemTypesMock.workItemTypes = [makeWorkItemType("BUG", "Bug")];

    const { result } = renderHook(() =>
      useSlashCommandRegistry({
        organizationId: "org-1",
        projectId: "proj-1",
        surfaceContext: {
          commandSurface: "general",
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        },
        query: "",
      })
    );

    expect(result.current.heyHey.map((command) => command.name)).toEqual(
      expect.arrayContaining(["bug", "search", "feature-tree"])
    );
    expect(
      result.current.heyHey.every((command) =>
        command.id.startsWith("hey-hey-builtin:")
      )
    ).toBe(true);
  });

  it("limits entity-insertion-only surfaces to typed inline entity commands", () => {
    workItemTypesMock.workItemTypes = [
      makeWorkItemType("STANDARD", "Task"),
      makeWorkItemType("FEATURE", "Feature"),
      makeWorkItemType("CONTRACT", "Contract"),
    ];

    const { result } = renderHook(() =>
      useSlashCommandRegistry({
        organizationId: "org-1",
        projectId: "proj-1",
        surfaceContext: {
          commandSurface: "entity-insertion-only",
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        },
        query: "",
      })
    );

    expect(result.current.heyHey).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "task",
          typeRef: "STANDARD",
          typeRefKind: "work-item-type",
        }),
        expect.objectContaining({
          name: "feature",
          typeRef: "FEATURE",
          typeRefKind: "work-item-type",
        }),
        expect.objectContaining({
          name: "contract",
          typeRef: "CONTRACT",
          typeRefKind: "work-item-type",
        }),
        expect.objectContaining({
          name: "service",
          typeRef: "SERVICE",
          typeRefKind: "entity-type",
        }),
        expect.objectContaining({
          name: "plan",
          typeRef: "PLAN",
          typeRefKind: "entity-type",
        }),
        expect.objectContaining({
          name: "doc",
          typeRef: "DESIGN_DOC",
          typeRefKind: "entity-type",
        }),
      ])
    );
    expect(result.current.heyHey).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "recent" }),
        expect.objectContaining({ name: "search" }),
        expect.objectContaining({ name: "feature-tree" }),
      ])
    );
    expect(
      result.current.heyHey.every(
        (command) => command.kind === "inline-entity-search"
      )
    ).toBe(true);
  });

  it("uses explicit project context instead of ambient editor route context", () => {
    workItemTypesMock.workItemTypes = [makeWorkItemType("BUG", "Bug")];

    const { result } = renderHook(() =>
      useSlashCommandRegistry({
        organizationId: "org-from-editor",
        projectId: "project-from-editor",
        surfaceContext: {
          commandSurface: "entity-insertion-only",
          focalEntity: { kind: "none" },
          cachedConversationMentionOptions: [],
        },
        query: "bug",
      })
    );

    expect(result.current.heyHey).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "bug", typeRef: "BUG" }),
      ])
    );
  });
});

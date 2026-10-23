import { AgentSessionType } from "@hey-hey/ui-common/api";
import { createNavigationLineageEntry } from "@hey-hey/ui-common";
import { createEntityActivation } from "@hey-hey/ui-common/context";
import { describe, expect, it } from "vitest";
import {
  removeOpenItemBranch,
  upsertOpenItem,
  type OpenItem,
} from "./openItemsModel";

describe("upsertOpenItem", () => {
  it("refreshes presentation in place without losing Open Item metadata", () => {
    const existing: OpenItem = {
      entityId: createEntityActivation(
        "agent_session",
        "session-1",
        null,
      ).entityId,
      entityType: "agent_session",
      whyOpen: "Check the result",
      pinned: true,
      firstAddedOrder: 4,
    };
    const sibling: OpenItem = {
      entityId: createEntityActivation("task", "task-1", null).entityId,
      entityType: "task",
      firstAddedOrder: 5,
    };

    const next = upsertOpenItem(
      [existing, sibling],
      createEntityActivation("agent_session", "session-1", null, {
        kind: "agent_session",
        label: "API - Resolve retries",
        sessionType: "CODING",
      }),
    );

    expect(next).toEqual([
      {
        ...existing,
        presentation: {
          kind: "agent_session",
          label: "API - Resolve retries",
          sessionType: "CODING",
        },
      },
      sibling,
    ]);
  });

  it("replaces stale presentation on later canonical activation", () => {
    const first = createEntityActivation("agent_session", "session-1", null, {
      kind: "agent_session",
      label: "Old title",
      sessionType: "CODING",
    });
    const initial = upsertOpenItem([], first);
    const refreshed = upsertOpenItem(
      initial,
      createEntityActivation("agent_session", "session-1", null, {
        kind: "agent_session",
        label: "New title",
        sessionType: "VALIDATION",
      }),
    );

    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.firstAddedOrder).toBe(initial[0]?.firstAddedOrder);
    expect(refreshed[0]?.presentation).toMatchObject({
      label: "New title",
      sessionType: "VALIDATION",
    });
  });

  it("inherits the nearest open ancestor's group for a new item", () => {
    const items: OpenItem[] = [
      { entityId: "plan-1", entityType: "plan", groupId: "plan-group" },
      { entityId: "task-1", entityType: "task", groupId: "task-group" },
    ];
    const activation = createEntityActivation(
      "agent_session",
      "session-1",
      [
        createNavigationLineageEntry("plan", "plan-1"),
        createNavigationLineageEntry("task", "task-1"),
      ],
      {
        kind: "agent_session",
        label: "Coding session",
        sessionType: AgentSessionType.Coding,
      },
    );

    expect(upsertOpenItem(items, activation)).toEqual([
      ...items,
      {
        entityId: "session-1",
        entityType: "agent_session",
        firstAddedOrder: 3,
        lineage: activation.lineage,
        presentation: activation.presentation,
        groupId: "task-group",
      },
    ]);
  });

  it("keeps an existing item's group when activation lineage changes", () => {
    const activation = createEntityActivation(
      "agent_session",
      "session-1",
      [createNavigationLineageEntry("task", "task-1")],
      {
        kind: "agent_session",
        label: "Coding session",
        sessionType: AgentSessionType.Coding,
      },
    );
    const existing: OpenItem = {
      entityId: "session-1",
      entityType: "agent_session",
      groupId: "explicit-group",
    };

    expect(
      upsertOpenItem(
        [
          { entityId: "task-1", entityType: "task", groupId: "task-group" },
          existing,
        ],
        activation,
      )[1],
    ).toMatchObject({ groupId: "explicit-group", lineage: activation.lineage });
  });

  it("does not inherit a group for a non-coding session", () => {
    const activation = createEntityActivation(
      "agent_session",
      "session-1",
      [createNavigationLineageEntry("task", "task-1")],
      {
        kind: "agent_session",
        label: "Entity conversation",
        sessionType: AgentSessionType.EntityConversation,
      },
    );

    expect(
      upsertOpenItem(
        [{ entityId: "task-1", entityType: "task", groupId: "task-group" }],
        activation,
      )[1],
    ).not.toHaveProperty("groupId");
  });
});

describe("removeOpenItemBranch", () => {
  it("removes unpinned same-group and ungrouped descendants only", () => {
    const items: OpenItem[] = [
      { entityId: "task-1", entityType: "task", groupId: "group-a" },
      {
        entityId: "same-group",
        entityType: "agent_session",
        groupId: "group-a",
        lineage: [createNavigationLineageEntry("task", "task-1")],
      },
      {
        entityId: "ungrouped",
        entityType: "agent_session",
        lineage: [createNavigationLineageEntry("task", "task-1")],
      },
      {
        entityId: "different-group",
        entityType: "agent_session",
        groupId: "group-b",
        lineage: [createNavigationLineageEntry("task", "task-1")],
      },
      {
        entityId: "pinned-same-group",
        entityType: "agent_session",
        groupId: "group-a",
        pinned: true,
        lineage: [createNavigationLineageEntry("task", "task-1")],
      },
      {
        entityId: "unrelated",
        entityType: "task",
        groupId: "group-a",
      },
    ];

    expect(
      removeOpenItemBranch(items, { entityId: "task-1", entityType: "task" }),
    ).toEqual([items[3], items[4], items[5]]);
  });
});

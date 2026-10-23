import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  EntityType,
  GetAttentionEventsSortEnum,
  type AttentionEventResponse,
} from "../../../api";
import {
  attentionEventKeys,
  prependAttentionEvent,
  type AttentionEventsData,
} from "../attentionEvents";

const buildEvent = (
  overrides: Partial<AttentionEventResponse> = {},
): AttentionEventResponse => ({
  id: overrides.id ?? `evt-${overrides.entityId ?? "x"}`,
  entityType: overrides.entityType ?? EntityType.Task,
  entityId: overrides.entityId ?? "task-1",
  entityName: overrides.entityName ?? "Task 1",
  tab: overrides.tab ?? null,
  focusStart: overrides.focusStart ?? "2026-05-07T10:00:00.000Z",
  focusEnd: overrides.focusEnd ?? "2026-05-07T10:00:00.000Z",
  durationMs: overrides.durationMs ?? 0,
  entity: overrides.entity ?? null,
});

const data = (
  events: AttentionEventResponse[],
  limit: number,
  total = events.length,
): AttentionEventsData => ({
  events,
  pagination: { limit, offset: 0, total },
});

describe("attention event keys", () => {
  it("keys each parameter set under the organization", () => {
    expect(attentionEventKeys.list("org-1", {})).toEqual([
      "attentionEvents",
      "org-1",
      {},
    ]);
    expect(
      attentionEventKeys.list("org-1", {
        limit: 25,
        sort: GetAttentionEventsSortEnum.MostActive,
      }),
    ).not.toEqual(
      attentionEventKeys.list("org-1", {
        limit: 25,
        sort: GetAttentionEventsSortEnum.MostRecent,
      }),
    );
  });
});

describe("prependAttentionEvent", () => {
  it("prepends a fresh event and increments pagination total", () => {
    const client = new QueryClient();
    const key = attentionEventKeys.list("org-1", { limit: 10 });
    client.setQueryData(key, data([buildEvent({ entityId: "task-2" })], 10));

    prependAttentionEvent(client, buildEvent({ entityId: "task-1" }));

    const next = client.getQueryData<AttentionEventsData>(key);
    expect(next?.events.map((event) => event.entityId)).toEqual([
      "task-1",
      "task-2",
    ]);
    expect(next?.pagination.total).toBe(2);
  });

  it("moves an existing entity to the head without growing total", () => {
    const client = new QueryClient();
    const key = attentionEventKeys.list("org-1", { limit: 10 });
    client.setQueryData(
      key,
      data(
        [
          buildEvent({ entityId: "task-2" }),
          buildEvent({ id: "old", entityId: "task-1" }),
        ],
        10,
      ),
    );

    prependAttentionEvent(
      client,
      buildEvent({ id: "new", entityId: "task-1" }),
    );

    const next = client.getQueryData<AttentionEventsData>(key);
    expect(next?.events.map((event) => event.id)).toEqual([
      "new",
      "evt-task-2",
    ]);
    expect(next?.pagination.total).toBe(2);
  });

  it("trims each cached list to its own page limit", () => {
    const client = new QueryClient();
    const small = attentionEventKeys.list("org-1", { limit: 1 });
    const large = attentionEventKeys.list("org-1", { limit: 5 });
    client.setQueryData(small, data([buildEvent({ entityId: "a" })], 1));
    client.setQueryData(large, data([buildEvent({ entityId: "a" })], 5));

    prependAttentionEvent(client, buildEvent({ entityId: "b" }));

    expect(
      client.getQueryData<AttentionEventsData>(small)?.events,
    ).toHaveLength(1);
    expect(
      client.getQueryData<AttentionEventsData>(large)?.events,
    ).toHaveLength(2);
  });

  it("creates nothing when no list is cached", () => {
    const client = new QueryClient();
    prependAttentionEvent(client, buildEvent());
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

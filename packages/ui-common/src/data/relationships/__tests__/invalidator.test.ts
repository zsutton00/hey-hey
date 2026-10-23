import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../coordinator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../coordinator")>();
  return {
    ...actual,
    routeMarkStale: vi.fn(actual.routeMarkStale),
  };
});

import {
  loadConfig,
  resetConfig,
  type InvalidationConfig,
  type InvalidationRule,
} from "../config";
import * as coordinator from "../coordinator";
import {
  invalidateForEntity,
  type CollectionInvalidator,
  type InvalidationContext,
} from "../invalidator";
import type { QueryKey } from "../../core/types";

const routeMarkStaleMock = vi.mocked(coordinator.routeMarkStale);

function sentinelKey(label: string): QueryKey {
  return { __sentinel: label } as unknown as QueryKey;
}

function makeConfig(rules: InvalidationRule[]): InvalidationConfig {
  return {
    version: "test",
    generatedAt: "2026-04-25T00:00:00.000Z",
    rules,
  };
}

function makeCollection(
  overrides: Partial<CollectionInvalidator> = {}
): CollectionInvalidator {
  return {
    dispatch: vi.fn(),
    ...overrides,
  };
}

describe("invalidateForEntity", () => {
  beforeEach(() => {
    resetConfig();
    routeMarkStaleMock.mockClear();
  });

  it("throws when called before loadConfig (boot-ordering)", () => {
    expect(() => invalidateForEntity("Task", "update", undefined, {})).toThrow(
      /has not been loaded/
    );
  });

  it("throws when no invalidator is registered for a target collection", () => {
    loadConfig(
      makeConfig([
        {
          sourceEntity: "Task",
          sourceFields: ["id"],
          targetCollections: ["Plan"],
          relationshipPath: "tasks",
          cardinality: "1:1",
          lookupField: "taskId",
          invalidationMode: "invalidate",
        },
      ])
    );

    expect(() =>
      invalidateForEntity("Task", "update", { id: "t1" }, {})
    ).toThrow(/No invalidator registered for collection "Plan"/);
  });

  describe("invalidate mode", () => {
    it("1:1 marks the collection scope key stale once", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Service",
            sourceFields: ["id"],
            targetCollections: ["CodingSession"],
            relationshipPath: "service",
            cardinality: "1:1",
            lookupField: "serviceId",
            invalidationMode: "invalidate",
          },
        ])
      );

      const scopeKey = sentinelKey("CodingSession:list:svc-1");
      const buildScopeKey = vi.fn(() => scopeKey);
      const dispatch = vi.fn();

      const ctx: InvalidationContext = {
        CodingSession: makeCollection({ dispatch, buildScopeKey }),
      };

      invalidateForEntity("Service", "update", { id: "svc-1" }, ctx);

      expect(buildScopeKey).toHaveBeenCalledTimes(1);
      expect(buildScopeKey).toHaveBeenCalledWith({
        lookupField: "serviceId",
        lookupValue: "svc-1",
        dataVariantKey: undefined,
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch).toHaveBeenCalledWith({
        type: "MARK_STALE",
        queryKey: scopeKey,
      });
    });

    it("1:many fans out across every value extracted from sourceEntity", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Project",
            sourceFields: ["taskIds"],
            targetCollections: ["WorkItem"],
            relationshipPath: "tasks",
            cardinality: "1:many",
            lookupField: "taskId",
            invalidationMode: "invalidate",
          },
        ])
      );

      const buildScopeKey = vi.fn((filter) =>
        sentinelKey(`WorkItem:list:${filter.lookupValue}`)
      );
      const dispatch = vi.fn();

      const ctx: InvalidationContext = {
        WorkItem: makeCollection({ dispatch, buildScopeKey }),
      };

      invalidateForEntity(
        "Project",
        "update",
        { taskIds: ["t1", "t2", "t3"] },
        ctx
      );

      expect(buildScopeKey).toHaveBeenCalledTimes(3);
      expect(dispatch).toHaveBeenCalledTimes(3);
      expect(dispatch.mock.calls.map((c) => c[0].queryKey)).toEqual([
        sentinelKey("WorkItem:list:t1"),
        sentinelKey("WorkItem:list:t2"),
        sentinelKey("WorkItem:list:t3"),
      ]);
    });

    it("forwards dataVariantKey to buildScopeKey", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Service",
            sourceFields: ["id"],
            targetCollections: ["CodingSession"],
            relationshipPath: "service",
            cardinality: "1:1",
            lookupField: "serviceId",
            invalidationMode: "invalidate",
            dataVariantKey: {
              queryParam: "includeArchived",
              requiredValue: "true",
            },
          },
        ])
      );

      const buildScopeKey = vi.fn(() => sentinelKey("scoped"));
      const ctx: InvalidationContext = {
        CodingSession: makeCollection({ buildScopeKey }),
      };

      invalidateForEntity("Service", "update", { id: "svc-1" }, ctx);

      expect(buildScopeKey).toHaveBeenCalledWith({
        lookupField: "serviceId",
        lookupValue: "svc-1",
        dataVariantKey: {
          queryParam: "includeArchived",
          requiredValue: "true",
        },
      });
    });

    it("falls back to a single undefined value when sourceEntity is omitted", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Service",
            sourceFields: ["id"],
            targetCollections: ["CodingSession"],
            relationshipPath: "service",
            cardinality: "1:1",
            lookupField: "serviceId",
            invalidationMode: "invalidate",
          },
        ])
      );

      const buildScopeKey = vi.fn(() => sentinelKey("unfiltered"));
      const ctx: InvalidationContext = {
        CodingSession: makeCollection({ buildScopeKey }),
      };

      invalidateForEntity("Service", "update", undefined, ctx);

      expect(buildScopeKey).toHaveBeenCalledTimes(1);
      expect(buildScopeKey).toHaveBeenCalledWith({
        lookupField: "serviceId",
        lookupValue: undefined,
        dataVariantKey: undefined,
      });
    });

    it("throws when the target collection has no buildScopeKey", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Service",
            sourceFields: ["id"],
            targetCollections: ["CodingSession"],
            relationshipPath: "service",
            cardinality: "1:1",
            lookupField: "serviceId",
            invalidationMode: "invalidate",
          },
        ])
      );

      const ctx: InvalidationContext = {
        CodingSession: makeCollection(),
      };

      expect(() =>
        invalidateForEntity("Service", "update", { id: "svc-1" }, ctx)
      ).toThrow(/has no buildScopeKey/);
    });
  });

  describe("cascade mode", () => {
    it("walks sourceFields to derive each child item key", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Plan",
            sourceFields: ["taskIds"],
            targetCollections: ["WorkItem"],
            relationshipPath: "tasks",
            cardinality: "1:many",
            lookupField: "taskId",
            invalidationMode: "cascade",
          },
        ])
      );

      const buildItemKey = vi.fn((params) =>
        sentinelKey(`WorkItem:item:${params.id}`)
      );
      const dispatch = vi.fn();

      const ctx: InvalidationContext = {
        WorkItem: makeCollection({ dispatch, buildItemKey }),
      };

      invalidateForEntity(
        "Plan",
        "update",
        { id: "p1", taskIds: ["t1", "t2"] },
        ctx
      );

      expect(buildItemKey).toHaveBeenCalledTimes(2);
      expect(buildItemKey.mock.calls.map((c) => c[0].id)).toEqual(["t1", "t2"]);
      expect(dispatch).toHaveBeenCalledTimes(2);
    });

    it("1:1 produces a single child item key from the first derived value", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Conversation",
            sourceFields: ["taskId"],
            targetCollections: ["WorkItem"],
            relationshipPath: "task",
            cardinality: "1:1",
            lookupField: "id",
            invalidationMode: "cascade",
          },
        ])
      );

      const buildItemKey = vi.fn(() => sentinelKey("WorkItem:item:t9"));
      const dispatch = vi.fn();

      const ctx: InvalidationContext = {
        WorkItem: makeCollection({ dispatch, buildItemKey }),
      };

      invalidateForEntity("Conversation", "update", { taskId: "t9" }, ctx);

      expect(buildItemKey).toHaveBeenCalledTimes(1);
      expect(buildItemKey).toHaveBeenCalledWith({
        id: "t9",
        dataVariantKey: undefined,
      });
      expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it("forwards dataVariantKey to buildItemKey", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Plan",
            sourceFields: ["taskIds"],
            targetCollections: ["WorkItem"],
            relationshipPath: "tasks",
            cardinality: "1:1",
            lookupField: "taskId",
            invalidationMode: "cascade",
            dataVariantKey: { queryParam: "view", requiredValue: "summary" },
          },
        ])
      );

      const buildItemKey = vi.fn(() => sentinelKey("scoped"));
      const ctx: InvalidationContext = {
        WorkItem: makeCollection({ buildItemKey }),
      };

      invalidateForEntity("Plan", "update", { taskIds: ["t1"] }, ctx);

      expect(buildItemKey).toHaveBeenCalledWith({
        id: "t1",
        dataVariantKey: { queryParam: "view", requiredValue: "summary" },
      });
    });

    it("skips dispatch when sourceEntity yields no values for cascade", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Plan",
            sourceFields: ["taskIds"],
            targetCollections: ["WorkItem"],
            relationshipPath: "tasks",
            cardinality: "1:many",
            lookupField: "taskId",
            invalidationMode: "cascade",
          },
        ])
      );

      const buildItemKey = vi.fn(() => sentinelKey("never"));
      const dispatch = vi.fn();

      const ctx: InvalidationContext = {
        WorkItem: makeCollection({ dispatch, buildItemKey }),
      };

      invalidateForEntity("Plan", "update", undefined, ctx);

      expect(buildItemKey).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("throws when the target collection has no buildItemKey", () => {
      loadConfig(
        makeConfig([
          {
            sourceEntity: "Plan",
            sourceFields: ["taskIds"],
            targetCollections: ["WorkItem"],
            relationshipPath: "tasks",
            cardinality: "1:1",
            lookupField: "taskId",
            invalidationMode: "cascade",
          },
        ])
      );

      const ctx: InvalidationContext = {
        WorkItem: makeCollection(),
      };

      expect(() =>
        invalidateForEntity("Plan", "update", { taskIds: ["t1"] }, ctx)
      ).toThrow(/has no buildItemKey/);
    });
  });

  it("routes every dispatch through routeMarkStale", () => {
    loadConfig(
      makeConfig([
        {
          sourceEntity: "Service",
          sourceFields: ["id"],
          targetCollections: ["CodingSession"],
          relationshipPath: "service",
          cardinality: "1:1",
          lookupField: "serviceId",
          invalidationMode: "invalidate",
        },
        {
          sourceEntity: "Service",
          sourceFields: ["taskIds"],
          targetCollections: ["WorkItem"],
          relationshipPath: "tasks",
          cardinality: "1:many",
          lookupField: "taskId",
          invalidationMode: "cascade",
        },
      ])
    );

    const ctx: InvalidationContext = {
      CodingSession: makeCollection({
        buildScopeKey: () => sentinelKey("scope"),
      }),
      WorkItem: makeCollection({
        buildItemKey: (p) => sentinelKey(`item:${p.id}`),
      }),
    };

    invalidateForEntity(
      "Service",
      "update",
      { id: "svc-1", taskIds: ["t1", "t2"] },
      ctx
    );

    // 1 (invalidate, 1:1) + 2 (cascade, 1:many) = 3 routed dispatches
    expect(routeMarkStaleMock).toHaveBeenCalledTimes(3);
    for (const call of routeMarkStaleMock.mock.calls) {
      expect(call[0].type).toBe("MARK_STALE");
    }
  });
});

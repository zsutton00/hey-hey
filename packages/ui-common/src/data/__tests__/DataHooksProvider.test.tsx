import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useEffect } from "react";

import { DataHooksProvider } from "../DataHooksProvider";
import type { QueryKey } from "@tanstack/react-query";
import {
  getRelatedEntities,
  initRelationshipConfig,
  invalidateForEntity,
  resetConfig,
  type CollectionInvalidator,
  type InvalidationConfig,
  type InvalidationContext,
} from "../relationships";

function makeValidConfig(): InvalidationConfig {
  return {
    version: "1.0.0",
    generatedAt: "2026-05-18T00:00:00.000Z",
    rules: [
      {
        sourceEntity: "Service",
        sourceFields: ["id", "name"],
        targetCollections: ["CodingSession"],
        relationshipPath: "service",
        cardinality: "1:many",
        lookupField: "serviceId",
        invalidationMode: "invalidate",
      },
    ],
  };
}

describe("DataHooksProvider boot ordering", () => {
  beforeEach(() => {
    resetConfig();
  });

  it("loads relationship rules synchronously so descendants see them on first render", () => {
    const observed: ReturnType<typeof getRelatedEntities>[] = [];

    const Descendant = () => {
      observed.push(getRelatedEntities("Service", "update"));
      return null;
    };

    render(
      <DataHooksProvider relationshipRules={makeValidConfig()}>
        <Descendant />
      </DataHooksProvider>
    );

    expect(observed).toHaveLength(1);
    expect(observed[0]).toHaveLength(1);
    expect(observed[0][0].collection).toBe("CodingSession");
  });

  it("lets invalidateForEntity run from a descendant without throwing the 'not loaded' error", () => {
    const errors: unknown[] = [];

    const Descendant = () => {
      useEffect(() => {
        const scopeKey: QueryKey = ["sentinel", "scope"];
        const collection: CollectionInvalidator = {
          dispatch: () => {},
          buildScopeKey: () => scopeKey,
        };
        const context: InvalidationContext = { CodingSession: collection };
        try {
          invalidateForEntity("Service", "update", { id: "svc-1" }, context);
        } catch (err) {
          errors.push(err);
        }
      }, []);
      return null;
    };

    render(
      <DataHooksProvider relationshipRules={makeValidConfig()}>
        <Descendant />
      </DataHooksProvider>
    );

    expect(errors).toEqual([]);
  });

  it("leaves getRelatedEntities throwing 'not loaded' when relationshipRules prop is omitted", () => {
    const errors: unknown[] = [];

    const Descendant = () => {
      try {
        getRelatedEntities("Service", "update");
      } catch (err) {
        errors.push(err);
      }
      return null;
    };

    render(
      <DataHooksProvider>
        <Descendant />
      </DataHooksProvider>
    );

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/config has not been loaded/);
  });
});

describe("initRelationshipConfig", () => {
  beforeEach(() => {
    resetConfig();
  });

  it("is a no-op when called twice with the same payload", () => {
    const payload = makeValidConfig();
    initRelationshipConfig(payload);
    expect(() => initRelationshipConfig(payload)).not.toThrow();

    // Equivalent (deep-equal) payloads also count as the same.
    const clone = JSON.parse(JSON.stringify(payload)) as InvalidationConfig;
    expect(() => initRelationshipConfig(clone)).not.toThrow();
  });

  it("throws when called a second time with a conflicting payload", () => {
    const first = makeValidConfig();
    initRelationshipConfig(first);

    const second = makeValidConfig();
    second.rules = [
      {
        sourceEntity: "Task",
        sourceFields: ["id"],
        targetCollections: ["Plan"],
        relationshipPath: "tasks",
        cardinality: "1:many",
        lookupField: "taskId",
        invalidationMode: "cascade",
      },
    ];

    expect(() => initRelationshipConfig(second)).toThrow(
      /conflicting payloads/
    );
  });

  it("accepts a fresh payload after resetConfig()", () => {
    initRelationshipConfig(makeValidConfig());
    resetConfig();

    const replacement = makeValidConfig();
    replacement.version = "2.0.0";
    expect(() => initRelationshipConfig(replacement)).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRelationshipMutationInvalidator,
  type RelationshipMutationInvalidationDispatches,
} from "../relationshipMutationInvalidation";
import { initiativeKeys } from "../../collections/initiatives";
import { designDocKeys } from "../../collections/designDocs";
import {
  loadConfig,
  resetConfig,
  type InvalidationConfig,
} from "../../relationships";

function makeConfig(): InvalidationConfig {
  return {
    version: "1",
    generatedAt: "2026-07-08T00:00:00.000Z",
    rules: [
      {
        sourceEntity: "Task",
        sourceFields: ["projectId"],
        targetCollections: ["DesignDoc"],
        relationshipPath: "Task.project.designDocs",
        cardinality: "1:1",
        lookupField: "projectId",
        invalidationMode: "invalidate",
      },
    ],
  };
}

function makeDispatches(): RelationshipMutationInvalidationDispatches {
  return {
    invalidateInitiativeChange: vi.fn(),
    invalidateQueryKey: vi.fn(),
    invalidateQueries: vi.fn(),
    invalidateWorkItemChange: vi.fn(),
  };
}

describe("createRelationshipMutationInvalidator", () => {
  afterEach(() => {
    resetConfig();
  });

  it("marks configured target collections stale after a source mutation", () => {
    loadConfig(makeConfig());
    const dispatches = makeDispatches();
    const invalidate = createRelationshipMutationInvalidator(dispatches);

    invalidate({
      entityType: "Task",
      operation: "update",
      sourceEntity: {
        id: "task-1",
        organizationId: "org-1",
        projectId: "project-1",
      },
    });

    expect(dispatches.invalidateQueries).toHaveBeenCalledWith({
      queryKey: designDocKeys.list("org-1", { projectId: "project-1" }),
    });
    expect(dispatches.invalidateWorkItemChange).toHaveBeenCalledTimes(1);
    expect(dispatches.invalidateWorkItemChange).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "task-1"
    );
  });

  it("retains related initiative cascades while skipping the change's own refresh", () => {
    loadConfig({
      version: "test",
      generatedAt: "2026-10-01T00:00:00Z",
      rules: [
        {
          sourceEntity: "Initiative",
          sourceFields: ["relatedInitiativeId"],
          targetCollections: ["Initiative"],
          relationshipPath: "relatedInitiatives",
          cardinality: "1:1",
          lookupField: "id",
          invalidationMode: "cascade",
        },
      ],
    });
    const dispatches = makeDispatches();
    createRelationshipMutationInvalidator(dispatches)({
      entityType: "Initiative",
      operation: "update",
      sourceEntity: {
        id: "changed",
        organizationId: "org",
        projectId: "project",
        relatedInitiativeId: "related",
      },
    });
    expect(dispatches.invalidateInitiativeChange).toHaveBeenCalledWith(
      "org",
      "project",
      "changed"
    );
    expect(dispatches.invalidateQueries).toHaveBeenCalledWith({
      queryKey: initiativeKeys.detail("org", "related"),
    });
  });

  it("skips without dispatching when relationship config is not loaded", () => {
    const dispatches = makeDispatches();
    const invalidate = createRelationshipMutationInvalidator(dispatches);

    expect(() =>
      invalidate({
        entityType: "Task",
        operation: "update",
        sourceEntity: {
          id: "task-1",
          organizationId: "org-1",
          projectId: "project-1",
        },
      })
    ).not.toThrow();
    expect(dispatches.invalidateQueries).not.toHaveBeenCalled();
    // The task's own work-item reads are refreshed without relationship config.
    expect(dispatches.invalidateWorkItemChange).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "task-1"
    );
  });
});

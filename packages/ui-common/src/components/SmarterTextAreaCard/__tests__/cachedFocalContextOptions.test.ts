import { describe, expect, it } from "vitest";
import {
  EntityType,
  RelationshipValue,
  type ContextRelatedEntityDto,
  type FullEntityContextDto,
} from "../../../api";
import { QueryClient } from "@tanstack/react-query";
import { entityContextKeys } from "../../../data/collections/entityContext";
import {
  normalizeCachedRelatedEntities,
  readCachedFocalContextOptions,
} from "../slashCommands/cachedFocalContextOptions";

const relatedEntity = (
  overrides: Partial<ContextRelatedEntityDto>,
): ContextRelatedEntityDto => ({
  entityId: "related-task",
  entityType: EntityType.Task,
  displayName: "Related task",
  relationship: RelationshipValue.RelatedTo,
  taskType: "STANDARD",
  status: "ACTIVE",
  ...overrides,
});

const cachedState = (
  context: FullEntityContextDto,
  organizationId = "org-1",
  projectId = "project-1",
): QueryClient => {
  const client = new QueryClient();
  client.setQueryData(
    entityContextKeys.context({
      organizationId,
      projectId,
      entityType: context.entityType,
      entityId: context.entityId,
      includeRelatedEntities: true,
    }),
    context,
  );
  return client;
};

describe("cached focal Context options", () => {
  it("normalizes compatible rows and excludes archived and other task types", () => {
    expect(
      normalizeCachedRelatedEntities(
        [
          relatedEntity({ entityId: "standard" }),
          relatedEntity({ entityId: "bug", taskType: "BUG" }),
          relatedEntity({ entityId: "archived", status: "ARCHIVED" }),
        ],
        ["STANDARD"],
      ),
    ).toEqual([
      {
        id: "standard",
        type: "task",
        name: "Related task",
        status: "ACTIVE",
        metadata: { taskType: "STANDARD" },
      },
    ]);
  });

  it("carries the registry key of non-task work items for mention insertion", () => {
    expect(
      normalizeCachedRelatedEntities(
        [
          relatedEntity({ entityId: "mockup", taskType: "mockups_v2" }),
          relatedEntity({ entityId: "contract", taskType: "CONTRACT" }),
        ],
        [],
      ).map(({ id, type, metadata }) => ({ id, type, metadata })),
    ).toEqual([
      { id: "mockup", type: "task", metadata: { taskType: "mockups_v2" } },
      { id: "contract", type: "task", metadata: { taskType: "CONTRACT" } },
    ]);
  });

  it("reads only a matching cached Context query that includes related entities", () => {
    const context: FullEntityContextDto = {
      entityId: "focus-1",
      entityType: EntityType.Task,
      displayName: "Focus",
      createdAt: "2026-07-15T00:00:00.000Z",
      relatedEntities: [relatedEntity({ entityId: "likely-task" })],
    };
    const state = cachedState(context);

    expect(
      readCachedFocalContextOptions(
        state,
        "org-1",
        "project-1",
        { kind: "entity", entityType: EntityType.Task, entityId: "focus-1" },
        ["STANDARD"],
      ).map((entity) => entity.id),
    ).toEqual(["likely-task"]);
    expect(
      readCachedFocalContextOptions(
        state,
        "org-1",
        "another-project",
        { kind: "entity", entityType: EntityType.Task, entityId: "focus-1" },
        ["STANDARD"],
      ),
    ).toEqual([]);
    expect(
      readCachedFocalContextOptions(
        state,
        "org-1",
        "project-1",
        { kind: "none" },
        ["STANDARD"],
      ),
    ).toEqual([]);
  });

  it("ignores an earlier Context variant that did not request related entities", () => {
    const context: FullEntityContextDto = {
      entityId: "focus-1",
      entityType: EntityType.Task,
      displayName: "Focus",
      createdAt: "2026-07-15T00:00:00.000Z",
      relatedEntities: [relatedEntity({ entityId: "likely-task" })],
    };
    const state = cachedState(context);
    const unrelatedVariantKey = entityContextKeys.context({
      organizationId: "org-1",
      projectId: "project-1",
      entityType: context.entityType,
      entityId: context.entityId,
      includeFeatureHierarchy: true,
    });
    state.setQueryData(unrelatedVariantKey, {
      ...context,
      relatedEntities: undefined,
    });

    expect(
      readCachedFocalContextOptions(
        state,
        "org-1",
        "project-1",
        { kind: "entity", entityType: EntityType.Task, entityId: "focus-1" },
        ["STANDARD"],
      ).map((entity) => entity.id),
    ).toEqual(["likely-task"]);
  });

  it("indexes fetched Context by focal entity id and includes feature hierarchy rows", () => {
    const context: FullEntityContextDto = {
      entityId: "feature-focus",
      entityType: EntityType.Task,
      displayName: "Feature focus",
      createdAt: "2026-07-15T00:00:00.000Z",
      featureHierarchy: [
        {
          id: "related-feature",
          name: "Related feature",
          relationshipType: "RELATED_TO",
          direction: "outbound",
        },
      ],
    };
    const state = cachedState(context);

    expect(state.getQueryCache().getAll()).toHaveLength(1);
    expect(
      readCachedFocalContextOptions(
        state,
        "org-1",
        "project-1",
        {
          kind: "entity",
          entityType: EntityType.Task,
          entityId: "feature-focus",
        },
        ["FEATURE"],
      ),
    ).toEqual([
      {
        id: "related-feature",
        type: "feature",
        name: "Related feature",
        description: undefined,
      },
    ]);
  });

  it("includes registered custom work-item types such as contracts", () => {
    expect(
      normalizeCachedRelatedEntities(
        [relatedEntity({ entityId: "contract", taskType: "CONTRACT" })],
        ["CONTRACT"],
      ),
    ).toEqual([
      {
        id: "contract",
        type: "task",
        name: "Related task",
        status: "ACTIVE",
        metadata: { taskType: "CONTRACT" },
      },
    ]);
  });
});

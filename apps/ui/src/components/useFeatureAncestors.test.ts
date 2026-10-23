import {
  FeatureHierarchyEntryDtoRelationshipEnum,
  FeatureHierarchyEntryDtoRelationshipTypeEnum,
  type FeatureHierarchyEntryDto,
} from "@hey-hey/ui-common/api";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFeatureAncestors } from "./useFeatureAncestors";

const features = new Map<string, { name: string; parentTaskId: string | null }>(
  [
    ["feature-root", { name: "Root", parentTaskId: null }],
    ["feature-child", { name: "Child", parentTaskId: "feature-root" }],
  ],
);

const lookupState = { isReady: true, isLoading: false };

const resolveAncestry = (startId: string | null) => {
  const ancestors: { id: string; name: string }[] = [];
  let currentId = startId;
  while (currentId) {
    const feature = features.get(currentId);
    if (!feature) return { ancestors: [], complete: false };
    ancestors.unshift({ id: currentId, name: feature.name });
    currentId = feature.parentTaskId;
  }
  return { ancestors, complete: true };
};

vi.mock("@hey-hey/ui-common/data", () => ({
  useFeatureLookup: () => ({ ...lookupState, resolveAncestry }),
}));

const serverHierarchy: FeatureHierarchyEntryDto[] = [
  {
    id: "server-parent",
    name: "Server Parent",
    relationshipType: FeatureHierarchyEntryDtoRelationshipTypeEnum.Structural,
    relationship: FeatureHierarchyEntryDtoRelationshipEnum.Ancestor,
    distance: 1,
  },
  {
    id: "server-root",
    name: "Server Root",
    relationshipType: FeatureHierarchyEntryDtoRelationshipTypeEnum.Structural,
    relationship: FeatureHierarchyEntryDtoRelationshipEnum.Ancestor,
    distance: 2,
  },
];

const render = (params: Partial<Parameters<typeof useFeatureAncestors>[0]>) =>
  renderHook(() =>
    useFeatureAncestors({
      organizationId: "org-1",
      projectId: "project-1",
      task: null,
      fallbackHierarchy: serverHierarchy,
      ...params,
    }),
  ).result.current;

describe("useFeatureAncestors", () => {
  beforeEach(() => {
    lookupState.isReady = true;
    lookupState.isLoading = false;
  });

  it("resolves root-first ancestors from the cached hierarchy", () => {
    const result = render({
      task: { id: "task-1", parentTaskId: "feature-child" },
    });

    expect(result.ancestors).toEqual([
      { id: "feature-root", name: "Root" },
      { id: "feature-child", name: "Child" },
    ]);
    expect(result.isFromCache).toBe(true);
    expect(result.needsFallback).toBe(false);
  });

  it("steps over one non-feature parent via the loaded parent", () => {
    const result = render({
      task: { id: "task-1", parentTaskId: "task-parent" },
      parent: { id: "task-parent", parentTaskId: "feature-child" },
    });

    expect(result.ancestors.map((ancestor) => ancestor.id)).toEqual([
      "feature-root",
      "feature-child",
    ]);
    expect(result.isFromCache).toBe(true);
  });

  it("uses the server hierarchy when the chain passes beyond the loaded parent", () => {
    const result = render({
      task: { id: "task-1", parentTaskId: "task-parent" },
      parent: { id: "task-parent", parentTaskId: "task-grandparent" },
    });

    expect(result.ancestors).toEqual([
      { id: "server-root", name: "Server Root" },
      { id: "server-parent", name: "Server Parent" },
    ]);
    expect(result.isFromCache).toBe(false);
    expect(result.needsFallback).toBe(true);
  });

  it("does not request the fallback while the cached hierarchy loads", () => {
    lookupState.isReady = false;
    lookupState.isLoading = true;

    const result = render({
      task: { id: "task-1", parentTaskId: "feature-child" },
      fallbackHierarchy: undefined,
    });

    expect(result.ancestors).toEqual([]);
    expect(result.isLoading).toBe(true);
    expect(result.needsFallback).toBe(false);
  });
});

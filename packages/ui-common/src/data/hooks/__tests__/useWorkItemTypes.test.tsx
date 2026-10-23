import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useAllowedChildWorkItemTypes,
  useAllowedParentEntityTypes,
  useCanParentEntityType,
  useTrackingTargetWorkItemTypes,
  useWorkItemTypes,
  useWorkItemTypeByKey,
} from "../useWorkItemTypes";
import { workItemTypeKeys } from "../../collections/workItemTypes";
import {
  EntityType,
  WorkItemTypeLifecycleStatus,
  type WorkItemTypeSummaryDto,
} from "../../../api";

// Reads in this suite come from a seeded cache; a network read is a failure.
const { catalogRead, byKeyRead } = vi.hoisted(() => ({
  catalogRead: vi.fn(),
  byKeyRead: vi.fn(),
}));
vi.mock("../../../clients", () => ({ dataClient: { request: catalogRead } }));
vi.mock("../../../clients/runtime", () => ({
  getApiRuntime: () => ({ transport: { axios: {} } }),
}));
vi.mock("../../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api")>()),
  WorkItemTypesApi: class {
    organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyGet =
      byKeyRead;
  },
}));

const pending = () => new Promise<never>(() => {});

function createHarness() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const seedCatalog = (entries: unknown[]) =>
    queryClient.setQueryData(
      workItemTypeKeys.catalog("org-1", "project-1"),
      entries as WorkItemTypeSummaryDto[]
    );
  const seedType = (typeKey: string, summary: unknown) =>
    queryClient.setQueryData(
      workItemTypeKeys.byKey("org-1", "project-1", typeKey),
      summary as WorkItemTypeSummaryDto | null
    );
  return { queryClient, wrapper, seedCatalog, seedType };
}

beforeEach(() => {
  vi.clearAllMocks();
  catalogRead.mockImplementation(pending);
  byKeyRead.mockImplementation(pending);
});

describe("useWorkItemTypes", () => {
  const entry = (key: string, status: WorkItemTypeLifecycleStatus) => ({
    id: key,
    definition: {
      key,
      name: key,
      sections: [],
      allowedStatuses: ["ACTIVE"],
    },
    status,
    projectId: "project-1",
  });
  const marketing = entry("MARKETING", WorkItemTypeLifecycleStatus.Active);
  const legacy = entry("LEGACY", WorkItemTypeLifecycleStatus.Archived);

  it("returns the cached project catalog", () => {
    const { wrapper, seedCatalog } = createHarness();
    seedCatalog([marketing, legacy]);

    const { result } = renderHook(
      () => useWorkItemTypes("org-1", { projectId: "project-1" }),
      { wrapper }
    );

    expect(result.current.workItemTypes).toEqual([marketing, legacy]);
    expect(result.current.data).toBe(result.current.workItemTypes);
    expect(result.current.isReady).toBe(true);
    expect(catalogRead).not.toHaveBeenCalled();
  });

  it.each([
    [WorkItemTypeLifecycleStatus.Active, "MARKETING"],
    [WorkItemTypeLifecycleStatus.Archived, "LEGACY"],
  ])("narrows the catalog to %s types without a request", (status, key) => {
    const { wrapper, seedCatalog } = createHarness();
    seedCatalog([marketing, legacy]);

    const { result } = renderHook(
      () => useWorkItemTypes("org-1", { projectId: "project-1", status }),
      { wrapper }
    );

    expect(
      result.current.workItemTypes.map((type) => type.definition.key)
    ).toEqual([key]);
    expect(catalogRead).not.toHaveBeenCalled();
  });

  it.each([
    ["organization", undefined, "project-1"],
    ["projectId", "org-1", undefined],
  ])("stays idle without %s", (_missing, organizationId, projectId) => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => useWorkItemTypes(organizationId, { projectId }),
      { wrapper }
    );

    expect(catalogRead).not.toHaveBeenCalled();
    expect(result.current.workItemTypes).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetched).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("stays idle when the caller disables it", () => {
    const { wrapper } = createHarness();

    renderHook(
      () => useWorkItemTypes("org-1", { projectId: "project-1", enabled: false }),
      { wrapper }
    );

    expect(catalogRead).not.toHaveBeenCalled();
  });

  it("presents an in-flight first read as loading, not failed", () => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => useWorkItemTypes("org-1", { projectId: "project-1" }),
      { wrapper }
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isFetched).toBe(false);
    expect(result.current.isReady).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.workItemTypes).toEqual([]);
  });
});

describe("work-item type relationship hooks", () => {
  it("keeps selector results unavailable until the complete snapshot is ready", () => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => ({
        children: useAllowedChildWorkItemTypes("org-1", "project-1", "FEATURE"),
        parents: useAllowedParentEntityTypes(
          "org-1",
          "project-1",
          "DESIGN_DOC"
        ),
        canParent: useCanParentEntityType(
          "org-1",
          "project-1",
          EntityType.Task,
          "DESIGN_DOC"
        ),
      }),
      { wrapper }
    );

    expect(result.current.children.allowedChildTypes).toBeUndefined();
    expect(result.current.children.relationshipIndex).toBeUndefined();
    expect(result.current.parents.allowedParentEntityTypes).toBeUndefined();
    expect(result.current.canParent.canParent).toBeUndefined();
    expect(catalogRead).toHaveBeenCalledTimes(1);
  });

  it("reprojects active canonical and custom types when the snapshot changes", () => {
    const entry = (
      key: string,
      allowedParentTypes: string[] = [],
      status = WorkItemTypeLifecycleStatus.Active
    ) => ({
      id: key,
      projectId: "project-1",
      status,
      definition: {
        key,
        allowedParentTypes,
        tracking: {
          allowedSourceEntityTypes: [],
          allowedSourceTaskTypes: [],
        },
      },
    });
    const { wrapper, seedCatalog } = createHarness();
    seedCatalog([entry("FEATURE"), entry("STANDARD", ["FEATURE"])]);

    const { result, rerender } = renderHook(
      () => useAllowedChildWorkItemTypes("org-1", "project-1", "FEATURE"),
      { wrapper }
    );
    expect(result.current.allowedChildTypes).toEqual(["STANDARD"]);

    seedCatalog([
      entry("FEATURE"),
      entry("STANDARD", ["FEATURE"], WorkItemTypeLifecycleStatus.Archived),
      entry("CUSTOM_DELIVERABLE", ["FEATURE"]),
    ]);
    rerender();

    expect(result.current.allowedChildTypes).toEqual(["CUSTOM_DELIVERABLE"]);
  });

  it("derives tracking targets from target-owned declarations", () => {
    const { wrapper, seedCatalog } = createHarness();
    seedCatalog([
      {
        id: "GOAL",
        projectId: "project-1",
        status: WorkItemTypeLifecycleStatus.Active,
        definition: {
          key: "GOAL",
          tracking: {
            allowedSourceEntityTypes: [],
            allowedSourceTaskTypes: [],
          },
        },
      },
      {
        id: "CUSTOM_DELIVERABLE",
        projectId: "project-1",
        status: WorkItemTypeLifecycleStatus.Active,
        definition: {
          key: "CUSTOM_DELIVERABLE",
          tracking: {
            allowedSourceEntityTypes: [EntityType.Task],
            allowedSourceTaskTypes: ["GOAL"],
          },
        },
      },
    ]);

    const { result } = renderHook(
      () => useTrackingTargetWorkItemTypes("org-1", "project-1", "GOAL"),
      { wrapper }
    );

    expect(result.current.trackingTargetTaskTypes).toEqual([
      "CUSTOM_DELIVERABLE",
    ]);
  });

  it("exposes entity-type parent constraints and unrestricted empty lists", () => {
    const entry = (key: string, allowedParentEntityTypes: EntityType[]) => ({
      id: key,
      projectId: "project-1",
      status: WorkItemTypeLifecycleStatus.Active,
      definition: {
        key,
        allowedParentEntityTypes,
      },
    });
    const { wrapper, seedCatalog } = createHarness();
    seedCatalog([entry("DESIGN_DOC", [EntityType.Task]), entry("PLAN", [])]);

    const { result } = renderHook(
      () => ({
        allowed: useAllowedParentEntityTypes(
          "org-1",
          "project-1",
          "DESIGN_DOC"
        ),
        constrained: useCanParentEntityType(
          "org-1",
          "project-1",
          EntityType.Project,
          "DESIGN_DOC"
        ),
        unrestricted: useCanParentEntityType(
          "org-1",
          "project-1",
          EntityType.Task,
          "PLAN"
        ),
      }),
      { wrapper }
    );

    expect(result.current.allowed.allowedParentEntityTypes).toEqual([
      EntityType.Task,
    ]);
    expect(result.current.constrained.canParent).toBe(false);
    expect(result.current.unrestricted.canParent).toBe(true);
  });
});

describe("useWorkItemTypeByKey", () => {
  const standardDefinition = {
    key: "STANDARD",
    name: "Standard",
    sections: [],
    allowedStatuses: ["ACTIVE"],
  };

  const epicDefinition = {
    key: "EPIC",
    name: "Epic",
    sections: [],
    allowedStatuses: ["ACTIVE"],
    allowedParentTypes: ["FEATURE"],
  };

  const systemSummary = {
    definition: standardDefinition,
    isSystem: true,
    status: "ACTIVE" as const,
    projectId: null,
  };

  const customSummary = {
    definition: epicDefinition,
    isSystem: false,
    status: "ACTIVE" as const,
    projectId: "project-1",
  };

  const archivedSummary = {
    definition: {
      key: "OLD_EPIC",
      name: "Old Epic",
      sections: [],
      allowedStatuses: ["ACTIVE"],
    },
    isSystem: false,
    status: "ARCHIVED" as const,
    projectId: "project-1",
  };

  it("stays idle until all key parts are present", () => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => useWorkItemTypeByKey("org-1", "project-1", undefined),
      { wrapper }
    );

    expect(byKeyRead).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("returns undefined when the read has no summary", () => {
    const { wrapper, seedType } = createHarness();
    seedType("UNKNOWN", null);

    const { result } = renderHook(
      () => useWorkItemTypeByKey("org-1", "project-1", "UNKNOWN"),
      { wrapper }
    );

    expect(result.current.workItemTypeSummary).toBeUndefined();
    expect(result.current.workItemTypeDefinition).toBeUndefined();
    expect(result.current.isReady).toBe(true);
  });

  it.each([
    ["a seeded core key", "STANDARD", systemSummary],
    ["an active custom type", "EPIC", customSummary],
    ["an archived custom type", "OLD_EPIC", archivedSummary],
  ])("returns full metadata for %s", (_label, typeKey, summary) => {
    const { wrapper, seedType } = createHarness();
    seedType(typeKey, summary);

    const { result } = renderHook(
      () => useWorkItemTypeByKey("org-1", "project-1", typeKey),
      { wrapper }
    );

    expect(result.current.workItemTypeSummary).toEqual(summary);
    expect(result.current.workItemTypeDefinition).toEqual(summary.definition);
    expect(byKeyRead).not.toHaveBeenCalled();
  });
});

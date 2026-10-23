import {
  WorkStatus,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import {
  useFeatureHierarchy,
  useFeatureDocumentContent,
  useWorkItems,
} from "@hey-hey/ui-common/data";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import { ExplorerWorkItemQuery } from "./ExplorerWorkItemQuery";

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItems: vi.fn(),
  useFeatureHierarchy: vi.fn(),
  useFeatureDocumentContent: vi.fn(),
}));

const useWorkItemsMock = vi.mocked(useWorkItems);

const renderQuery = (typeKey: string) =>
  render(
    <ExplorerWorkItemQuery
      organizationId="organization-1"
      projectId="project-1"
      definition={{ key: typeKey } as WorkItemTypeDefinitionDto}
      enabled
      onStateChange={vi.fn()}
    />
  );

describe("ExplorerWorkItemQuery", () => {
  beforeEach(() => {
    vi.mocked(useFeatureHierarchy).mockReturnValue({
      roots: [],
      nodes: new Map(),
      isLoading: false,
      isReady: true,
      isFetching: false,
      error: null,
      resolveRoot: () => null,
    });
    vi.mocked(useFeatureDocumentContent).mockReturnValue({
      entries: new Map(),
      retry: vi.fn(),
    });
    useWorkItemsMock.mockReturnValue({
      error: null,
      isLoading: false,
      workItems: [],
    } as unknown as ReturnType<typeof useWorkItems>);
  });

  it("loads active goals without tracked-entity snapshots", () => {
    renderQuery(WORK_ITEM_TYPE_KEYS.Goal);

    expect(useWorkItemsMock).toHaveBeenCalledWith(
      "organization-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({
        includeTrackedEntities: false,
        status: WorkStatus.Active,
        taskType: WORK_ITEM_TYPE_KEYS.Goal,
      })
    );
  });

  it("loads feature roots from the hierarchy without a work-item structure query", () => {
    renderQuery(WORK_ITEM_TYPE_KEYS.Feature);
    expect(useWorkItemsMock).not.toHaveBeenCalled();
    expect(useFeatureHierarchy).toHaveBeenCalledWith(
      "organization-1",
      "project-1"
    );
    expect(useFeatureDocumentContent).toHaveBeenCalledWith(
      "organization-1",
      "project-1",
      [],
      undefined,
      "metadata"
    );
  });

  it("loads active, execution-ready, and draft plans", () => {
    renderQuery("PLAN");

    expect(useWorkItemsMock).toHaveBeenCalledWith(
      "organization-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({
        status: [WorkStatus.Active, WorkStatus.Ready, WorkStatus.Backlog],
        taskType: "PLAN",
      })
    );
  });

  it("loads custom type roots without imposing built-in status filters", () => {
    renderQuery("CUSTOM_DELIVERABLE");

    const options = useWorkItemsMock.mock.calls[0]?.[4];
    expect(options).toEqual(
      expect.objectContaining({
        parentTaskId: null,
        taskType: "CUSTOM_DELIVERABLE",
      })
    );
    expect(options).not.toHaveProperty("status");
    expect(options).not.toHaveProperty("includeTrackedEntities");
  });
});

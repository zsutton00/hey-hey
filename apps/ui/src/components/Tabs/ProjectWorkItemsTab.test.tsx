import { render } from "@testing-library/react";
import LayersIcon from "@mui/icons-material/Layers";
import { WorkStatus } from "@hey-hey/ui-common/api";
import { useWorkItems } from "@hey-hey/ui-common/data";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import { ProjectWorkItemsTab } from "./ProjectWorkItemsTab";

const mocks = vi.hoisted(() => ({
  entityFilters: vi.fn(),
  queryState: {} as Record<string, unknown>,
  queryStateKeys: [] as string[],
  taskList: vi.fn(),
  useWorkItems: vi.fn(),
}));

vi.mock("nuqs", () => ({
  parseAsBoolean: { withDefault: (value: boolean) => value },
  parseAsInteger: { withDefault: (value: number) => value },
  parseAsString: { withDefault: (value: string) => value },
  parseAsStringLiteral: () => ({ withDefault: (value: string) => value }),
  useQueryState: (key: string) => {
    mocks.queryStateKeys.push(key);
    const defaultValue = key.endsWith("Page")
      ? 1
      : key.endsWith("Sort")
        ? "createdAt:desc"
        : key.endsWith("IncludeDescendants")
          ? false
          : key.endsWith("ParentTaskId")
            ? null
            : "";
    return [mocks.queryState[key] ?? defaultValue, vi.fn()] as const;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  EntityFilters: (props: unknown) => {
    mocks.entityFilters(props);
    return <div data-testid="entity-filters" />;
  },
  FeaturePicker: () => null,
  TaskList: (props: unknown) => {
    mocks.taskList(props);
    return <div data-testid="task-list" />;
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItems: mocks.useWorkItems,
}));

vi.mock("../CardHeader", () => ({
  CardHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

vi.mock("./TabContainer", () => ({
  TabContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseWorkItems = vi.mocked(useWorkItems);

describe("ProjectWorkItemsTab", () => {
  beforeEach(() => {
    mocks.entityFilters.mockReset();
    mocks.queryState = {};
    mocks.queryStateKeys = [];
    mocks.taskList.mockReset();
    mockUseWorkItems.mockReset();
  });

  it.each([
    {
      queryKeyPrefix: "tasks" as const,
      taskType: WORK_ITEM_TYPE_KEYS.Standard,
      title: "Tasks",
      emptyMessage: "No tasks in this project yet.",
    },
    {
      queryKeyPrefix: "bugs" as const,
      taskType: WORK_ITEM_TYPE_KEYS.Bug,
      title: "Bugs",
      emptyMessage: "No bugs in this project yet.",
    },
  ])("uses the $taskType type and $queryKeyPrefix URL state", (input) => {
    mocks.queryState[`${input.queryKeyPrefix}Page`] = 2;
    mocks.queryState[`${input.queryKeyPrefix}Sort`] = "title:asc";
    mocks.queryState[`${input.queryKeyPrefix}Search`] = "match";
    mocks.queryState[`${input.queryKeyPrefix}Status`] = WorkStatus.Active;
    mocks.queryState[`${input.queryKeyPrefix}ParentTaskId`] = "feature-1";
    mocks.queryState[`${input.queryKeyPrefix}IncludeDescendants`] = true;
    const workItems = [
      { name: "A matching item" },
      { name: "A different item" },
    ];
    mockUseWorkItems.mockReturnValue({
      workItems,
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkItems>);

    render(
      <ProjectWorkItemsTab
        organizationId="org-1"
        projectId="project-1"
        {...input}
      />,
    );

    expect(mocks.queryStateKeys).toHaveLength(6);
    expect(mocks.queryStateKeys).toEqual(
      expect.arrayContaining([
        `${input.queryKeyPrefix}Page`,
        `${input.queryKeyPrefix}Sort`,
        `${input.queryKeyPrefix}Search`,
        `${input.queryKeyPrefix}Status`,
        `${input.queryKeyPrefix}ParentTaskId`,
        `${input.queryKeyPrefix}IncludeDescendants`,
      ]),
    );
    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({
        taskType: input.taskType,
        page: 2,
        limit: 50,
        sortBy: "title",
        sortDir: "asc",
        status: WorkStatus.Active,
        includeSectionKeys: ["description"],
        parentTaskId: "feature-1",
        includeDescendants: true,
      }),
    );
    expect(mocks.entityFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        values: {
          search: "match",
          status: WorkStatus.Active,
          parentTaskId: "feature-1",
        },
        sortBy: "title:asc",
        filters: expect.arrayContaining([
          expect.objectContaining({ key: "parentTaskId", icon: LayersIcon }),
        ]),
      }),
    );
    expect(mocks.taskList).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [{ name: "A matching item" }],
        loading: false,
        projectId: "project-1",
        organizationId: "org-1",
        emptyMessage: input.emptyMessage,
      }),
    );
  });

  it("passes loading and empty states through the shared list", () => {
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: true,
    } as unknown as ReturnType<typeof useWorkItems>);

    render(
      <ProjectWorkItemsTab
        organizationId="org-1"
        projectId="project-1"
        taskType={WORK_ITEM_TYPE_KEYS.Bug}
        title="Bugs"
        emptyMessage="No bugs in this project yet."
        queryKeyPrefix="bugs"
      />,
    );

    expect(mocks.taskList).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [],
        loading: true,
        emptyMessage: "No bugs in this project yet.",
      }),
    );
  });

  it("derives isolated URL state for arbitrary stable type keys", () => {
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkItems>);

    render(
      <ProjectWorkItemsTab
        organizationId="org-1"
        projectId="project-1"
        taskType="CUSTOM/type"
        title="Customer Requests"
        emptyMessage="No customer requests in this project yet."
      />,
    );

    const parentKey = mocks.queryStateKeys.find((key) =>
      key.endsWith("ParentTaskId"),
    );
    const prefix = parentKey?.slice(0, -"ParentTaskId".length);
    expect(prefix).toMatch(/^workItems_[0-9a-f]+$/);
    expect(mocks.queryStateKeys).toEqual(
      expect.arrayContaining([
        `${prefix}Page`,
        `${prefix}Sort`,
        `${prefix}Search`,
        `${prefix}Status`,
        `${prefix}ParentTaskId`,
        `${prefix}IncludeDescendants`,
      ]),
    );
    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({ taskType: "CUSTOM/type" }),
    );
  });

  it("shows and requests Newest when task sort URL state is absent", () => {
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useWorkItems>);

    render(
      <ProjectWorkItemsTab
        organizationId="org-1"
        projectId="project-1"
        taskType={WORK_ITEM_TYPE_KEYS.Standard}
        title="Tasks"
        emptyMessage="No tasks in this project yet."
        queryKeyPrefix="tasks"
      />,
    );

    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({ sortBy: "createdAt", sortDir: "desc" }),
    );
    expect(mocks.entityFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        sortBy: "createdAt:desc",
        sortOptions: expect.arrayContaining([
          { value: "createdAt:desc", label: "Newest" },
          { value: "updatedAt:desc", label: "Last Updated" },
        ]),
      }),
    );
  });
});

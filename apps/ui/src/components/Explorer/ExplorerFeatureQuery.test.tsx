import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import {
  useFeatureHierarchy,
  useFeatureDocumentContent,
  useWorkItems,
} from "@hey-hey/ui-common/data";
import { ExplorerWorkItemQuery } from "./ExplorerWorkItemQuery";
import { FeatureChildren } from "./FeatureChildren";
import type { ExplorerTreeNodeProps } from "./types";

vi.mock("@hey-hey/ui-common/data", () => ({
  useFeatureHierarchy: vi.fn(),
  useFeatureDocumentContent: vi.fn(),
  useWorkItems: vi.fn(),
}));
vi.mock("./ExplorerTreeNode", () => ({
  ExplorerTreeNode: ({ node }: ExplorerTreeNodeProps) => (
    <div
      data-testid="feature-node"
      data-has-children={node.hasChildren}
      data-status={node.status}
    >
      {node.name}
    </div>
  ),
}));

const feature = (id: string, status: WorkStatus): TaskResponseDto => ({
  id,
  name: id,
  type: "FEATURE",
  status,
  organizationId: "org",
  projectId: "project",
  source: TaskSource.User,
  childCounts: { total: 10 },
});
const root = feature("Root", WorkStatus.Active);
const child = {
  ...feature("Child", WorkStatus.Backlog),
  parentTaskId: root.id,
};
const inactive = feature("Inactive", WorkStatus.Backlog);
const childNode = { feature: child, children: [] };
const rootNode = { feature: root, children: [childNode] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useFeatureHierarchy).mockReturnValue({
    nodes: new Map([
      [root.id, rootNode],
      [child.id, childNode],
      [inactive.id, { feature: inactive, children: [] }],
    ]),
    roots: [rootNode, { feature: inactive, children: [] }],
    isReady: true,
    isLoading: false,
    isFetching: false,
    error: null,
    resolveRoot: () => rootNode,
  });
});

it("shows a root only when metadata resolves to ACTIVE and uses feature children for expansion", () => {
  const onStateChange = vi.fn();
  vi.mocked(useFeatureDocumentContent).mockReturnValue({
    entries: new Map(),
    retry: vi.fn(),
  });
  const query = (
    <ExplorerWorkItemQuery
      organizationId="org"
      projectId="project"
      definition={{ key: "FEATURE" } as WorkItemTypeDefinitionDto}
      enabled
      onStateChange={onStateChange}
    />
  );
  const { rerender } = render(query);
  expect(onStateChange).toHaveBeenLastCalledWith("FEATURE", {
    workItems: [],
    isLoading: true,
    error: null,
  });
  vi.mocked(useFeatureDocumentContent).mockReturnValue({
    entries: new Map(
      [root, inactive].map((data) => [
        data.id,
        { status: "ready" as const, data },
      ])
    ),
    retry: vi.fn(),
  });
  rerender(React.cloneElement(query));
  expect(onStateChange).toHaveBeenLastCalledWith("FEATURE", {
    workItems: [
      expect.objectContaining({
        id: root.id,
        status: WorkStatus.Active,
        hasFeatureChildren: true,
      }),
    ],
    isLoading: false,
    error: null,
  });
  expect(useWorkItems).not.toHaveBeenCalled();
  expect(useFeatureDocumentContent).toHaveBeenCalledWith(
    "org",
    "project",
    [root.id, inactive.id],
    undefined,
    "metadata"
  );
});

it("renders cached children before status hydration and never treats non-feature children as expandable", () => {
  vi.mocked(useFeatureDocumentContent).mockReturnValue({
    entries: new Map(),
    retry: vi.fn(),
  });
  const children = (
    <FeatureChildren
      parentFeatureId={root.id}
      organizationId="org"
      projectId="project"
      expandedNodes={new Set()}
      onToggleNode={vi.fn()}
      onSelectNode={vi.fn()}
      parentDepth={0}
    />
  );
  const { rerender } = render(children);
  expect(screen.getByText(child.name)).toBeVisible();
  expect(screen.getByTestId("feature-node")).toHaveAttribute(
    "data-has-children",
    "false"
  );
  vi.mocked(useFeatureDocumentContent).mockReturnValue({
    entries: new Map([[child.id, { status: "ready", data: child }]]),
    retry: vi.fn(),
  });
  rerender(React.cloneElement(children));
  expect(screen.getByTestId("feature-node")).toHaveAttribute(
    "data-status",
    WorkStatus.Backlog
  );
  expect(useWorkItems).not.toHaveBeenCalled();
  expect(useFeatureDocumentContent).toHaveBeenCalledWith(
    "org",
    "project",
    [child.id],
    undefined,
    "metadata"
  );
});

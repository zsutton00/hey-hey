import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemTypeLifecycleStatus } from "@hey-hey/ui-common/api";
import { useWorkItemTypeByKey, useWorkItems } from "@hey-hey/ui-common/data";
import { FeaturesTab } from "./FeaturesTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  FeatureList: () => null,
  NewFeatureModal: () => null,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItems: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
}));

const mockUseWorkItems = vi.mocked(useWorkItems);
const mockUseWorkItemTypeByKey = vi.mocked(useWorkItemTypeByKey);

describe("FeaturesTab", () => {
  beforeEach(() => {
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      createTask: vi.fn(),
    } as unknown as ReturnType<typeof useWorkItems>);
  });

  it("shows creation only after the active project-owned Feature definition resolves", () => {
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary: {
        status: WorkItemTypeLifecycleStatus.Active,
        projectId: "project-1",
      },
      isFetched: true,
    } as unknown as ReturnType<typeof useWorkItemTypeByKey>);

    render(<FeaturesTab organizationId="org-1" projectId="project-1" />);

    expect(screen.getByTestId("create-feature-button")).toBeInTheDocument();
  });

  it.each([
    ["registry is still loading", undefined, false],
    [
      "Feature is archived",
      {
        status: WorkItemTypeLifecycleStatus.Archived,
        projectId: "project-1",
      },
      true,
    ],
    [
      "the definition belongs to another project",
      {
        status: WorkItemTypeLifecycleStatus.Active,
        projectId: "project-2",
      },
      true,
    ],
  ])("withholds creation when %s", (_reason, workItemTypeSummary, isFetched) => {
    mockUseWorkItemTypeByKey.mockReturnValue({
      workItemTypeSummary,
      isFetched,
    } as unknown as ReturnType<typeof useWorkItemTypeByKey>);

    render(<FeaturesTab organizationId="org-1" projectId="project-1" />);

    expect(screen.queryByTestId("create-feature-button")).not.toBeInTheDocument();
  });
});

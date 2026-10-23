import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AboutTab } from "./AboutTab";

const mockQueryState: Record<string, string> = {
  view: "insights",
  category: "",
  subfacet: "",
};

vi.mock("nuqs", () => ({
  parseAsString: {
    withDefault: () => ({}),
  },
  useQueryState: (key: string) => [mockQueryState[key] ?? "", vi.fn()],
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useArtifacts: () => ({
    data: [{ id: "insight-1", title: "Delivery insight" }],
    isLoading: false,
    error: null,
  }),
  useTopologyCategorySummaries: () => ({
    summaries: [],
    isLoading: false,
    error: null,
  }),
  useTopologySubfacets: () => ({
    subfacets: [],
    isLoading: false,
    error: null,
  }),
  useTopologyEntitySummaries: () => ({
    summaries: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("./AboutTabComponents", () => ({
  CategoryList: () => <div>Topology categories</div>,
  EntityList: () => <div>Topology entities</div>,
  SubfacetList: () => <div>Topology subfacets</div>,
  TopologyBreadcrumbs: () => <div>Topology breadcrumbs</div>,
  WorkItemTypesList: () => <div>Custom type list</div>,
}));

vi.mock("../../components/Artifact", () => ({
  Artifact: () => <div>Delivery insight</div>,
}));

vi.mock("../../components/Tabs/TabContainer", () => ({
  TabContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("AboutTab", () => {
  beforeEach(() => {
    mockQueryState.view = "insights";
    mockQueryState.category = "";
    mockQueryState.subfacet = "";
  });

  it("retains Insights without rendering Custom Types", () => {
    render(<AboutTab projectId="project-1" />);

    expect(screen.getByRole("tab", { name: "Insights" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Topology" })).toBeInTheDocument();
    expect(screen.getByText("Delivery insight")).toBeInTheDocument();
    expect(screen.queryByText("Work Item Types")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom type list")).not.toBeInTheDocument();
  });

  it("retains the Topology rendering path without Custom Types", () => {
    mockQueryState.view = "topology";
    render(<AboutTab projectId="project-1" />);

    expect(screen.getByText("Topology breadcrumbs")).toBeInTheDocument();
    expect(screen.getByText("Topology categories")).toBeInTheDocument();
    expect(screen.queryByText("Delivery insight")).not.toBeInTheDocument();
    expect(screen.queryByText("Custom type list")).not.toBeInTheDocument();
  });
});

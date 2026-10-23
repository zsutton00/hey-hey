import { render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectAdminTab } from "./ProjectAdminTab";

const mockQueryState: Record<string, string> = {
  adminSubTab: "metadata",
  tab: "admin",
  view: "insights",
  knowledgeBaseSubTab: "contracts",
};
const mockSetQueryState: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("nuqs", () => ({
  parseAsStringLiteral: () => ({
    withDefault: () => ({}),
  }),
  useQueryState: (key: string) => {
    mockSetQueryState[key] ??= vi.fn();
    return [mockQueryState[key] ?? "", mockSetQueryState[key]];
  },
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: ({
    metadataItems,
  }: {
    metadataItems: Array<{ label: string }>;
  }) => <div>{`Metadata panel: ${metadataItems[0]?.label}`}</div>,
}));
vi.mock("@hey-hey/ui-common/components", () => ({
  ProjectTakingShapeSettings: ({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }) => (
    <div
      data-testid="taking-shape-settings"
      data-organization-id={organizationId}
      data-project-id={projectId}
    />
  ),
}));

describe("ProjectAdminTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockQueryState.adminSubTab;
    Object.values(mockSetQueryState).forEach((setter) => setter.mockReset());
  });

  const renderTab = () =>
    render(
      <MemoryRouter>
        <ProjectAdminTab
          organizationId="test-organization"
          projectId="test-project"
          metadataItems={[{ label: "Created At", value: "Today" }]}
        />
      </MemoryRouter>,
    );

  it("defaults absent state to Metadata and uses an isolated URL key", () => {
    renderTab();

    const tabs = within(
      screen.getByRole("tablist", { name: "Project admin sections" }),
    ).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Metadata"]);
    expect(mockSetQueryState.adminSubTab).toBeDefined();
    expect(screen.getByText("Metadata panel: Created At")).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Work Item Types" }),
    ).not.toBeInTheDocument();
  });

  it.each(["unexpected", "custom-types"])(
    "falls back to Metadata for legacy or invalid Admin subtab state: %s",
    (subtab) => {
      mockQueryState.adminSubTab = subtab;
      renderTab();

      expect(screen.getByRole("tab", { name: "Metadata" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        screen.getByText("Metadata panel: Created At"),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Work Item Types" }),
      ).not.toBeInTheDocument();
    },
  );
});

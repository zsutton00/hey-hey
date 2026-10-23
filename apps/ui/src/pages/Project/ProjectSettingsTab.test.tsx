import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSettingsTab } from "./ProjectSettingsTab";

const mockQueryState: Record<string, string> = {};
const mockSetQueryState = vi.fn();
const mockSegmentedToggle = vi.fn();
const mockServices = vi.fn();
const mockIntegrations = vi.fn();
const mockWorkItemTypesList = vi.fn();
const mockEntityPromptTemplatesPanel = vi.fn();
const mockAdmin = vi.fn();

vi.mock("@hey-hey/ui-common/components", () => ({
  ProjectMembersPanel: () => <div>Members panel</div>,
}));

vi.mock("nuqs", () => ({
  parseAsStringLiteral: () => ({ withDefault: () => ({}) }),
  useQueryState: (key: string) => [
    mockQueryState[key] ?? "services",
    mockSetQueryState,
  ],
}));

vi.mock("../../components/SegmentedToggle", () => ({
  SegmentedToggle: (props: unknown) => {
    mockSegmentedToggle(props);
    return <div data-testid="settings-selector" />;
  },
}));

vi.mock("../../components/Tabs", () => ({
  ServicesTab: (props: unknown) => {
    mockServices(props);
    return <div>Services panel</div>;
  },
  IntegrationsTab: (props: unknown) => {
    mockIntegrations(props);
    return <div>Integrations panel</div>;
  },
}));

vi.mock("./AboutTabComponents", () => ({
  WorkItemTypesList: (props: unknown) => {
    mockWorkItemTypesList(props);
    return <div>Types panel</div>;
  },
}));

vi.mock("./EntityPromptTemplatesPanel", () => ({
  EntityPromptTemplatesPanel: (props: unknown) => {
    mockEntityPromptTemplatesPanel(props);
    return <div>Entity Prompt Templates panel</div>;
  },
}));

vi.mock("./ProjectAdminTab", () => ({
  ProjectAdminTab: (props: unknown) => {
    mockAdmin(props);
    return <div>Administration panel</div>;
  },
}));

describe("ProjectSettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockQueryState.settingsSubTab;
    delete mockQueryState.typesSubTab;
  });

  const metadataItems = [{ label: "Created At", value: "Today" }];
  const renderTab = () =>
    render(
      <ProjectSettingsTab
        metadataItems={metadataItems}
        organizationId="org-1"
        projectId="project-1"
      />,
    );

  it("defaults to Services with the ordered responsive selector", () => {
    renderTab();

    expect(mockSegmentedToggle).toHaveBeenCalledWith(
      expect.objectContaining({
        mobileDropdown: true,
        segments: [
          { value: "services", label: "Services" },
          { value: "integrations", label: "Integrations" },
          { value: "members", label: "Members" },
          { value: "types", label: "Types" },
          { value: "administration", label: "Administration" },
        ],
        value: "services",
      }),
    );
    expect(mockServices).toHaveBeenCalledWith({
      enableFilters: true,
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(screen.queryByText("Integrations panel")).not.toBeInTheDocument();
  });

  it.each([
    [
      "integrations",
      mockIntegrations,
      { organizationId: "org-1", projectId: "project-1" },
    ],
  ])(
    "restores the %s destination with unchanged identity",
    (view, mock, props) => {
      mockQueryState.settingsSubTab = view;
      renderTab();

      expect(mock).toHaveBeenCalledWith(props);
      expect(mockServices).not.toHaveBeenCalled();
    },
  );

  it("restores Types and mounts the project-scoped list", () => {
    mockQueryState.settingsSubTab = "types";
    renderTab();

    expect(mockWorkItemTypesList).toHaveBeenCalledWith({
      projectId: "project-1",
    });
    expect(
      screen.getByRole("tab", { name: "Work Item Types" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Types panel")).toBeInTheDocument();
    expect(mockServices).not.toHaveBeenCalled();
    expect(mockAdmin).not.toHaveBeenCalled();
  });

  it("restores Entity Prompt Templates within Types with project identity", () => {
    mockQueryState.settingsSubTab = "types";
    mockQueryState.typesSubTab = "entity-prompt-templates";
    renderTab();

    expect(mockEntityPromptTemplatesPanel).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(
      screen.getByRole("tab", { name: "Entity Prompt Templates" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText("Entity Prompt Templates panel"),
    ).toBeInTheDocument();
    expect(mockWorkItemTypesList).not.toHaveBeenCalled();
  });

  it("pushes the selected Types subsection into URL state", async () => {
    const user = userEvent.setup();
    mockQueryState.settingsSubTab = "types";
    renderTab();

    await user.click(
      screen.getByRole("tab", { name: "Entity Prompt Templates" }),
    );

    expect(mockSetQueryState).toHaveBeenCalledWith("entity-prompt-templates", {
      history: "push",
    });
  });

  it("retains the administration metadata composition", () => {
    mockQueryState.settingsSubTab = "administration";
    renderTab();

    expect(mockAdmin).toHaveBeenCalledWith({
      metadataItems,
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(screen.getByText("Administration panel")).toBeInTheDocument();
  });

  it("uses isolated validated state and falls back safely for invalid values", () => {
    mockQueryState.settingsSubTab = "costs";
    renderTab();
    const selectorProps = mockSegmentedToggle.mock.calls[0]?.[0] as {
      onChange: (value: string) => void;
      value: string;
    };

    expect(selectorProps.value).toBe("services");
    act(() => selectorProps.onChange("types"));
    expect(mockSetQueryState).toHaveBeenCalledWith("types", {
      history: "push",
    });
  });
});

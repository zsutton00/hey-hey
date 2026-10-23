import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesignDocsTab } from "./DesignDocsTab";

const {
  showCreateDocumentMock,
  useDesignDocsMock,
  useWorkItemGraphMock,
  navigateMock,
} = vi.hoisted(() => ({
  showCreateDocumentMock: vi.fn(),
  useDesignDocsMock: vi.fn(),
  useWorkItemGraphMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/api", () => ({
  DesignDocParentEntityType: {
    Task: "TASK",
    DesignDoc: "DESIGN_DOC",
  },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  DesignDocList: ({
    designDocs,
    loading,
  }: {
    designDocs: { name: string }[];
    loading?: boolean;
  }) => (
    <div data-testid="design-doc-list">
      {loading ? "Loading" : designDocs.map((doc) => doc.name).join(",")}
    </div>
  ),
  EntityFilters: () => null,
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useModalService: () => ({
    showCreateDocument: showCreateDocumentMock,
  }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useDesignDocs: useDesignDocsMock,
  useWorkItemGraph: useWorkItemGraphMock,
}));

vi.mock("@hey-hey/ui-common/services", () => ({
  WebPathService: {
    designDoc: vi.fn(
      ({
        projectId,
        designDocId,
      }: {
        projectId: string;
        designDocId: string;
      }) => `/projects/${projectId}/design-docs/${designDocId}`,
    ),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

describe("DesignDocsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDesignDocsMock.mockReturnValue({
      designDocs: [],
      isLoading: false,
      error: null,
    });
    useWorkItemGraphMock.mockReturnValue({
      data: null,
      isLoading: false,
      isFetched: true,
      error: null,
    });
  });

  it("loads Plan documents through the scoped Design Docs query", () => {
    useDesignDocsMock.mockReturnValue({
      designDocs: [{ id: "doc-1", name: "Seed document" }],
      isLoading: false,
      error: null,
    });

    render(
      <DesignDocsTab
        organizationId="org-1"
        projectId="project-1"
        planId="plan-1"
      />,
    );

    expect(screen.getByTestId("design-doc-list")).toHaveTextContent(
      "Seed document",
    );
    expect(useDesignDocsMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        taskId: undefined,
        planId: "plan-1",
      }),
    );
  });

  it("keeps the Plan document loading state explicit while the scoped query resolves", () => {
    useDesignDocsMock.mockReturnValue({
      designDocs: [],
      isLoading: true,
      error: null,
    });

    render(
      <DesignDocsTab
        organizationId="org-1"
        projectId="project-1"
        planId="plan-1"
      />,
    );

    expect(screen.getByTestId("design-doc-list")).toHaveTextContent("Loading");
  });

  it("surfaces Design Docs query errors instead of treating them as empty", () => {
    useDesignDocsMock.mockReturnValue({
      designDocs: [],
      isLoading: false,
      error: new Error("Design Docs lookup failed"),
    });

    render(
      <DesignDocsTab
        organizationId="org-1"
        projectId="project-1"
        planId="plan-1"
      />,
    );

    expect(screen.getByTestId("design-docs-tab-error")).toHaveTextContent(
      "Design Docs lookup failed",
    );
  });

  it("does not request graph hydration for a Plan document tab", () => {
    useDesignDocsMock.mockReturnValue({
      designDocs: [],
      isLoading: false,
      error: null,
    });

    render(
      <DesignDocsTab
        organizationId="org-1"
        projectId="project-1"
        planId="plan-1"
      />,
    );

    expect(useWorkItemGraphMock).not.toHaveBeenCalled();
  });

  it("passes TASK parent context when launched from a task or feature page", async () => {
    const user = userEvent.setup();

    render(
      <DesignDocsTab
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create Document" }));

    expect(showCreateDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "blank_doc",
        projectId: "project-1",
        parentEntityId: "task-1",
        parentEntityType: "TASK",
      }),
    );
  });

  it("passes DESIGN_DOC parent context when launched from a design document page", async () => {
    const user = userEvent.setup();

    render(
      <DesignDocsTab
        organizationId="org-1"
        projectId="project-1"
        designDocId="design-doc-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create Document" }));

    expect(showCreateDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parentEntityId: "design-doc-1",
        parentEntityType: "DESIGN_DOC",
      }),
    );
  });

  it("keeps plan-launched documents unparented", async () => {
    const user = userEvent.setup();

    render(
      <DesignDocsTab
        organizationId="org-1"
        projectId="project-1"
        planId="plan-1"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create Document" }));

    expect(showCreateDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        parentEntityId: undefined,
        parentEntityType: undefined,
      }),
    );
  });
});

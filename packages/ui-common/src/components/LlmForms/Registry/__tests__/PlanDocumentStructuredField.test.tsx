import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigate } from "react-router-dom";
import { DesignDocTemplate } from "../../../../api";
import { usePathService } from "../../../../contexts";
import { EagerIntersectionObserver } from "../../../../test/eagerIntersectionObserver";
import { useDesignDoc } from "../../../../data/hooks/useDesignDoc";
import { PlanDocumentStructuredField } from "../PlanDocumentStructuredField";
import type { FieldConfig } from "../types";

vi.mock("../../../../data/hooks/useDesignDoc", () => ({
  useDesignDoc: vi.fn(),
}));

const useWorkItemGraphMock = vi.fn();
const useWorkItemTypeByKeyMock = vi.fn();
vi.mock("../../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: (...args: unknown[]) => useWorkItemGraphMock(...args),
}));
vi.mock("../../../../data/hooks/useWorkItemTypes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../data/hooks/useWorkItemTypes")
  >()),
  useWorkItemTypeByKey: (...args: unknown[]) =>
    useWorkItemTypeByKeyMock(...args),
}));

vi.mock("../../../../contexts", () => ({
  usePathService: vi.fn(),
  useProjectContext: () => null,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: vi.fn(),
}));

const mockUseDesignDoc = useDesignDoc as ReturnType<typeof vi.fn>;
const mockUsePathService = usePathService as ReturnType<typeof vi.fn>;
const mockUseNavigate = useNavigate as ReturnType<typeof vi.fn>;
const mockNavigate = vi.fn();

const mockConfig: FieldConfig = {
  field: "plan-document",
  description: "Plan Document",
  type: "plan_document_view",
};

const mockContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "org-1",
};

const baseQueryResult = {
  data: null,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
};

const createStructuredValue = (template = "PLAN_DOCUMENT") => ({
  structuredResponse: {
    responseType: "plan_document_view_v1",
    parsed: {
      responseType: "plan_document_view_v1",
      entityId: "design-doc-1",
      template,
    },
  },
});

const createPayloadValue = (template = "PLAN_DOCUMENT") => ({
  entityId: "design-doc-1",
  template,
});

describe("PlanDocumentStructuredField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", EagerIntersectionObserver);
    mockUseDesignDoc.mockReturnValue(baseQueryResult);
    mockUsePathService.mockReturnValue({
      designDoc: vi.fn(
        ({ projectId, designDocId }) =>
          `/projects/${projectId}/design-docs/${designDocId}`
      ),
      task: vi.fn(
        ({ projectId, taskId }) => `/projects/${projectId}/tasks/${taskId}`
      ),
    });
    mockUseNavigate.mockReturnValue(mockNavigate);
    useWorkItemGraphMock.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
    });
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeDefinition: {
        key: "workflow",
        name: "Workflow",
        sections: [],
        allowedStatuses: [],
        iconKey: "workflow",
      },
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
    });
  });

  it("shows an info state when structured plan document data is missing", () => {
    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByTestId("plan-document-structured-field-empty-plan-document")
    ).toBeInTheDocument();
  });

  it("shows a loading state while fetching the design doc", () => {
    mockUseDesignDoc.mockReturnValue({
      ...baseQueryResult,
      isLoading: true,
      isFetching: true,
    });

    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        value={createStructuredValue()}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByTestId("plan-document-structured-field-loading-plan-document")
    ).toBeInTheDocument();
    expect(mockUseDesignDoc).toHaveBeenCalledWith(
      "org-1",
      "design-doc-1",
      expect.objectContaining({
        enabled: true,
      })
    );
  });

  it("shows warning when the requested design doc cannot be resolved", () => {
    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        value={createStructuredValue()}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByTestId("plan-document-structured-field-missing-plan-document")
    ).toBeInTheDocument();
  });

  it("accepts direct payload values without structuredResponse wrapper", () => {
    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        value={createPayloadValue()}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByTestId("plan-document-structured-field-missing-plan-document")
    ).toBeInTheDocument();
    expect(mockUseDesignDoc).toHaveBeenCalledWith(
      "org-1",
      "design-doc-1",
      expect.objectContaining({ enabled: true })
    );
  });

  it("shows warning when the design doc template is not plan document compatible", () => {
    mockUseDesignDoc.mockReturnValue({
      ...baseQueryResult,
      data: {
        id: "design-doc-1",
        name: "Wrong Template Doc",
        template: DesignDocTemplate.Adr,
        status: "READY",
        organizationId: "org-1",
        projectId: "project-1",
        tags: [],
        createdAt: "2026-02-26T00:00:00.000Z",
        updatedAt: "2026-02-26T00:00:00.000Z",
        sections: [],
      },
    });

    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        value={createStructuredValue()}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByTestId(
        "plan-document-structured-field-template-mismatch-plan-document"
      )
    ).toBeInTheDocument();
  });

  it("renders the read-only design doc view and action buttons for PLAN_DOCUMENT docs", () => {
    mockUseDesignDoc.mockReturnValue({
      ...baseQueryResult,
      data: {
        id: "design-doc-1",
        name: "Plan Document",
        template: DesignDocTemplate.PlanDocument,
        status: "READY",
        organizationId: "org-1",
        projectId: "project-1",
        tags: [],
        createdAt: "2026-02-26T00:00:00.000Z",
        updatedAt: "2026-02-26T00:00:00.000Z",
        summary: "Generated planning brainstorm",
        sections: [
          {
            key: "content",
            materializedMarkdown: "## User Journey\n\nNarrative plan content.",
          },
        ],
      },
    });

    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        value={createStructuredValue()}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByTestId("plan-document-structured-field-plan-document")
    ).toBeInTheDocument();
    expect(screen.getByTestId("design-doc-read-view")).toBeInTheDocument();
    expect(
      screen.getByTestId("plan-document-structured-field-edit-plan-document")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "plan-document-structured-field-looks-good-plan-document"
      )
    ).toBeInTheDocument();
  });

  it("keeps workflow mentions mounted inside the shared design-doc read surface", () => {
    mockUseDesignDoc.mockReturnValue({
      ...baseQueryResult,
      data: {
        id: "design-doc-1",
        name: "Plan Document",
        template: DesignDocTemplate.PlanDocument,
        status: "READY",
        organizationId: "org-1",
        projectId: "project-1",
        tags: [],
        createdAt: "2026-02-26T00:00:00.000Z",
        updatedAt: "2026-02-26T00:00:00.000Z",
        summary: "Generated planning brainstorm",
        sections: [
          {
            key: "content",
            materializedMarkdown:
              "Use @[workflow:wf-1|Review workflow] before approving.",
          },
        ],
      },
    });

    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        value={createStructuredValue()}
        isSubmitted={false}
      />
    );

    expect(screen.getByTestId("design-doc-read-view")).toBeInTheDocument();
    const unavailableWorkflow = screen.getByTestId(
      "workflow-inline-diagram-unavailable"
    );
    expect(unavailableWorkflow).toHaveTextContent("Review workflow");
    expect(unavailableWorkflow).toHaveAttribute("data-workflow-id", "wf-1");
    expect(screen.queryByTestId("mention-badge")).not.toBeInTheDocument();
    expect(useWorkItemGraphMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "wf-1",
      { enabled: true }
    );
  });

  it("still renders for legacy BRAINSTORM docs", () => {
    mockUseDesignDoc.mockReturnValue({
      ...baseQueryResult,
      data: {
        id: "design-doc-1",
        name: "Plan Brainstorm",
        template: DesignDocTemplate.Brainstorm,
        status: "READY",
        organizationId: "org-1",
        projectId: "project-1",
        tags: [],
        createdAt: "2026-02-26T00:00:00.000Z",
        updatedAt: "2026-02-26T00:00:00.000Z",
        summary: "Generated planning brainstorm",
        sections: [
          {
            key: "content",
            materializedMarkdown: "Plan content",
          },
        ],
      },
    });

    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        value={createStructuredValue("BRAINSTORM")}
        isSubmitted={false}
      />
    );

    expect(
      screen.getByTestId("plan-document-structured-field-plan-document")
    ).toBeInTheDocument();
  });

  it("navigates to the design doc editor when Edit Plan Document is clicked", () => {
    const designDocPath = vi.fn(
      ({ projectId, designDocId }) =>
        `/projects/${projectId}/design-docs/${designDocId}`
    );
    mockUsePathService.mockReturnValue({
      designDoc: designDocPath,
    });

    mockUseDesignDoc.mockReturnValue({
      ...baseQueryResult,
      data: {
        id: "design-doc-1",
        name: "Plan Document",
        template: DesignDocTemplate.PlanDocument,
        status: "READY",
        organizationId: "org-1",
        projectId: "project-1",
        tags: [],
        createdAt: "2026-02-26T00:00:00.000Z",
        updatedAt: "2026-02-26T00:00:00.000Z",
        summary: "Generated planning brainstorm",
        sections: [
          {
            key: "content",
            materializedMarkdown: "Plan content",
          },
        ],
      },
    });

    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        value={createStructuredValue()}
        isSubmitted={false}
      />
    );

    fireEvent.click(
      screen.getByTestId("plan-document-structured-field-edit-plan-document")
    );

    expect(designDocPath).toHaveBeenCalledWith({
      projectId: "project-1",
      designDocId: "design-doc-1",
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/project-1/design-docs/design-doc-1"
    );
  });

  it("writes approval userMessage when Looks Good is clicked", () => {
    const onChange = vi.fn();
    mockUseDesignDoc.mockReturnValue({
      ...baseQueryResult,
      data: {
        id: "design-doc-1",
        name: "Plan Document",
        template: DesignDocTemplate.PlanDocument,
        status: "READY",
        organizationId: "org-1",
        projectId: "project-1",
        tags: [],
        createdAt: "2026-02-26T00:00:00.000Z",
        updatedAt: "2026-02-26T00:00:00.000Z",
        summary: "Generated planning brainstorm",
        sections: [
          {
            key: "content",
            materializedMarkdown: "Plan content",
          },
        ],
      },
    });

    render(
      <PlanDocumentStructuredField
        config={mockConfig}
        context={mockContext}
        value={createStructuredValue()}
        onChange={onChange}
        isSubmitted={false}
      />
    );

    fireEvent.click(
      screen.getByTestId(
        "plan-document-structured-field-looks-good-plan-document"
      )
    );

    expect(onChange).toHaveBeenCalledWith({
      entityId: "design-doc-1",
      template: "PLAN_DOCUMENT",
      responseType: "plan_document_view_v1",
      userMessage: "The user approved the plan",
    });
  });
});

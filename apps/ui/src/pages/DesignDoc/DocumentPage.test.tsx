import {
  DesignDocTemplate,
  TargetEntityType,
  type DesignDocResponseDto,
} from "@hey-hey/ui-common/api";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentDetailPage as DocumentPage } from "./DocumentDetailPage";

const mockSetActiveTab = vi.fn();
const { mockCreateCanonicalPageDescriptor } = vi.hoisted(() => ({
  mockCreateCanonicalPageDescriptor: vi.fn(
    (
      entityType: string,
      entityId: string,
      lineage: unknown,
      presentation?: unknown
    ) => ({ entityType, entityId, lineage, presentation })
  ),
}));
let mockActiveTab = "document";
let mockDesignDoc: DesignDocResponseDto;
let mockProposals: unknown[];
let mockRelatedEntities: unknown[];

interface InteractionComponentProps {
  children: React.ReactNode;
  disablePreview?: boolean;
  draggable?: boolean;
  entityId?: string;
  entityType?: TargetEntityType;
  hasProposalSupport?: boolean;
  organizationId?: string;
  projectId?: string;
  entityTitle?: string;
}

const mockInteractionComponent = vi.fn();
const mockRelatedCard = vi.fn();
const mockDocumentEditor = vi.fn();

vi.mock("nuqs", () => ({
  parseAsStringLiteral: () => ({
    withDefault: () => ({}),
  }),
  useQueryState: () => [mockActiveTab, mockSetActiveTab],
}));

vi.mock("@hey-hey/ui-common", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/services")
  >("@hey-hey/ui-common/services");
  return {
    WebPathService: {
      conversation: actual.WebPathService.conversation,
      designDoc: () => "/design-doc",
      designDocAgentSession: () => "/design-doc/session",
    },
  };
});

vi.mock("@hey-hey/ui-common/i18n", () => ({
  TERMS: {
    Tasks: "Tasks",
  },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  CapsuleAction: ({ id, onClick }: { id: string; onClick?: () => void }) =>
    id === "edit-design-doc" ? (
      <button type="button" onClick={onClick}>
        Edit
      </button>
    ) : null,
  DesignDocMetadata: () => null,
  DesignDocReadView: () => <div data-testid="design-doc-read-view" />,
  DiscussCapsuleAction: () => null,
  InteractionComponent: (props: InteractionComponentProps) => {
    mockInteractionComponent(props);
    return <div data-testid="design-doc-interaction">{props.children}</div>;
  },
  useTaskGenerationCapsuleAction: () => ({
    actionId: "tasks-from-adr",
    label: "Tasks",
    title: "Generate tasks",
    inProgress: false,
    renderContent: () => null,
    menuItems: [],
    resumable: false,
    expandable: false,
  }),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
  CanonicalPageBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
  createCanonicalPageDescriptor: mockCreateCanonicalPageDescriptor,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useDeleteDesignDoc: () => ({
    mutate: vi.fn(),
  }),
  useDesignDoc: () => ({
    data: mockDesignDoc,
    isLoading: false,
    error: null,
  }),
  useFullEntityContext: () => ({
    data: {
      proposals: mockProposals,
      relatedEntities: mockRelatedEntities,
    },
    isLoading: false,
  }),
  useProject: () => ({
    data: { id: "project-1", name: "Project" },
  }),
  useUpdateDesignDoc: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({
    currentOrgId: "org-1",
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("../../components/Layout", () => ({
  DetailPageBody: ({
    content,
    sidebar,
    sidebarSide,
    widthStrategy,
    gap,
  }: {
    content?: React.ReactNode;
    sidebar?: React.ReactNode;
    sidebarSide?: string;
    widthStrategy?: string;
    gap?: number;
  }) => (
    <div
      data-testid="detail-page-body"
      data-sidebar-side={sidebarSide}
      data-width-strategy={widthStrategy}
      data-gap={gap}
    >
      <div>{content}</div>
      <aside>{sidebar}</aside>
    </div>
  ),
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DetailPageHeader: ({ title }: { title: React.ReactNode }) => (
    <header>{title}</header>
  ),
  DetailPageTabs: ({
    tabs,
  }: {
    tabs: Array<{ value: string; label: string }>;
  }) => (
    <div>
      {tabs.map((tab) => (
        <button key={tab.value} type="button">
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../../components/ContextRailCards", () => ({
  ContextRailCards: (props: {
    proposals: unknown[];
    relatedEntities: unknown[];
    organizationId: string;
    projectId: string;
    conversationPathForId: (conversationId: string) => string;
    dataTestIdPrefix: string;
  }) => {
    mockRelatedCard(props);
    return (
      <>
        <div data-testid={`${props.dataTestIdPrefix}-history-card`} />
        <div data-testid={`${props.dataTestIdPrefix}-related-card`} />
      </>
    );
  },
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: () => null,
  buildAdminMetadataItems: () => [],
}));

vi.mock("../../components/Tabs/AgentSessionsTab", () => ({
  AgentSessionsTab: () => null,
}));

vi.mock("../../components/Tabs/ConversationListTab", () => ({
  ConversationListTab: () => null,
}));

vi.mock("../../components/Tabs/DesignDocsTab", () => ({
  DesignDocsTab: () => null,
}));

vi.mock("./DesignDocBreadcrumbs", () => ({
  DesignDocBreadcrumbs: () => null,
}));

vi.mock("./DesignDocTasksTab", () => ({
  DesignDocTasksTab: () => null,
}));

vi.mock("./DocumentEditor", () => ({
  DocumentEditor: (props: {
    documentData: DesignDocResponseDto;
    currentOrgId: string;
    projectId: string;
    status?: string;
    onDone?: (designDocId: string) => void;
  }) => {
    mockDocumentEditor(props);
    return (
      <div>
        <div data-testid="canonical-document-editor" />
        <button
          type="button"
          data-testid="canonical-document-editor-done"
          onClick={() => props.onDone?.(props.documentData.id)}
        >
          Done
        </button>
      </div>
    );
  },
}));

vi.mock("./SetReadyActionCapsule", () => ({
  SetReadyActionCapsule: () => null,
}));

vi.mock("../../utils/statusUtils", () => ({
  isDesignDocRefining: () => false,
}));

const createDesignDoc = (
  overrides: Partial<DesignDocResponseDto> = {}
): DesignDocResponseDto =>
  ({
    id: "design-doc-1",
    name: "Design Doc",
    summary: "Summary",
    sections: [],
    tags: [],
    status: "READY",
    template: DesignDocTemplate.Adr,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  } as unknown as DesignDocResponseDto);

const renderDocumentPage = (
  initialEntry = "/projects/project-1/design-docs/design-doc-1"
): void => {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/projects/:projectId/design-docs/:documentId"
          element={<DocumentPage />}
        />
      </Routes>
    </MemoryRouter>
  );
};

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
};

describe("DocumentPage interaction component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveTab = "document";
    mockDesignDoc = createDesignDoc();
    mockProposals = [{ id: "proposal-1" }, { id: "proposal-2" }];
    mockRelatedEntities = [
      { entityId: "task-1", entityType: "TASK" },
      { entityId: "feature-1", entityType: "FEATURE" },
    ];
  });

  it("publishes the real title in its canonical activation descriptor", () => {
    mockDesignDoc = createDesignDoc({ name: "Request retry policy" });

    renderDocumentPage();

    expect(mockCreateCanonicalPageDescriptor).toHaveBeenCalledWith(
      "design_doc",
      "design-doc-1",
      null,
      { kind: "design_doc", label: "Request retry policy" }
    );
  });

  it("initializes the canonical editor from the editing query parameter", async () => {
    renderDocumentPage(
      "/projects/project-1/design-docs/design-doc-1?editing=true"
    );

    expect(
      await screen.findByTestId("canonical-document-editor")
    ).toBeInTheDocument();
    expect(mockDocumentEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        documentData: mockDesignDoc,
        currentOrgId: "org-1",
        projectId: "project-1",
        status: "READY",
      })
    );
  });

  it("returns clean canonical editing to the same read page and preserves URL context", async () => {
    const historyBack = vi.spyOn(window.history, "back");
    renderDocumentPage(
      "/projects/project-1/design-docs/design-doc-1?editing=true&tab=admin&planId=plan-1"
    );

    await userEvent.click(screen.getByTestId("canonical-document-editor-done"));

    expect(screen.getByTestId("design-doc-read-view")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/design-docs/design-doc-1?tab=admin&planId=plan-1"
    );
    expect(historyBack).not.toHaveBeenCalled();
    historyBack.mockRestore();
  });

  it("wraps the read-mode document tab with non-draggable DESIGN_DOC interaction context", () => {
    renderDocumentPage();

    const interaction = screen.getByTestId("design-doc-interaction");
    expect(
      within(interaction).getByTestId("design-doc-read-view")
    ).toBeInTheDocument();

    expect(mockInteractionComponent).toHaveBeenCalledWith(
      expect.objectContaining({
        draggable: false,
        disablePreview: true,
        entityId: "design-doc-1",
        entityType: TargetEntityType.DesignDoc,
        entityTitle: "Design Doc",
        hasProposalSupport: true,
        organizationId: "org-1",
        projectId: "project-1",
      })
    );
  });

  it("shows the shared Related Card in the right equal-split read-mode rail with full context", () => {
    renderDocumentPage();

    const body = screen.getByTestId("detail-page-body");
    expect(body).toHaveAttribute("data-width-strategy", "equal-split");
    expect(body).toHaveAttribute("data-sidebar-side", "right");
    expect(body).toHaveAttribute("data-gap", "0");
    expect(
      within(body).getByTestId("design-doc-history-card")
    ).toBeInTheDocument();
    expect(
      within(body).getByTestId("design-doc-related-card")
    ).toBeInTheDocument();

    const props = mockRelatedCard.mock.calls[0][0];
    expect(props.proposals).toBe(mockProposals);
    expect(props.relatedEntities).toBe(mockRelatedEntities);
    expect(props.organizationId).toBe("org-1");
    expect(props.projectId).toBe("project-1");
    expect(props.conversationPathForId("conversation-1")).toBe(
      "/projects/project-1/resolve-agent-session/conversation-1"
    );
  });

  it("hides the Related Card while editing", async () => {
    const user = userEvent.setup();
    renderDocumentPage();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(
      screen.queryByTestId("design-doc-related-card")
    ).not.toBeInTheDocument();
  });

  it("does not show the Related Card on non-Document tabs", () => {
    mockActiveTab = "tasks";

    renderDocumentPage();

    expect(
      screen.queryByTestId("design-doc-related-card")
    ).not.toBeInTheDocument();
    expect(mockRelatedCard).not.toHaveBeenCalled();
  });
});

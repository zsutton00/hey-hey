import {
  usePreviewHost,
  type PreviewRequest,
} from "@hey-hey/ui-common/context";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionPreview } from "./Notifications/AgentSessionPreview";
import { ConversationView } from "../pages/Conversation/ConversationView";
import { DocumentPage } from "../pages/DesignDoc/DocumentPage";
import { GoalPage } from "../pages/Goals/GoalPage";
import { InitiativePage } from "../pages/Initiative/InitiativePage";
import { PlanPage } from "../pages/Plan/PlanPage";
import { ProposalDetailView } from "../pages/Proposals/ProposalDetailView";
import {
  OpenItemsPreviewHost,
} from "./OpenItemsPreviewHost";
import { CanonicalEntityPreview } from "./CanonicalEntityPreview";
import { usePreviewPresentation } from "../contexts/PreviewPresentationContext";

vi.mock("./PreviewModal", () => ({
  PreviewModal: ({
    children,
    onClose,
    open,
  }: {
    children: React.ReactNode;
    onClose: () => void;
    open: boolean;
  }) =>
    open ? (
      <div data-testid="preview-modal">
        {children}
        <button type="button" onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

const mockUseWorkItem = vi.fn();
vi.mock("@hey-hey/ui-common/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/data")>()),
  useWorkItem: (...args: unknown[]) => mockUseWorkItem(...args),
}));
vi.mock("../pages/Task/TaskPage", () => ({
  TaskPage: ({ taskId, preview }: { taskId: string; preview?: boolean }) => (
    <div data-testid="task-page" data-task-id={taskId} data-preview={String(preview)} />
  ),
}));
vi.mock("../pages/Task/WorkflowDetailPage", () => ({
  WorkflowDetailPage: ({ preview }: { preview?: { projectId: string; taskId: string } }) => (
    <div data-testid="diagram-page" data-task-id={preview?.taskId} data-project-id={preview?.projectId} />
  ),
}));
vi.mock("../pages/Features/FeaturesCollection", () => ({ FeaturesCollection: () => <div data-preview-presentation={String(usePreviewPresentation())}>Features collection</div> }));
vi.mock("../pages/Goals/GoalsCollection", () => ({ GoalsCollection: () => <div>Goals collection</div> }));
vi.mock("../pages/Plans/PlansCollection", () => ({ PlansCollection: () => <div>Plans collection</div> }));
vi.mock("../pages/Services/ServicesCollection", () => ({ ServicesCollection: () => <div>Services collection</div> }));

const PreviewTrigger = () => {
  const host = usePreviewHost();
  return (
    <button
      type="button"
      onClick={() =>
        host.openPreview({
          kind: "project_collection",
          collection: "features",
        })
      }
    >
      Preview task
    </button>
  );
};

const CollectionPreviewTrigger = ({ collection }: { collection: "features" | "goals" | "plans" | "services" }) => {
  const host = usePreviewHost();
  return <button type="button" onClick={() => host.openPreview({ kind: "project_collection", collection })}>Preview {collection}</button>;
};

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
};

describe("CanonicalEntityPreview", () => {
  it.each([
    ["initiative", InitiativePage],
    ["goal", GoalPage],
    ["conversation", ConversationView],
    ["design_doc", DocumentPage],
    ["agent_session", AgentSessionPreview],
    ["plan", PlanPage],
    ["proposal", ProposalDetailView],
  ] as const)("maps %s to its canonical page composition", (entityType, page) => {
    const element = CanonicalEntityPreview({
      entity: {
        entityType,
        entityId: `${entityType}-1`,
      } as PreviewRequest,
      organizationId: "org-1",
      projectId: "project-1",
    }) as React.ReactElement;

    expect(element.type).toBe(page);
    if (entityType !== "conversation") {
      expect(element.props).toMatchObject(
        entityType === "agent_session" ? {} : { preview: true },
      );
    }
  });

  it.each([
    ["DIAGRAM", "diagram-page"],
    ["workflow", "diagram-page"],
    ["mockup", "task-page"],
    ["STANDARD", "task-page"],
  ])("previews a %s task with its canonical page", (type, testId) => {
    mockUseWorkItem.mockReturnValue({ workItem: { id: "task-1", type }, isFetched: true });
    render(
      <MemoryRouter>
        <CanonicalEntityPreview
          entity={{ entityType: "task", entityId: "task-1" } as PreviewRequest}
          organizationId="org-1"
          projectId="project-1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId(testId)).toHaveAttribute("data-task-id", "task-1");
    if (testId === "task-page") {
      expect(screen.getByTestId(testId)).toHaveAttribute("data-preview", "true");
    } else {
      expect(screen.getByTestId(testId)).toHaveAttribute("data-project-id", "project-1");
    }
  });

  it.each(["features", "goals", "plans", "services"] as const)(
    "renders the canonical %s collection without changing location",
    (collection) => {
      render(
        <MemoryRouter initialEntries={["/projects/project-1?tab=project"]}>
          <OpenItemsPreviewHost organizationId="org-1" projectId="project-1">
            <CollectionPreviewTrigger collection={collection} />
            <LocationProbe />
          </OpenItemsPreviewHost>
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole("button", { name: `Preview ${collection}` }));
      expect(screen.getByText(`${collection[0].toUpperCase()}${collection.slice(1)} collection`)).toBeInTheDocument();
      expect(screen.getByTestId("location")).toHaveTextContent("/projects/project-1?tab=project");
    },
  );

  it("marks canonical content as Preview presentation at the host boundary", () => {
    render(
      <MemoryRouter>
        <OpenItemsPreviewHost organizationId="org-1" projectId="project-1">
          <CollectionPreviewTrigger collection="features" />
        </OpenItemsPreviewHost>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview features" }));
    expect(screen.getByText("Features collection")).toHaveAttribute(
      "data-preview-presentation",
      "true",
    );
  });

  it("opens and closes without changing location or history", () => {
    const initialHistoryLength = window.history.length;
    render(
      <MemoryRouter initialEntries={["/projects/project-1?tab=project"]}>
        <OpenItemsPreviewHost organizationId="org-1" projectId="project-1">
          <PreviewTrigger />
          <LocationProbe />
        </OpenItemsPreviewHost>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview task" }));
    expect(screen.getByTestId("preview-modal")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1?tab=project",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("preview-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1?tab=project",
    );
    expect(window.history.length).toBe(initialHistoryLength);
  });
});

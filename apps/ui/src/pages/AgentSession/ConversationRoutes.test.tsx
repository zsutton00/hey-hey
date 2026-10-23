import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionType, EntityType, WorkflowName } from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common/services";
import { AgentSessionResolver } from "./AgentSessionResolver";
import { DocumentConversationPage } from "../DesignDoc/DocumentConversationPage";
import { ProjectConversationPage } from "../Project/ProjectConversationPage";
import { PlanConversationPage } from "../Plan/PlanConversationPage";

const sessions = vi.hoisted(() => vi.fn());
vi.mock("@hey-hey/ui-common/data", () => ({
  useConversation: () => ({ data: { id: "conversation-1", workflowName: WorkflowName.AgentEntityConversation }, isFetched: true }),
  useAgentSessions: () => sessions(),
  useProject: () => ({ data: { name: "Project" } }),
  useWorkItem: () => ({ workItem: { name: "Delivery plan" } }),
}));
vi.mock("@hey-hey/ui-common/hooks", () => ({ useUserIdentity: () => ({ currentOrgId: "org-1" }) }));
vi.mock("../../components/Layout", () => ({ PageBreadcrumbs: () => null }));
vi.mock("../Conversation", () => ({
  ConversationView: ({ conversationId }: { conversationId: string }) => <div data-testid="sessionless-thread" data-conversation-id={conversationId}>Sessionless thread</div>,
}));

const LocationProbe = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  return <div>
    <output data-testid="location">{location.pathname}{location.search}</output>
    <output data-testid="navigation-type">{navigationType}</output>
    <button onClick={() => navigate(-1)}>Back</button>
  </div>;
};

const mount = (entry: string) => {
  render(<MemoryRouter initialEntries={["/before", entry]} initialIndex={1}>
    <LocationProbe />
    <Routes>
      <Route path="/before" element={<div>Previous page</div>} />
      <Route path="/projects/:projectId/resolve-agent-session/:conversationId" element={<AgentSessionResolver />} />
      <Route path="/projects/:projectId/conversations/:conversationId" element={<AgentSessionResolver />} />
      <Route path="/projects/:projectId/design-docs/:documentId/conversations/:conversationId" element={<DocumentConversationPage />} />
      <Route path="/projects/:projectId/agent-sessions/:agentSessionId/conversations/:conversationId" element={<AgentSessionResolver />} />
      <Route path="/projects/:projectId/agent-sessions/:agentSessionId/entity-conversations/:conversationId" element={<div>Standard entity session</div>} />
      <Route path="/projects/:projectId/sessionless-conversations/:conversationId" element={<ProjectConversationPage />} />
      <Route path="/projects/:projectId/plans/:planId/stages/:stageId/steps/:stepId/conversations/:conversationId" element={<PlanConversationPage />} />
    </Routes>
  </MemoryRouter>);
};

describe("conversation route ownership", () => {
  beforeEach(() => {
    sessions.mockReset();
    sessions.mockReturnValue({ agentSessions: [{
      id: "session-1", conversationId: "conversation-1", type: AgentSessionType.EntityConversation,
      entityId: "owner-document", entityType: EntityType.DesignDoc,
    }], isFetched: true });
  });

  it.each([
    "/projects/project-1/conversations/conversation-1",
    "/projects/project-1/design-docs/wrong-document/conversations/conversation-1",
    "/projects/project-1/agent-sessions/wrong-session/conversations/conversation-1",
    WebPathService.conversation({ projectId: "project-1", conversationId: "conversation-1" }),
  ])("replaces saved and new-tab destinations with the original owner: %s", async (entry) => {
    mount(entry);
    await screen.findByText("Standard entity session");
    expect(screen.getByTestId("location")).toHaveTextContent("/projects/project-1/agent-sessions/session-1/entity-conversations/conversation-1?entityId=owner-document&entityType=DESIGN_DOC");
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText("Previous page");
  });

  it("renders the same sessionless thread without reentering ownership resolution", async () => {
    sessions.mockReturnValue({ agentSessions: [], isFetched: true });
    mount(WebPathService.conversation({ projectId: "project-1", conversationId: "conversation-1" }));
    expect(await screen.findByTestId("sessionless-thread")).toHaveAttribute("data-conversation-id", "conversation-1");
    expect(screen.getByTestId("location")).toHaveTextContent(WebPathService.sessionlessConversation({ projectId: "project-1", conversationId: "conversation-1" }));
    expect(sessions).toHaveBeenCalledTimes(1);
  });

  it("retains the established plan stage and step destination", async () => {
    const entry = "/projects/project-1/plans/plan-1/stages/stage-1/steps/step-1/conversations/conversation-1";
    mount(entry);
    expect(await screen.findByTestId("sessionless-thread")).toHaveAttribute("data-conversation-id", "conversation-1");
    expect(screen.getByTestId("location")).toHaveTextContent(entry);
    expect(sessions).not.toHaveBeenCalled();
  });
});

import { http, HttpResponse } from "msw";
import { QueryClientProvider } from "@tanstack/react-query";
import { conversationKeys } from "../../../data/collections/conversations";
import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentSessionCurrentState, ConversationStatus } from "../../../api";
import {
  createLaunchHarness,
  deferred,
  launchConfiguration,
  launchConversation,
  launchMocks,
  launchPlan,
  launchScope,
  launchSession,
} from "../../../test/planLaunchHarness";
import { PlanFromDesignDocChat } from "../PlanFromDesignDocChat";
import { fetchWorkItemReferencePage } from "../../../data/collections/workItemReferences";

const Chat = () => (
  <PlanFromDesignDocChat
    organizationId={launchScope.organizationId}
    projectId={launchScope.projectId}
    planId={launchPlan.id}
    plan={launchPlan}
    configuration={launchConfiguration}
    conversation={launchMocks.conversation().data}
    onGenerationReset={() => {}}
  />
);

describe("plan launch to rendered conversation", () => {
  beforeEach(() => {
    globalThis.mswServer.use(http.get("http://localhost:3847/api/local/repos", () =>
      HttpResponse.json({ machineId: launchSession.machineId, bindings: [] }),
    ));
  });
  it("serves the feature references read through the real API client", async () => {
    const page = await fetchWorkItemReferencePage(
      { ...launchScope, workItemType: "FEATURE" },
      1
    );
    expect(page).toEqual({
      items: [],
      pagination: {
        page: 1,
        limit: 500,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrevious: false,
      },
    });
  });

  it("does not revive handoff feedback when runtime activity finishes while the route is unmounted", async () => {
    const harness = createLaunchHarness();
    const tree = (visible: boolean) => (
      <harness.Wrapper>
        <MemoryRouter>{visible && <Chat />}</MemoryRouter>
      </harness.Wrapper>
    );
    const view = render(tree(true));
    fireEvent.click(
      screen.getByTestId("plan-from-design-doc-start-generating")
    );
    await waitFor(() =>
      expect(harness.dependencies.startSession).toHaveBeenCalledTimes(1)
    );
    view.rerender(tree(false));
    await act(async () => harness.finish("succeeded"));
    await waitFor(() =>
      expect(harness.dependencies.reconcile).toHaveBeenCalled()
    );
    act(() => {
      harness.runtime(AgentSessionCurrentState.Thinking, 2);
      harness.runtime(AgentSessionCurrentState.Idle, 3);
    });
    view.rerender(tree(true));
    await screen.findByTestId("empty-conversation-history");
    expect(
      screen.queryByTestId("agent-launch-handoff")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-current-state-indicator")
    ).not.toBeInTheDocument();
    expect(harness.dependencies.startSession).toHaveBeenCalledTimes(1);
  });

  it("retains preparation, pending dispatch and acceptance across remounts, then yields to runtime and later IDLE", async () => {
    const harness = createLaunchHarness();
    const { queryClient } = harness;
    const workflowKey = conversationKeys.workflowList(
      launchScope.organizationId,
      launchScope.projectId,
      {
        workflowName: launchConversation.workflowName!,
        workflowAboutId: launchPlan.id,
      }
    );
    queryClient.setQueryData(workflowKey, [launchConversation]);
    const saved = deferred<{ status: "applied"; plan: typeof launchPlan }>();
    launchMocks.updatePlan.mockReturnValueOnce(saved.promise);
    const tree = (visible: boolean) => (
      <QueryClientProvider client={queryClient}>
        <harness.Wrapper>
          <MemoryRouter>{visible && <Chat />}</MemoryRouter>
        </harness.Wrapper>
      </QueryClientProvider>
    );
    const view = render(tree(true));
    fireEvent.click(
      screen.getByTestId("plan-from-design-doc-start-generating")
    );
    expect(
      screen.getByTestId("plan-generation-launch-progress")
    ).toHaveTextContent("Saving generation settings");
    view.rerender(tree(false));
    view.rerender(tree(true));
    expect(
      screen.getByTestId("plan-from-design-doc-start-generating")
    ).toBeDisabled();
    await act(async () =>
      saved.resolve({ status: "applied", plan: launchPlan })
    );
    await waitFor(() =>
      expect(harness.dependencies.startSession).toHaveBeenCalledTimes(1)
    );
    expect(
      screen.getByTestId("plan-generation-launch-progress")
    ).toHaveTextContent("Waiting for CLI acceptance");
    expect(
      screen.queryByTestId("agent-launch-handoff")
    ).not.toBeInTheDocument();
    view.rerender(tree(false));
    view.rerender(tree(true));
    expect(
      screen.getByTestId("plan-generation-launch-progress")
    ).toHaveTextContent("Waiting for CLI acceptance");
    await act(async () => harness.finish("succeeded"));
    const handoff = await screen.findByTestId("agent-launch-handoff");
    expect(within(handoff).getByRole("progressbar")).toBeInTheDocument();
    expect(within(handoff).getByRole("status")).toHaveTextContent("Loading…");
    expect(handoff).not.toHaveTextContent("CLI accepted the launch");
    expect(queryClient.getQueryState(workflowKey)?.isInvalidated).toBe(true);
    expect(
      screen.getByTestId("empty-conversation-history")
    ).toBeInTheDocument();
    view.rerender(tree(false));
    view.rerender(tree(true));
    expect(screen.getByTestId("agent-launch-handoff")).toBeInTheDocument();
    await act(async () =>
      harness.runtime(AgentSessionCurrentState.Thinking, 2)
    );
    // Query cache writes reach observers on the next tick.
    await waitFor(() =>
      expect(
        screen.queryByTestId("agent-launch-handoff")
      ).not.toBeInTheDocument()
    );
    expect(
      screen.getByTestId("agent-session-current-state-indicator")
    ).toBeInTheDocument();
    await act(async () => harness.runtime(AgentSessionCurrentState.Idle, 3));
    view.rerender(tree(false));
    view.rerender(tree(true));
    expect(
      screen.queryByTestId("agent-launch-handoff")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-session-current-state-indicator")
    ).not.toBeInTheDocument();
    expect(harness.dependencies.startSession).toHaveBeenCalledTimes(1);
    expect(launchMocks.updateSession).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "denied"] as const)(
    "keeps %s dispatch actionable after leaving and returning",
    async (outcome) => {
      const harness = createLaunchHarness();
      const tree = (visible: boolean) => (
        <harness.Wrapper>
          <MemoryRouter>{visible && <Chat />}</MemoryRouter>
        </harness.Wrapper>
      );
      const view = render(tree(true));
      fireEvent.click(
        screen.getByTestId("plan-from-design-doc-start-generating")
      );
      await waitFor(() =>
        expect(harness.dependencies.startSession).toHaveBeenCalledTimes(1)
      );
      view.rerender(tree(false));
      await act(async () => harness.finish(outcome));
      view.rerender(tree(true));
      await screen.findByText(
        "Launch rejected. Check machine authorization and retry."
      );
      expect(
        screen.getByTestId("plan-from-design-doc-start-generating")
      ).toBeEnabled();
      expect(
        screen.queryByTestId("agent-launch-handoff")
      ).not.toBeInTheDocument();
      expect(harness.dependencies.startSession).toHaveBeenCalledTimes(1);
    }
  );

  it("surfaces configuration failure and permits a successful retry", async () => {
    const harness = createLaunchHarness();
    launchMocks.updateSession.mockResolvedValueOnce({
      ok: false,
      error: "Settings could not be saved. Retry.",
    });
    render(
      <harness.Wrapper>
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      </harness.Wrapper>
    );
    fireEvent.click(
      screen.getByTestId("plan-from-design-doc-start-generating")
    );
    await screen.findByText("Settings could not be saved. Retry.");
    expect(harness.dependencies.startSession).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByTestId("plan-from-design-doc-start-generating")
    );
    await waitFor(() =>
      expect(harness.dependencies.startSession).toHaveBeenCalledTimes(1)
    );
    await act(async () => harness.finish("succeeded"));
    await screen.findByTestId("agent-launch-handoff");
  });

  it("dismisses mounted setup when canonical conversation data changes and supplies canonical state to the existing indicator", () => {
    const harness = createLaunchHarness();
    const tree = (
      <harness.Wrapper>
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      </harness.Wrapper>
    );
    const view = render(tree);
    expect(
      screen.getByTestId("plan-from-design-doc-start-generating")
    ).toBeInTheDocument();
    launchMocks.conversation.mockReturnValue({
      data: { ...launchConversation, status: ConversationStatus.InProgress },
      isFetched: true,
      isLoading: false,
      error: null,
    });
    launchMocks.sessions.mockReturnValue({
      agentSessions: [
        {
          ...launchSession,
          currentState: AgentSessionCurrentState.AwaitingApproval,
        },
      ],
      isFetched: true,
    });
    // Remove the live overlay to prove canonical fallback wiring.
    act(() => harness.clearRuntime());
    view.rerender(
      <harness.Wrapper>
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      </harness.Wrapper>
    );
    expect(
      screen.queryByTestId("plan-from-design-doc-start-generating")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("agent-session-current-state-indicator")
    ).toBeInTheDocument();
    expect(harness.dependencies.startSession).not.toHaveBeenCalled();
  });
});

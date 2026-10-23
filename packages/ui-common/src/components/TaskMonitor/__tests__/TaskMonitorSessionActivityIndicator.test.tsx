import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AgentSessionCurrentState } from "../../../api";
import { agentSessionKeys } from "../../../data/collections/agentSessions";
import { writeAgentSessionCurrentState } from "../../../data/collections/agentSessionLiveState";
import { TaskMonitorSessionActivityIndicator } from "../TaskMonitorSessionActivityIndicator";

const organizationId = "organization-1";
const projectId = "project-1";
const agentSessionId = "44444444-4444-4444-8444-444444444444";

describe("TaskMonitorSessionActivityIndicator", () => {
  it("renders the selected Agent Session's current activity state", async () => {
    const queryClient = new QueryClient();
    // A completed read with no live revision yet.
    queryClient.setQueryData(
      agentSessionKeys.currentState(organizationId, projectId, agentSessionId),
      null,
    );
    const write = (
      currentState: AgentSessionCurrentState,
      revision: number,
    ) =>
      act(() =>
        writeAgentSessionCurrentState(queryClient, organizationId, projectId, {
          agentSessionId,
          currentState,
          revision,
          transitionedAt: `2026-08-07T00:00:0${revision}.000Z`,
        }),
      );
    render(
      <QueryClientProvider client={queryClient}>
        <TaskMonitorSessionActivityIndicator
          organizationId={organizationId}
          projectId={projectId}
          agentSessionId={agentSessionId}
        />
      </QueryClientProvider>,
    );

    expect(
      screen.queryByTestId("task-monitor-session-activity"),
    ).not.toBeInTheDocument();

    write(AgentSessionCurrentState.Thinking, 1);
    await waitFor(() =>
      expect(
        screen.getByTestId("task-monitor-session-activity"),
      ).toHaveAttribute("data-phase", AgentSessionCurrentState.Thinking),
    );
    expect(screen.getByLabelText("Thinking")).toBeVisible();

    write(AgentSessionCurrentState.Writing, 2);
    await waitFor(() =>
      expect(
        screen.getByTestId("task-monitor-session-activity"),
      ).toHaveAttribute("data-phase", AgentSessionCurrentState.Writing),
    );
    expect(screen.getByLabelText("Writing")).toBeVisible();

    write(AgentSessionCurrentState.Idle, 3);
    await waitFor(() =>
      expect(
        screen.queryByTestId("task-monitor-session-activity"),
      ).not.toBeInTheDocument(),
    );
  });
});

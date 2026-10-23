import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "reactflow";
import { MemoryRouter } from "react-router-dom";

const canHoverState = { value: true };

vi.mock("../../../hooks/useCanHover", () => ({
  useCanHover: () => canHoverState.value,
}));

import { PathServiceProvider } from "../../../contexts/PathServiceContext";
import { getPathService, type PathService } from "../../../services";
import { ActivityGraphMessageNode } from "../ActivityGraphMessageNode";
import type { ActivityGraphMessageNodeData } from "../ActivityGraphMessageNode";

type ActivityGraphMessageNodeTestData = Omit<
  ActivityGraphMessageNodeData,
  "reports" | "systemMessageType"
> &
  Partial<Pick<ActivityGraphMessageNodeData, "reports" | "systemMessageType">>;

const renderMessageNode = (data: ActivityGraphMessageNodeTestData) => {
  const resolvedData: ActivityGraphMessageNodeData = {
    reports: [],
    systemMessageType: null,
    ...data,
  };
  return render(
    <MemoryRouter>
      <PathServiceProvider pathService={getPathService()}>
        <ReactFlowProvider>
          <ActivityGraphMessageNode data={resolvedData} />
        </ReactFlowProvider>
      </PathServiceProvider>
    </MemoryRouter>
  );
};

describe("ActivityGraphMessageNode", () => {
  beforeEach(() => {
    canHoverState.value = true;
  });

  it("renders response text", () => {
    renderMessageNode({
      responseText: "This is a system response",
      agentSessionId: "session-1",
      isStreaming: false,
      nodeWidth: 250,
    });

    expect(screen.getByText("This is a system response")).toBeDefined();
  });

  it("renders timestamp when provided", () => {
    renderMessageNode({
      responseText: "Some response",
      agentSessionId: "session-1",
      isStreaming: false,
      createdAt: "3/2/2026, 10:00:00 AM",
      nodeWidth: 250,
    });

    expect(screen.getByText("3/2/2026, 10:00:00 AM")).toBeDefined();
  });

  it("shows streaming indicator when streaming", () => {
    renderMessageNode({
      responseText: "Partial...",
      agentSessionId: "session-1",
      streamingText: "Streaming content",
      isStreaming: true,
      nodeWidth: 250,
    });

    expect(
      screen.getByTestId("activity-gantt-message-streaming-indicator")
    ).toBeDefined();
    expect(screen.getByText("Streaming content")).toBeDefined();
  });

  it("does not show streaming indicator when not streaming", () => {
    renderMessageNode({
      responseText: "Complete response",
      agentSessionId: "session-1",
      isStreaming: false,
      nodeWidth: 250,
    });

    expect(
      screen.queryByTestId("activity-gantt-message-streaming-indicator")
    ).toBeNull();
  });

  it("prefers streamingText over responseText when streaming", () => {
    renderMessageNode({
      responseText: "Old text",
      agentSessionId: "session-1",
      streamingText: "New streaming text",
      isStreaming: true,
      nodeWidth: 250,
    });

    expect(screen.getByText("New streaming text")).toBeDefined();
    expect(screen.queryByText("Old text")).toBeNull();
  });

  it("renders the message as a link when project id is provided", () => {
    renderMessageNode({
      responseText: "Linked response",
      agentSessionId: "session-1",
      isStreaming: false,
      nodeWidth: 250,
      projectId: "project-1",
    });

    expect(screen.getByTestId("activity-gantt-message-node")).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session-by-id/session-1"
    );
  });

  it("renders plan-scoped coding session links when plan context exists", () => {
    const basePathService = getPathService();
    const pathService: PathService = {
      ...basePathService,
      planAgentSession: ({ planId, agentSessionId }) =>
        `/custom/plans/${planId}/agent-sessions/${agentSessionId}`,
    };

    render(
      <MemoryRouter>
        <PathServiceProvider pathService={pathService}>
          <ReactFlowProvider>
            <ActivityGraphMessageNode
              data={{
                responseText: "Linked response",
                agentSessionId: "session-1",
                isStreaming: false,
                nodeWidth: 250,
                reports: [],
                systemMessageType: null,
                projectId: "project-1",
                planScope: {
                  planId: "plan-1",
                  stageId: "stage-1",
                  stepId: "step-1",
                },
              }}
            />
          </ReactFlowProvider>
        </PathServiceProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId("activity-gantt-message-node")).toHaveAttribute(
      "href",
      "/custom/plans/plan-1/agent-sessions/session-1"
    );
  });

  it("opens the message hover preview on hover when the device supports hover", () => {
    vi.useFakeTimers();

    renderMessageNode({
      responseText: "Preview-only response",
      agentSessionId: "session-hover-desktop",
      isStreaming: false,
      nodeWidth: 250,
    });

    fireEvent.mouseEnter(screen.getByTestId("activity-gantt-message-node"));

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getAllByText("Preview-only response").length).toBeGreaterThan(
      1
    );
    vi.useRealTimers();
  });

  it("suppresses the message hover preview on touch devices", () => {
    vi.useFakeTimers();
    canHoverState.value = false;

    renderMessageNode({
      responseText: "Preview-only response",
      agentSessionId: "session-hover-touch",
      isStreaming: false,
      nodeWidth: 250,
    });

    fireEvent.mouseEnter(screen.getByTestId("activity-gantt-message-node"));

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getAllByText("Preview-only response")).toHaveLength(1);
    vi.useRealTimers();
  });
});

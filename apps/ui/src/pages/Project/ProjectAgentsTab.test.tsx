import { act, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectAgentsTab } from "./ProjectAgentsTab";

const mockQueryState: Record<string, string> = {};
const mockSetQueryState = vi.fn();
const mockSegmentedToggle = vi.fn();
const mockCodingSessions = vi.fn();
const mockConversations = vi.fn();
const mockAutomation = vi.fn();
const mockCosts = vi.fn();
const mockUsage = vi.fn();

vi.mock("nuqs", () => ({
  parseAsStringLiteral: () => ({ withDefault: () => ({}) }),
  useQueryState: (key: string) => [
    mockQueryState[key] ?? "agent-sessions",
    mockSetQueryState,
  ],
}));

vi.mock("../../components/SegmentedToggle", () => ({
  SegmentedToggle: (props: unknown) => {
    mockSegmentedToggle(props);
    return <div data-testid="agents-selector" />;
  },
}));

vi.mock("../../components/Activity", () => ({
  PaginatedCodingSessionsFeed: (props: unknown) => {
    mockCodingSessions(props);
    return <div>Agent Sessions panel</div>;
  },
  PaginatedSessionFeed: (props: unknown) => {
    mockConversations(props);
    return <div>Conversations panel</div>;
  },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  TaskMonitorActivityTab: (props: unknown) => {
    mockAutomation(props);
    return <div>Automation panel</div>;
  },
}));

vi.mock("./views", () => ({
  CostsView: (props: unknown) => {
    mockCosts(props);
    return <div>Costs panel</div>;
  },
  UsageView: (props: unknown) => {
    mockUsage(props);
    return <div>Usage panel</div>;
  },
}));

describe("ProjectAgentsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockQueryState.agentsSubTab;
  });

  const renderTab = () =>
    render(
      <MemoryRouter>
        <ProjectAgentsTab
          organizationId="org-1"
          projectId="project-1"
          userId="user-1"
        />
      </MemoryRouter>,
    );

  it("defaults to Agent Sessions with an ordered responsive selector", () => {
    renderTab();

    expect(mockSegmentedToggle).toHaveBeenCalledWith(
      expect.objectContaining({
        mobileDropdown: true,
        segments: [
          { value: "agent-sessions", label: "Agent Sessions" },
          { value: "conversations", label: "Conversations" },
          { value: "automation", label: "Automation" },
          { value: "costs", label: "Costs" },
          { value: "usage", label: "Usage" },
        ],
        value: "agent-sessions",
      }),
    );
    expect(mockCodingSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        organizationId: "org-1",
        projectId: "project-1",
      }),
    );
    expect(screen.queryByText("Conversations panel")).not.toBeInTheDocument();
  });

  it("restores Conversations directly and preserves session navigation state", () => {
    mockQueryState.agentsSubTab = "conversations";
    const rendered = renderTab();
    const conversationProps = mockConversations.mock.calls[0]?.[0] as {
      onSessionNavigate: () => void;
    };

    expect(mockConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        variant: "conversations",
      }),
    );

    act(() => conversationProps.onSessionNavigate());
    mockQueryState.agentsSubTab = "agent-sessions";
    rendered.rerender(
      <MemoryRouter>
        <ProjectAgentsTab
          organizationId="org-1"
          projectId="project-1"
          userId="user-1"
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Conversations panel")).toBeInTheDocument();
    expect(screen.queryByText("Agent Sessions panel")).not.toBeInTheDocument();
  });

  it("wires canonical automation paths", () => {
    const rendered = renderTab();

    mockQueryState.agentsSubTab = "automation";
    rendered.unmount();
    renderTab();
    const automationProps = mockAutomation.mock.calls[0]?.[0] as {
      buildTaskMonitorPath: (target: Record<string, string>) => string;
      organizationId: string;
      projectId: string;
    };
    expect(automationProps).toMatchObject({
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(
      automationProps.buildTaskMonitorPath({ kind: "task", taskId: "task-1" }),
    ).toBe("/projects/project-1/tasks/task-1");
    expect(
      automationProps.buildTaskMonitorPath({
        kind: "plan",
        planId: "plan-1",
        taskId: "task-1",
      }),
    ).toBe("/projects/project-1/plans/plan-1/task-monitor/task-1");
  });

  it("uses the Agents-specific query key and persists selector changes", () => {
    renderTab();
    const selectorProps = mockSegmentedToggle.mock.calls[0]?.[0] as {
      onChange: (value: string) => void;
    };

    act(() => selectorProps.onChange("automation"));

    expect(mockSetQueryState).toHaveBeenCalledWith("automation", {
      history: "push",
    });
  });

  it("restores Costs in Agents and forwards the project identity", () => {
    mockQueryState.agentsSubTab = "costs";
    renderTab();

    expect(mockCosts).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });
    expect(screen.getByText("Costs panel")).toBeInTheDocument();
  });

  it("restores Usage from a direct link and forwards the project identity", () => {
    mockQueryState.agentsSubTab = "usage";
    renderTab();

    expect(mockSegmentedToggle).toHaveBeenCalledWith(
      expect.objectContaining({ value: "usage" }),
    );
    expect(mockUsage).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });
    expect(screen.getByText("Usage panel")).toBeInTheDocument();
    expect(screen.queryByText("Costs panel")).not.toBeInTheDocument();
  });
});

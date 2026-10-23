import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  WorkStatus,
} from "@hey-hey/ui-common/api";

const mocks = vi.hoisted(() => ({
  capsuleAction: vi.fn(),
  completeSessionPanel: vi.fn(),
  updateAgentSession: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  CapsuleAction: (props: {
    renderContent?: () => React.ReactNode;
    [key: string]: unknown;
  }) => {
    mocks.capsuleAction(props);
    return (
      <div data-testid="capsule-action">
        {props.renderContent?.()}
      </div>
    );
  },
  CompleteSessionPanel: (props: Record<string, unknown>) => {
    mocks.completeSessionPanel(props);
    return <div data-testid="complete-session-panel" />;
  },
}));

vi.mock("@hey-hey/ui-common/clients", () => ({
  agentSessionsClient: {
    updateAgentSession: mocks.updateAgentSession,
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItems: () => ({ updateTask: mocks.updateTask }),
}));

import { AgentSessionStatusActionCapsule } from "./AgentSessionStatusActionCapsule";

const buildAgentSession = (
  status: AgentSessionStatus = AgentSessionStatus.InProgress
) =>
  ({
    id: "session-1",
    title: "Coding session",
    status,
    type: AgentSessionType.Coding,
    machineId: "machine-1",
  }) as never;

const activeTask = {
  id: "task-1",
  initiativeId: "initiative-1",
  status: WorkStatus.Active,
} as never;

describe("AgentSessionStatusActionCapsule", () => {
  it("does not pass a validation-launch handoff into the Verifying completion panel", () => {
    render(
      <AgentSessionStatusActionCapsule
        organizationId="org-1"
        projectId="project-1"
        agentSession={buildAgentSession()}
        taskData={{ ...activeTask, status: WorkStatus.Verifying }}
      />
    );

    const panelProps = mocks.completeSessionPanel.mock.lastCall?.[0] as Record<
      string,
      unknown
    >;

    expect(panelProps).toMatchObject({
      taskId: "task-1",
      currentStatus: WorkStatus.Verifying,
    });
    expect(panelProps).not.toHaveProperty("organizationId");
    expect(panelProps).not.toHaveProperty("projectId");
    expect(panelProps).not.toHaveProperty("onValidationSessionCreated");
  });

  it("retains Complete and Resume status actions", () => {
    const { rerender } = render(
      <AgentSessionStatusActionCapsule
        organizationId="org-1"
        projectId="project-1"
        agentSession={buildAgentSession()}
      />
    );

    expect(mocks.capsuleAction.mock.lastCall?.[0]).toMatchObject({
      behavior: "click",
      label: "Complete",
    });

    rerender(
      <AgentSessionStatusActionCapsule
        organizationId="org-1"
        projectId="project-1"
        agentSession={buildAgentSession(AgentSessionStatus.Completed)}
      />
    );

    expect(mocks.capsuleAction.mock.lastCall?.[0]).toMatchObject({
      behavior: "click",
      label: "Resume",
    });
  });
});

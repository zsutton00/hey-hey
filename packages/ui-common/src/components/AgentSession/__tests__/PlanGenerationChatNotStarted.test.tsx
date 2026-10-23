import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConversationStatus,
  InitiationType,
  WorkflowName,
  type ConversationResponseDto,
  type TaskResponseDto,
  type PlanConfigurationV1,
} from "../../../api";
import type { ConversationScrollPolicy } from "../../Conversation/ConversationViewer";

const usePlanFromDesignDocConversationMock = vi.fn();
const startConversationMutateMock = vi.fn();
vi.mock("../PlanGenerationSetup", () => ({
  PlanGenerationSetup: () => (
    <div data-testid="plan-generation-setup">Start generating</div>
  ),
}));

vi.mock("../../../data/hooks/usePlanFromDesignDocConversation", () => ({
  usePlanFromDesignDocConversation: (
    organizationId: string | undefined,
    projectId: string | undefined,
    planId: string | undefined,
    options: Record<string, unknown> = {}
  ) =>
    usePlanFromDesignDocConversationMock(
      organizationId,
      projectId,
      planId,
      options
    ),
}));

// The platform start-conversation rail must no longer be reachable from this
// surface — the kickoff is user-driven from the pre-start placeholder. A spy on
// the (now unused) hook lets us assert it is never invoked.
vi.mock("../../../data/hooks/useStartConversation", () => ({
  useStartConversation: () => ({ mutate: startConversationMutateMock }),
}));

vi.mock("../PlanFromDesignDocChat", () => ({
  PlanFromDesignDocChat: ({
    conversation,
    planId,
    scrollPolicy,
  }: {
    conversation: ConversationResponseDto;
    planId: string;
    scrollPolicy?: ConversationScrollPolicy;
  }) => (
    <div
      data-testid="plan-from-design-doc-chat"
      data-scroll-policy={scrollPolicy?.mode}
    >
      <span data-testid="plan-from-design-doc-conversation-id">
        {conversation.id}
      </span>
      <span data-testid="plan-from-design-doc-plan-id">{planId}</span>
    </div>
  ),
}));

import { PlanGenerationChat } from "../PlanGenerationChat";

const baseConversation: ConversationResponseDto = {
  id: "conv-pfdd-1",
  projectId: "proj-1",
  organizationId: "org-1",
  initiatedBy: InitiationType.System,
  status: ConversationStatus.NotStarted,
  version: 1,
  workflowName: WorkflowName.PlanFromDesignDoc,
  workflowAboutId: "plan-1",
  workflowAboutType: "plan",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:01:00Z",
};

const plan: Pick<TaskResponseDto, "id" | "name" | "status"> = {
  id: "plan-1",
  name: "Plan",
  status: "BACKLOG",
};
const configuration: PlanConfigurationV1 = {
  schemaVersion: "plan-configuration.v1",
  planType: "STANDARD",
  worktreeBranch: null,
};

const mockHookReturn = (status: ConversationStatus) => ({
  conversation: { ...baseConversation, status },
  isFetched: true,
  isLoading: false,
  error: null,
  markStale: vi.fn(),
});

describe("PlanGenerationChat NOT_STARTED handling", () => {
  beforeEach(() => {
    usePlanFromDesignDocConversationMock.mockReset();
    startConversationMutateMock.mockReset();
  });

  it("routes a NOT_STARTED conversation straight into the pre-start placeholder path without auto-starting it", () => {
    usePlanFromDesignDocConversationMock.mockReturnValue(
      mockHookReturn(ConversationStatus.NotStarted)
    );

    render(
      <PlanGenerationChat
        organizationId="org-1"
        projectId="proj-1"
        planId="plan-1"
        plan={plan}
        configuration={configuration}
      />
    );

    // The pre-start placeholder lives inside PlanFromDesignDocChat, so a
    // NOT_STARTED conversation is delegated rather than gated behind a spinner.
    expect(screen.getByTestId("plan-from-design-doc-chat")).toBeTruthy();
    expect(
      screen.getByTestId("plan-from-design-doc-conversation-id").textContent
    ).toBe(baseConversation.id);
    expect(screen.getByTestId("plan-from-design-doc-chat")).toHaveAttribute(
      "data-scroll-policy",
      "disabled"
    );
    // No platform start-conversation is auto-fired on this surface anymore.
    expect(startConversationMutateMock).not.toHaveBeenCalled();
  });

  it("shows the loading affordance while the conversation has not been fetched", () => {
    usePlanFromDesignDocConversationMock.mockReturnValue({
      conversation: null,
      isFetched: false,
      isLoading: true,
      error: null,
      markStale: vi.fn(),
    });

    const { container } = render(
      <PlanGenerationChat
        organizationId="org-1"
        projectId="proj-1"
        planId="plan-1"
        plan={plan}
        configuration={configuration}
      />
    );

    expect(container.querySelector(".MuiLinearProgress-root")).toBeTruthy();
    expect(screen.queryByTestId("plan-from-design-doc-chat")).toBeNull();
  });

  it("explains when a draft has no generation conversation", () => {
    usePlanFromDesignDocConversationMock.mockReturnValue({
      conversation: null,
      isFetched: true,
      isLoading: false,
      error: null,
      markStale: vi.fn(),
    });

    const { container } = render(
      <PlanGenerationChat
        organizationId="org-1"
        projectId="proj-1"
        planId="plan-1"
        plan={plan}
        configuration={configuration}
      />
    );

    expect(screen.queryByTestId("plan-from-design-doc-chat")).toBeNull();
    expect(
      container.querySelector('[data-testid="plan-generation-setup"]')
    ).toHaveTextContent("Start generating");
  });

  it("delegates with the same conversation id regardless of status", () => {
    usePlanFromDesignDocConversationMock.mockReturnValue(
      mockHookReturn(ConversationStatus.InProgress)
    );

    render(
      <PlanGenerationChat
        organizationId="org-1"
        projectId="proj-1"
        planId="plan-1"
        plan={plan}
        configuration={configuration}
      />
    );

    expect(
      screen.getByTestId("plan-from-design-doc-conversation-id").textContent
    ).toBe(baseConversation.id);
    expect(startConversationMutateMock).not.toHaveBeenCalled();
  });
});

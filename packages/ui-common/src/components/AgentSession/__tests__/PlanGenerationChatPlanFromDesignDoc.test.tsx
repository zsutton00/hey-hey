import { act, render, screen, waitFor } from "@testing-library/react";
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
import type {
  PlanGenerationDraftProps,
  PlanGenerationLaunchHandoff,
} from "../usePlanGenerationDraft";

const usePlanFromDesignDocConversationMock = vi.fn();
let prepared: ((handoff: PlanGenerationLaunchHandoff) => void) | undefined;
vi.mock("../PlanGenerationSetup", () => ({
  PlanGenerationSetup: (props: PlanGenerationDraftProps) => {
    prepared = props.onPrepared;
    return <div data-testid="plan-generation-setup">Start generating</div>;
  },
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

vi.mock("../PlanFromDesignDocChat", () => ({
  PlanFromDesignDocChat: ({
    conversation,
    planId,
    autoStartAgentSessionId,
    scrollPolicy,
  }: {
    conversation: ConversationResponseDto;
    planId: string;
    autoStartAgentSessionId?: string;
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
      <span data-testid="auto-start-agent-session-id">
        {autoStartAgentSessionId ?? "none"}
      </span>
    </div>
  ),
}));

import { PlanGenerationChat } from "../PlanGenerationChat";

const planFromDesignDocConversation: ConversationResponseDto = {
  id: "conv-pfdd-1",
  projectId: "proj-1",
  organizationId: "org-1",
  initiatedBy: InitiationType.System,
  status: ConversationStatus.InProgress,
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

describe("PlanGenerationChat plan-from-design-doc routing", () => {
  it("hands the draft's single Start click to the newly prepared session", async () => {
    const markStale = vi.fn();
    usePlanFromDesignDocConversationMock.mockReturnValue({
      conversation: null,
      isFetched: true,
      isLoading: false,
      error: null,
      markStale,
    });
    const props = {
      organizationId: "org-1",
      projectId: "proj-1",
      planId: "plan-1",
      plan,
      configuration,
    };
    const view = render(<PlanGenerationChat {...props} />);
    act(() =>
      prepared?.({
        conversationId: "fresh-conversation",
        agentSessionId: "fresh-session",
        settings: {
          machineId: "machine",
          worktreeBranch: null,
          planCombinationAggressiveness: "medium",
          selection: {
            provider: "codex",
            model: "chosen-model",
            reasoningEffort: null,
          },
        },
      })
    );
    expect(markStale).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("plan-from-design-doc-chat")).toBeNull();
    usePlanFromDesignDocConversationMock.mockReturnValue({
      conversation: {
        ...planFromDesignDocConversation,
        id: "fresh-conversation",
        status: ConversationStatus.NotStarted,
      },
      isFetched: true,
      isLoading: false,
      error: null,
      markStale,
    });
    view.rerender(<PlanGenerationChat {...props} />);
    expect(screen.getByTestId("auto-start-agent-session-id")).toHaveTextContent(
      "fresh-session"
    );
  });
  beforeEach(() => {
    usePlanFromDesignDocConversationMock.mockReset();
  });

  it("delegates to PlanFromDesignDocChat when a plan-from-design-doc conversation exists", async () => {
    usePlanFromDesignDocConversationMock.mockReturnValue({
      conversation: planFromDesignDocConversation,
      isFetched: true,
      isLoading: false,
      error: null,
      markStale: vi.fn(),
    });

    render(
      <PlanGenerationChat
        organizationId="org-1"
        projectId="proj-1"
        planId="plan-1"
        plan={plan}
        configuration={configuration}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("plan-from-design-doc-chat")).toBeTruthy();
    });

    expect(
      screen.getByTestId("plan-from-design-doc-conversation-id").textContent
    ).toBe(planFromDesignDocConversation.id);
    expect(screen.getByTestId("plan-from-design-doc-chat")).toHaveAttribute(
      "data-scroll-policy",
      "disabled"
    );
    expect(
      screen.queryByTestId("plan-generation-conversation-scrollport")
    ).not.toBeInTheDocument();
  });

  it("offers setup when a reset draft has no generation conversation", () => {
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

  it("waits for the reset conversation before forwarding its replacement session", () => {
    usePlanFromDesignDocConversationMock.mockReturnValue({
      conversation: planFromDesignDocConversation,
      isFetched: true,
      isLoading: false,
      error: null,
      markStale: vi.fn(),
    });

    const { rerender } = render(
      <PlanGenerationChat
        organizationId="org-1"
        projectId="proj-1"
        planId="plan-1"
        plan={plan}
        configuration={configuration}
        resetLaunchHandoff={{
          conversationId: "conv-pfdd-2",
          agentSessionId: "session-pfdd-2",
        }}
      />
    );

    expect(screen.queryByTestId("plan-from-design-doc-chat")).toBeNull();

    usePlanFromDesignDocConversationMock.mockReturnValue({
      conversation: {
        ...planFromDesignDocConversation,
        id: "conv-pfdd-2",
        status: ConversationStatus.NotStarted,
        createdAt: "2026-05-02T00:00:00Z",
        updatedAt: "2026-05-02T00:00:00Z",
      },
      isFetched: true,
      isLoading: false,
      error: null,
      markStale: vi.fn(),
    });
    rerender(
      <PlanGenerationChat
        organizationId="org-1"
        projectId="proj-1"
        planId="plan-1"
        plan={plan}
        configuration={configuration}
        resetLaunchHandoff={{
          conversationId: "conv-pfdd-2",
          agentSessionId: "session-pfdd-2",
        }}
      />
    );

    expect(
      screen.getByTestId("plan-from-design-doc-conversation-id")
    ).toHaveTextContent("conv-pfdd-2");
    expect(screen.getByTestId("auto-start-agent-session-id")).toHaveTextContent(
      "session-pfdd-2"
    );
  });

  it("leaves ordinary pre-start conversations manual", () => {
    usePlanFromDesignDocConversationMock.mockReturnValue({
      conversation: {
        ...planFromDesignDocConversation,
        status: ConversationStatus.NotStarted,
      },
      isFetched: true,
      isLoading: false,
      error: null,
      markStale: vi.fn(),
    });

    render(
      <PlanGenerationChat
        organizationId="org-1"
        projectId="proj-1"
        planId="plan-1"
        plan={plan}
        configuration={configuration}
      />
    );

    expect(screen.getByTestId("auto-start-agent-session-id")).toHaveTextContent(
      "none"
    );
  });
});

it("surfaces a failed conversation lookup rather than an empty or loading view", () => {
  usePlanFromDesignDocConversationMock.mockReturnValue({
    conversation: null,
    isFetched: false,
    isLoading: false,
    error: new Error("Generation lookup failed"),
  });
  render(
    <PlanGenerationChat
      organizationId="org-1"
      projectId="proj-1"
      planId="plan-1"
      plan={plan}
      configuration={configuration}
    />
  );
  expect(screen.getByTestId("plan-generation-error")).toHaveTextContent(
    "Generation lookup failed"
  );
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

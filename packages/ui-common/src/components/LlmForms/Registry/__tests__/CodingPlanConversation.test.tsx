import { prepareFormInitialData } from "../../../Conversation/utils/conversationFormHelpers";
import {
  MessageType,
  MessageStatus,
  type MessageResponseDto,
} from "../../../../api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodingPlanApprovalField } from "../CodingPlanApprovalField";
import { CodingPlanDiscrepancyField } from "../CodingPlanDiscrepancyField";
import { submitPromptForRun } from "../../../AgentSession/runtime/hooks/usePromptRunSubmission";
import { LocalPromptType } from "../../../../api";
import { useCodingPlanConversation } from "../useCodingPlanConversation";
import { renderHook, act } from "@testing-library/react";

const state = vi.hoisted(() => ({
  submit: vi.fn(),
  answer: vi.fn(),
  node: vi.fn(),
  gate: vi.fn(),
  scope: vi.fn(),
  catalog: "ready" as "idle" | "ready",
  stored: null as unknown,
  remember: vi.fn(),
}));
vi.mock("../../../AgentSession/useRuntimeModelCatalog", () => ({
  useRuntimeModelCatalog: () => ({ status: state.catalog }),
}));
vi.mock(
  "../../../AgentSession/surfaceSelectionMemory",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../AgentSession/surfaceSelectionMemory")
    >()),
    readSurfaceSelection: () => state.stored,
    writeSurfaceSelection: (surfaceId: string, selection: unknown) => {
      state.stored = selection;
      state.remember(surfaceId, selection);
    },
  }),
);
vi.mock("../../../AgentSession/capabilityCatalog", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../AgentSession/capabilityCatalog")
  >()),
  supportsFastMode: () => true,
}));
vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({
    agentSession: { machineId: "machine", serviceIds: [] },
  }),
}));
vi.mock(
  "../../../AgentSession/operations/useAgentSessionInteractionAccess",
  () => ({
    useAgentSessionInteractionAccess: () => ({
      isDeviceEnabled: true,
      interactions: { submitMessage: state.submit },
    }),
  }),
);
vi.mock("../../../../clients/serviceClients", () => ({
  workflowsClient: {
    getConversationWorkflowNode: state.node,
    getConversationPromptType: state.gate,
  },
}));
vi.mock(
  "../../../../data/hooks/submitControllerAuthorizedWorkflowAnswer",
  () => ({ submitControllerAuthorizedWorkflowAnswer: state.answer }),
);
vi.mock("../../../../data/hooks/useServices", () => ({
  useServices: () => ({
    services: [{ id: "service", name: "Hey Hey", status: "ACTIVE" }],
    isFetched: true,
    isLoading: false,
  }),
}));
vi.mock("../../../AgentSession/RuntimeModelSelector", () => ({
  RuntimeModelSelector: (
    props: import("../../../AgentSession/RuntimeModelSelector").RuntimeModelSelectorProps,
  ) => (
    <button
      onClick={() => {
        props.onProviderChange("codex");
        props.onModelChange("implementation-model");
        props.onReasoningEffortChange("high");
        props.onFastModeChange(true);
      }}
    >
      Pick implementation runtime
    </button>
  ),
}));
vi.mock("../StartupPlanStructuredField", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../StartupPlanStructuredField")>()),
  classifyStartupServiceScope: (...args: unknown[]) => state.scope(...args),
  StartupServiceScopeSection: () => <div>Required Services</div>,
  StartupSourceReferenceInline: () => <div>Source reference</div>,
}));
vi.mock("../../../SmarterTextAreaCard/MentionBadge", () => ({
  MentionBadgeInner: ({ mention }: { mention: { entityName: string } }) => (
    <a href="/mentioned-entity">{mention.entityName}</a>
  ),
}));

const context = {
  organizationId: "org",
  projectId: "project",
  conversationId: "conversation",
  agentSessionId: "session",
  messageId: "context",
  codingPlanVersionMessageId: "context",
  interaction: { proposals: [] },
};
const planning = {
  responseType: "coding_plan_version_v1",
  markdown:
    "# Agree on the result\n\nAllow normal replies. Keep explicit approval.",
  requiredServiceIds: ["service"],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.catalog = "ready";
  state.stored = {
    provider: "claude",
    model: "default-model",
    reasoningEffort: null,
  };
  state.scope.mockReturnValue({ status: "valid" });
  state.node.mockResolvedValue({
    data: { data: { currentNodeId: "feature-sync-coding-plan" } },
  });
  state.gate.mockResolvedValue({
    data: {
      data: {
        workflowState: "agent-pending",
        nodeId: "feature-sync-coding-plan",
        triggerMessageId: "original-review",
      },
    },
  });
  state.submit.mockResolvedValue({ state: "succeeded" });
  state.answer.mockResolvedValue(undefined);
});

describe("conversational planning controls", () => {
  it.each(["context", "original-review"])(
    "restores approval after reopening from evidence under %s",
    async (parentMessageId) => {
      const config = {
        field: "plan",
        description: "",
        type: "coding_plan_version",
        payload: planning,
      };
      const first = render(
        <CodingPlanApprovalField
          config={config}
          context={context}
          isSubmitted={false}
        />,
      );
      fireEvent.change(
        screen.getByLabelText("Feedback to include with approval"),
        { target: { value: "Preserve keyboard access." } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      await screen.findByRole("button", { name: "Approved" });
      const request = state.answer.mock.calls[0][0];
      const planMessage: MessageResponseDto = {
        id: "context",
        projectId: "project",
        conversationId: "conversation",
        createdAt: "2026-10-26T00:00:00Z",
        type: MessageType.System,
        status: MessageStatus.Completed,
        awaitingResponse: false,
        data: { type: "QUESTIONS" },
      };
      const evidence: MessageResponseDto = {
        ...planMessage,
        id: "answer",
        type: MessageType.User,
        parentMessageId,
        data: { action: request.action, payload: request.payload },
      };
      const persisted = JSON.parse(
        JSON.stringify([planMessage, evidence]),
      ) as MessageResponseDto[];
      const initial = prepareFormInitialData(
        { message: planMessage, canEdit: true, state: "completed" },
        [{ id: "plan", type: "coding_plan_version", payload: planning }],
        persisted,
      );
      first.unmount();
      render(
        <CodingPlanApprovalField
          config={config}
          context={{ ...context, codingPlanVersionMessageId: null }}
          value={initial.plan}
          isSubmitted={true}
        />,
      );
      expect(screen.getByRole("button", { name: "Approved" })).toBeDisabled();
      expect(
        screen.getByLabelText("Feedback to include with approval"),
      ).toHaveValue("Preserve keyboard access.");
      expect(
        screen.getByLabelText("Feedback to include with approval"),
      ).toBeDisabled();
      expect(state.answer).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {
      action: "APPROVED",
      payload: {
        responseType: "coding_plan_version_approval_v1",
        versionMessageId: "another-version",
      },
    },
    { comment: "Approved in ordinary discussion" },
    {
      action: "REFINE",
      payload: {
        responseType: "coding_plan_version_approval_v1",
        versionMessageId: "context",
      },
    },
  ])("does not approve from unrelated evidence %j", (data) => {
    const message: MessageResponseDto = {
      id: "context",
      projectId: "project",
      conversationId: "conversation",
      createdAt: "2026-10-26T00:00:00Z",
      type: MessageType.System,
      status: MessageStatus.Completed,
      awaitingResponse: false,
      data: { type: "QUESTIONS" },
    };
    const answer: MessageResponseDto = {
      ...message,
      id: "answer",
      type: MessageType.User,
      parentMessageId: "context",
      data,
    };
    const initial = prepareFormInitialData(
      {
        message: { ...message, responses: [answer] },
        canEdit: true,
        state: "completed",
      },
      [{ id: "plan", type: "coding_plan_version", payload: planning }],
    );
    render(
      <CodingPlanApprovalField
        config={{
          field: "plan",
          type: "coding_plan_version",
          description: "",
          payload: planning,
        }}
        context={context}
        value={initial.plan}
        isSubmitted={false}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
  });

  it("shows a rejected stale approval without reporting success or sending chat", async () => {
    state.answer.mockRejectedValue({
      response: {
        data: {
          message: "The plan has changed. Review the complete replacement.",
        },
      },
    });
    render(
      <CodingPlanApprovalField
        config={{
          field: "plan",
          description: "",
          type: "coding_plan_version",
          payload: planning,
        }}
        context={context}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText(
      "The plan has changed. Review the complete replacement.",
    );
    expect(screen.queryByRole("button", { name: "Approved" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(state.answer).toHaveBeenCalledTimes(1);
    expect(state.submit).not.toHaveBeenCalled();
  });

  it.each([
    {
      versionMessageId: null,
      message: "Waiting for a complete replacement plan before approval.",
    },
    {
      versionMessageId: "newer-context",
      message:
        "This is a previous plan version. Review the current complete plan to approve.",
    },
  ])(
    "hides approval and model controls when the current version is $versionMessageId",
    ({ versionMessageId, message }) => {
      render(
        <CodingPlanApprovalField
          config={{
            field: "plan",
            description: "",
            type: "coding_plan_version",
            payload: planning,
          }}
          context={{ ...context, codingPlanVersionMessageId: versionMessageId }}
        />,
      );
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Pick implementation runtime" }),
      ).toBeNull();
      expect(screen.getByTestId("coding-plan-version-state")).toHaveTextContent(
        message,
      );
      expect(state.answer).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      severity: "high",
      label: "High",
      icon: "ErrorIcon",
      color: "rgb(211, 47, 47)",
    },
    {
      severity: "medium",
      label: "Medium",
      icon: "WarningIcon",
      color: "rgb(237, 108, 2)",
    },
    {
      severity: "low",
      label: "Low",
      icon: "InfoIcon",
      color: "rgb(2, 136, 209)",
    },
  ])(
    "shows a display-only $label issue with its intended action",
    ({ severity, label, icon, color }) => {
      render(
        <CodingPlanDiscrepancyField
          config={{
            field: "issue",
            type: "coding_plan_discrepancy",
            payload: {
              sourceRef: { sourceType: "task", sourceId: "hidden-task-id" },
              sourceField: "description",
              sourceExcerpt: "The recorded promise requires approval.",
              discrepancyText:
                "The current behavior in @[task:48a742a7-f8c6-4eeb-b898-c3ee77c5f9c6|Issue task] approves from text.",
              reasoning:
                "Preserve @[feature:7e5c5654-f9fa-445d-aa7e-09b2081555f7|Coding Plan] explicit approval.",
              severity,
            },
          }}
          context={context}
        />,
      );
      expect(screen.getByText(label)).toBeVisible();
      expect(
        screen.getByRole("img", { name: `${label} severity` }),
      ).toHaveAttribute("data-testid", icon);
      expect(screen.getByTestId(icon)).toHaveStyle({ color });
      expect(screen.getByText("What I will do")).toBeVisible();
      expect(screen.getByRole("link", { name: "Issue task" })).toHaveAttribute(
        "href",
      );
      expect(screen.getByRole("link", { name: "Coding Plan" })).toHaveAttribute(
        "href",
      );
      expect(
        screen.queryByText(
          /hidden-task-id|Source reference|Source field|recorded promise|description/,
        ),
      ).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByText("Reply to this issue")).toBeNull();
      expect(state.submit).not.toHaveBeenCalled();
      expect(state.answer).not.toHaveBeenCalled();
    },
  );

  it("sends ordinary conversation feedback once to planning without a workflow answer", async () => {
    const result = await submitPromptForRun({
      interactions: { startSession: vi.fn(), submitMessage: state.submit },
      run: {
        runId: "run",
        provider: "codex",
        providerRunId: "provider-run",
        status: "running",
      },
      organizationId: context.organizationId,
      projectId: context.projectId,
      conversationId: context.conversationId,
      agentSessionId: context.agentSessionId,
      promptDraft: "Keep explicit approval for these issues.",
      startupPrompt: null,
      localPromptType: LocalPromptType.StartupSession,
    });
    expect(result.ok).toBe(true);
    expect(state.submit).toHaveBeenCalledTimes(1);
    expect(state.submit.mock.calls[0][0].intent.data.agentInput).toEqual({
      promptType: "startup_session",
      userMessage: "Keep explicit approval for these issues.",
    });
    expect(state.answer).not.toHaveBeenCalled();
  });

  it.each(["loading", "invalid"])(
    "blocks approval while required Services are %s",
    (status) => {
      state.scope.mockReturnValue({
        status,
        message: "Required Services are unavailable.",
      });
      render(
        <CodingPlanApprovalField
          config={{
            field: "plan",
            type: "coding_plan_version",
            payload: planning,
          }}
          context={context}
        />,
      );
      expect(state.scope).toHaveBeenCalledWith(
        expect.objectContaining({
          requiredServiceIds: planning.requiredServiceIds,
        }),
      );
      expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      expect(state.answer).not.toHaveBeenCalled();
      expect(state.submit).not.toHaveBeenCalled();
    },
  );

  it("keeps Approve and feedback with no Revise control", async () => {
    render(
      <CodingPlanApprovalField
        config={{
          field: "context",
          description: "",
          type: "coding_plan_version",
          payload: planning as never,
        }}
        context={context}
        isSubmitted={false}
      />,
    );
    expect(screen.queryByText(/revise|continue refining/i)).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: "Change implementation model" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Pick implementation runtime" }),
    ).toBeVisible();
    fireEvent.change(
      screen.getByLabelText("Feedback to include with approval"),
      { target: { value: "Preserve keyboard access." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(state.answer).toHaveBeenCalledTimes(1));
    expect(state.answer.mock.calls[0][0]).toMatchObject({
      action: "APPROVED",
      parentMessageId: "context",
      nodeId: "feature-sync-coding-plan",
      payload: {
        responseType: "coding_plan_version_approval_v1",
        versionMessageId: "context",
        feedback: "Preserve keyboard access.",
      },
    });
    expect(state.submit).not.toHaveBeenCalled();
  });
  it("preserves an explicitly chosen implementation runtime", async () => {
    render(
      <CodingPlanApprovalField
        config={{
          field: "context",
          description: "",
          type: "coding_plan_version",
          payload: planning as never,
        }}
        context={context}
        isSubmitted={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Pick implementation runtime" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(state.answer).toHaveBeenCalledTimes(1));
    expect(state.answer.mock.calls[0][0].payload.runtime).toEqual({
      provider: "codex",
      model: "implementation-model",
      reasoningEffort: "high",
      fastMode: true,
    });
  });
  it("retains the selected runtime when a follow-up produces a new review context", async () => {
    const props = {
      config: {
        field: "context",
        description: "",
        type: "coding_plan_version",
        payload: planning as never,
      },
      context,
      isSubmitted: false,
    };
    const first = render(<CodingPlanApprovalField {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Pick implementation runtime" }),
    );
    first.unmount();
    render(
      <CodingPlanApprovalField
        {...props}
        context={{
          ...context,
          messageId: "new-context",
          codingPlanVersionMessageId: "new-context",
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(state.answer).toHaveBeenCalledTimes(1));
    expect(state.answer.mock.calls[0][0].payload).toMatchObject({
      versionMessageId: "new-context",
      runtime: {
        provider: "codex",
        model: "implementation-model",
        reasoningEffort: "high",
        fastMode: true,
      },
    });
  });
  it("restores the remembered plan-approval runtime after a reload", async () => {
    state.stored = {
      provider: "codex",
      model: "remembered-model",
      reasoningEffort: "low",
      fastMode: true,
    };
    render(
      <CodingPlanApprovalField
        config={{
          field: "context",
          description: "",
          type: "coding_plan_version",
          payload: planning as never,
        }}
        context={context}
        isSubmitted={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(state.answer).toHaveBeenCalledTimes(1));
    expect(state.answer.mock.calls[0][0].payload.runtime).toEqual({
      provider: "codex",
      model: "remembered-model",
      reasoningEffort: "low",
      fastMode: true,
    });
  });
  it("remembers a chosen runtime for the plan-approval surface only", () => {
    render(
      <CodingPlanApprovalField
        config={{
          field: "context",
          description: "",
          type: "coding_plan_version",
          payload: planning as never,
        }}
        context={context}
        isSubmitted={false}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Pick implementation runtime" }),
    );
    expect(state.remember).toHaveBeenLastCalledWith("plan-approval", {
      provider: "codex",
      model: "implementation-model",
      reasoningEffort: "high",
      fastMode: true,
    });
  });
  it("disables approval on an older planning context", () => {
    render(
      <CodingPlanApprovalField
        config={{
          field: "context",
          description: "",
          type: "coding_plan_version",
          payload: planning as never,
        }}
        context={{ ...context, codingPlanVersionMessageId: "newer-context" }}
        isSubmitted={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
  it("fails visibly with no pending approval and never falls back to chat", async () => {
    state.gate.mockResolvedValue({
      data: {
        data: {
          workflowState: "agent-pending",
          nodeId: "feature-sync-coding-plan",
          triggerMessageId: null,
        },
      },
    });
    const { result } = renderHook(() => useCodingPlanConversation(context));
    await act(async () => {
      await result.current.submit({
        approval: {
          responseType: "coding_plan_version_approval_v1",
          versionMessageId: "context",
        },
      });
    });
    expect(result.current.error).toContain("no pending planning approval");
    expect(state.answer).not.toHaveBeenCalled();
    expect(state.submit).not.toHaveBeenCalled();
  });
});

import { getDefaultStore } from "jotai";
import {
  codingPlanRuntimeChoice,
  currentCodingPlanRuntime,
} from "../codingPlanRuntimeChoice";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodingPlanApprovalField } from "../CodingPlanApprovalField";
import { CodingPlanDiscrepancyField } from "../CodingPlanDiscrepancyField";
import { useCodingPlanConversation } from "../useCodingPlanConversation";
import { renderHook, act } from "@testing-library/react";

const state = vi.hoisted(() => ({
  submit: vi.fn(),
  answer: vi.fn(),
  node: vi.fn(),
  gate: vi.fn(),
}));
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
vi.mock("../StartupPlanStructuredField", () => ({
  classifyStartupServiceScope: () => ({ status: "valid" }),
  StartupServiceScopeSection: () => <div>Required Services</div>,
  StartupSourceReferenceInline: () => <div>Source reference</div>,
}));
vi.mock("../../../SmarterTextAreaCard/renderInlineMentions", () => ({
  renderInlineMentions: (value: string) => value,
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
  getDefaultStore().set(
    codingPlanRuntimeChoice(context.conversationId),
    currentCodingPlanRuntime,
  );
  vi.clearAllMocks();
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
      expect(screen.queryByLabelText("Change implementation model")).toBeNull();
      expect(screen.getByTestId("coding-plan-version-state")).toHaveTextContent(
        message,
      );
      expect(state.answer).not.toHaveBeenCalled();
    },
  );

  it("submits an issue reply exactly once as direct planning input", async () => {
    render(
      <CodingPlanDiscrepancyField
        config={{
          field: "issue",
          description: "",
          type: "coding_plan_discrepancy",
          payload: {
            sourceRef: { sourceType: "task", sourceId: "task" },
            sourceField: "description",
            sourceExcerpt: "The recorded promise requires approval.",
            discrepancyText: "The current behavior approves from text.",
            reasoning: "Preserve explicit approval.",
            severity: "high",
          },
        }}
        context={context}
        isSubmitted={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Reply to this issue"), {
      target: { value: "Keep the approval button." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    expect(state.submit.mock.calls[0][0].intent.data.agentInput).toEqual({
      promptType: "startup_session",
      userMessage: "Keep the approval button.",
    });
    expect(state.submit.mock.calls[0][0].intent.parentMessageId).toBe(
      "context",
    );
    expect(state.answer).not.toHaveBeenCalled();
  });
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
    fireEvent.change(
      screen.getByLabelText("Feedback to include with approval"),
      { target: { value: "Preserve keyboard access." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(state.answer).toHaveBeenCalledTimes(1));
    expect(state.answer.mock.calls[0][0]).toMatchObject({
      action: "APPROVED",
      parentMessageId: "original-review",
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
      screen.getByRole("checkbox", { name: "Change implementation model" }),
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
      screen.getByRole("checkbox", { name: "Change implementation model" }),
    );
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

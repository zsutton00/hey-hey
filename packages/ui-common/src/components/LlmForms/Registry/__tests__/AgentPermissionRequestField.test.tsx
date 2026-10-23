import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPermissionRequestField } from "../AgentPermissionRequestField";
const submitDecisionMock = vi.hoisted(() => vi.fn());
vi.mock(
  "../../../../data/hooks/useSubmitControllerAuthorizedPermissionDecision",
  () => ({
    useSubmitControllerAuthorizedPermissionDecision: () => ({
      submit: submitDecisionMock,
      isPending: false,
    }),
  })
);

const basePayload = {
  responseType: "agent_request_permission_v1" as const,
  permissionRequest: {
    id: "request-1",
    permissionType: "filesystem_write",
    sessionId: "run-1",
    agentId: "agent-1",
    agentType: "codex" as const,
    timestamp: "2026-03-06T00:00:00.000Z",
    idempotencyToken: "idem-1",
    reason: "Need elevated write access",
    agentIntent: "Patch api contracts",
    referencedFiles: ["src/services/agent-message-mapping.ts"],
    referencedDiffs: ["src/services/agent-message-mapping.ts"],
  },
  rawEvent: {
    toolName: "Edit",
    toolInput: {
      file_path: "/tmp/example.ts",
      old_string: "const oldValue = true;",
      new_string: "const oldValue = false;",
      replace_all: false,
    },
  },
  enrichmentMetadata: {
    reason: "Need elevated write access",
  },
};

const renderField = (overrides?: { agentSessionId?: string | undefined }) => {
  const context = {
    conversationId: "conversation-1",
    organizationId: "org-1",
    projectId: "project-1",
    ...("agentSessionId" in (overrides ?? {})
      ? { agentSessionId: overrides?.agentSessionId }
      : { agentSessionId: "session-1" }),
  };

  return render(
    <AgentPermissionRequestField
      config={{
        field: "permission-field",
        description: "Permission request",
        type: "agent_request_permission",
        payload: basePayload,
      }}
      context={context}
      isSubmitted={false}
    />
  );
};

describe("AgentPermissionRequestField", () => {
  afterEach(() => {
    vi.clearAllMocks();
    submitDecisionMock.mockResolvedValue(undefined as never);
  });

  it("renders compact summary and diff for edit requests", () => {
    submitDecisionMock.mockResolvedValue(undefined as never);
    renderField();

    expect(
      screen.getByTestId("permission-request-summary-request-1")
    ).toHaveTextContent("filesystem_write request for /tmp/example.ts");
    expect(
      screen.getByTestId("permission-request-reason-request-1")
    ).toHaveTextContent("Reason: Need elevated write access");
    expect(
      screen.getByTestId("permission-request-agent-intent-request-1")
    ).toHaveTextContent("Agent intent: Patch api contracts");
    expect(
      screen.queryByTestId("permission-request-edit-replace-all-request-1")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("permission-request-referenced-file-request-1-0")
    ).toHaveTextContent("src/services/agent-message-mapping.ts");
    expect(
      screen.getByTestId("permission-request-diff-request-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("diff-renderer-split-code-view")
    ).toBeInTheDocument();
  });

  it("submits the approve decision via the agent-session permission-decision endpoint", async () => {
    submitDecisionMock.mockResolvedValue(undefined as never);
    renderField();

    await userEvent.click(
      screen.getByTestId("permission-request-approve-request-1")
    );

    await waitFor(() => {
      expect(submitDecisionMock).toHaveBeenCalledTimes(1);
    });

    expect(submitDecisionMock).toHaveBeenCalledWith({
      decision: "approve",
      requestId: "request-1",
      sessionId: "run-1",
      agentType: "codex",
      reason: null,
      idempotencyToken: "idem-1",
    });

    expect(
      await screen.findByTestId(
        "permission-request-submitted-decision-request-1"
      )
    ).toHaveTextContent("Decision: approve");
  });

  it("submits the deny decision via the agent-session permission-decision endpoint", async () => {
    submitDecisionMock.mockResolvedValue(undefined as never);
    renderField();

    await userEvent.click(
      screen.getByTestId("permission-request-deny-request-1")
    );

    await waitFor(() => {
      expect(submitDecisionMock).toHaveBeenCalledTimes(1);
    });

    expect(submitDecisionMock).toHaveBeenCalledWith({
      decision: "deny",
      requestId: "request-1",
      sessionId: "run-1",
      agentType: "codex",
      reason: null,
      idempotencyToken: "idem-1",
    });
  });

  it("surfaces a delivery error when the platform endpoint rejects", async () => {
    submitDecisionMock.mockRejectedValueOnce(new Error("network down"));
    renderField();

    await userEvent.click(
      screen.getByTestId("permission-request-approve-request-1")
    );

    expect(
      await screen.findByTestId("permission-request-delivery-error-request-1")
    ).toHaveTextContent("network down");
  });

  it("fails without firing the endpoint when agentSessionId is missing on the context", async () => {
    renderField({ agentSessionId: undefined });

    await userEvent.click(
      screen.getByTestId("permission-request-approve-request-1")
    );

    expect(
      await screen.findByTestId("permission-request-delivery-error-request-1")
    ).toHaveTextContent("Missing agent session id");
    expect(submitDecisionMock).not.toHaveBeenCalled();
  });
});

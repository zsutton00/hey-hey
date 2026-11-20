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
  }),
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
    />,
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
      screen.getByTestId("permission-request-summary-request-1"),
    ).toHaveTextContent("filesystem_write request for /tmp/example.ts");
    expect(
      screen.getByTestId("permission-request-reason-request-1"),
    ).toHaveTextContent("Reason: Need elevated write access");
    expect(
      screen.getByTestId("permission-request-agent-intent-request-1"),
    ).toHaveTextContent("Agent intent: Patch api contracts");
    expect(
      screen.queryByTestId("permission-request-edit-replace-all-request-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("permission-request-referenced-file-request-1-0"),
    ).toHaveTextContent("src/services/agent-message-mapping.ts");
    expect(
      screen.getByTestId("permission-request-diff-request-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("diff-renderer-split-code-view"),
    ).toBeInTheDocument();
  });

  it("submits the approve decision via the agent-session permission-decision endpoint", async () => {
    submitDecisionMock.mockResolvedValue(undefined as never);
    renderField();

    await userEvent.click(
      screen.getByTestId("permission-request-approve-request-1"),
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
        "permission-request-submitted-decision-request-1",
      ),
    ).toHaveTextContent("Decision: approve");
  });

  it("submits the deny decision via the agent-session permission-decision endpoint", async () => {
    submitDecisionMock.mockResolvedValue(undefined as never);
    renderField();

    await userEvent.click(
      screen.getByTestId("permission-request-deny-request-1"),
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
      screen.getByTestId("permission-request-approve-request-1"),
    );

    expect(
      await screen.findByTestId("permission-request-delivery-error-request-1"),
    ).toHaveTextContent("network down");
  });

  it("fails without firing the endpoint when agentSessionId is missing on the context", async () => {
    renderField({ agentSessionId: undefined });

    await userEvent.click(
      screen.getByTestId("permission-request-approve-request-1"),
    );

    expect(
      await screen.findByTestId("permission-request-delivery-error-request-1"),
    ).toHaveTextContent("Missing agent session id");
    expect(submitDecisionMock).not.toHaveBeenCalled();
  });

  it("keeps concurrent WebSearch requests independent", async () => {
    submitDecisionMock.mockResolvedValue(undefined as never);
    const searchPayload = (id: string, token: string, query: string) => ({
      ...basePayload,
      permissionRequest: {
        ...basePayload.permissionRequest,
        id,
        idempotencyToken: token,
        agentType: "claude" as const,
        reason: `WebSearch: query=${query}, mode=standard`,
      },
      rawEvent: { toolName: "WebSearch", toolInput: { query } },
    });

    render(
      <>
        {[
          searchPayload("search-1", "idem-a", "first query"),
          searchPayload("search-2", "idem-b", "second query"),
        ].map((payload) => (
          <AgentPermissionRequestField
            key={payload.permissionRequest.id}
            config={{
              field: payload.permissionRequest.id,
              description: "Permission request",
              type: "agent_request_permission",
              payload,
            }}
            context={{
              conversationId: "conversation-1",
              organizationId: "org-1",
              projectId: "project-1",
              agentSessionId: "session-1",
            }}
            isSubmitted={false}
          />
        ))}
      </>,
    );

    expect(screen.getAllByText(/query=first query/)).toHaveLength(1);
    expect(screen.getAllByText(/query=second query/)).toHaveLength(1);

    await userEvent.click(
      screen.getByTestId("permission-request-approve-search-1"),
    );

    await waitFor(() => {
      expect(submitDecisionMock).toHaveBeenCalledTimes(1);
    });
    expect(submitDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "search-1",
        idempotencyToken: "idem-a",
      }),
    );
    expect(
      screen.getByTestId("permission-request-approve-search-2"),
    ).toBeEnabled();
  });

  it("lists grouped requests, sends one decision per undecided row for a group decision, and shows persisted decisions", async () => {
    submitDecisionMock.mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    const groupedPayload = {
      ...basePayload,
      permissionRequest: {
        ...basePayload.permissionRequest,
        permissionType: "WebSearch",
      },
      groupedRequests: [
        {
          requestId: "request-1",
          description: "alpha",
          decision: "approve" as const,
          decidedAt: "2026-03-06T00:01:00.000Z",
        },
        {
          requestId: "request-2",
          description: "beta",
          decision: null,
          decidedAt: null,
        },
        {
          requestId: "request-3",
          description: "gamma",
          decision: null,
          decidedAt: null,
        },
      ],
    };
    render(
      <AgentPermissionRequestField
        config={{
          field: "permission-field",
          description: "Permission request",
          type: "agent_request_permission",
          payload: groupedPayload,
        }}
        context={{
          conversationId: "conversation-1",
          organizationId: "org-1",
          projectId: "project-1",
          agentSessionId: "session-1",
        }}
        isSubmitted={false}
      />,
    );

    expect(
      screen.getByTestId("permission-request-summary-request-1").textContent,
    ).toBe("WebSearch · 3 requests");
    expect(
      screen.getByTestId("permission-request-explanation-request-1")
        .textContent,
    ).toBe("Approving lets the agent run that search.");
    expect(screen.getByText("alpha")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("gamma")).toBeTruthy();
    // Already-decided row is shown from the payload and cannot be decided again.
    expect(
      screen.getByTestId("permission-request-submitted-decision-request-1")
        .textContent,
    ).toBe("Approved");
    expect(
      (
        screen.getByTestId(
          "permission-request-approve-request-1",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await user.click(
      screen.getByTestId("permission-request-deny-all-request-1"),
    );

    await waitFor(() => expect(submitDecisionMock).toHaveBeenCalledTimes(2));
    expect(
      submitDecisionMock.mock.calls.map(([call]) => [
        call.requestId,
        call.decision,
      ]),
    ).toEqual([
      ["request-2", "deny"],
      ["request-3", "deny"],
    ]);
  });
});

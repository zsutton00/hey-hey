import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type ControllerAuthorizedActionSubmission,
  type MachineDto,
} from "../../../api";
import { apiClient } from "../../../clients/client";
import type { ControllerAuthorizedActionVariables } from "../useControllerAuthorizedAction";
import { useSubmitControllerAuthorizedPermissionDecision } from "../useSubmitControllerAuthorizedPermissionDecision";

const { authorize, machine } = vi.hoisted(() => ({
  authorize: vi.fn(),
  machine: {
    machineId: "machine-1",
    name: "Studio Mac",
    pairedAt: "2026-08-01T00:00:00.000Z",
    active: true,
    authorizationProtocolVersion: "V2",
    executionReadiness: "READY",
  } satisfies MachineDto,
}));

vi.mock("../../../clients/client", () => ({
  apiClient: { submitAgentSessionPermissionDecision: vi.fn() },
}));
vi.mock("../useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: { machineId: machine.machineId } }),
}));
vi.mock("../useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines: [machine] }),
}));
vi.mock("../useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({
    mutate: authorize,
    isPending: false,
  }),
}));

const endpoint = vi.mocked(apiClient.submitAgentSessionPermissionDecision);

describe("useSubmitControllerAuthorizedPermissionDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    endpoint.mockResolvedValue({ data: { data: { accepted: true } } });
    authorize.mockImplementation(
      async ({ submit }: ControllerAuthorizedActionVariables<unknown>) => ({
        outcome: "ADMITTED",
        data: await submit({
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        } satisfies ControllerAuthorizedActionSubmission),
      })
    );
  });

  it("uses a distinct UUID retry identity while preserving the provider request identity", async () => {
    const { result } = renderHook(() =>
      useSubmitControllerAuthorizedPermissionDecision(
        "organization-1",
        "project-1",
        "agent-session-1"
      )
    );
    const request = {
      decision: "approve" as const,
      requestId: "3",
      sessionId: "provider-session-1",
      agentType: "codex" as const,
      reason: null,
      idempotencyToken: "idempotency-1",
    };

    await act(() => result.current.submit(request));

    const authorizedAction = authorize.mock.calls[0][0].action;
    expect(authorizedAction).toEqual({
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      ),
      actionCategory: HostActionCategory.AuthorityIncreasingControl,
      actionType:
        HostAffectingActionType.ConversationControlPermissionDecision,
      targetKind: HostActionTargetKind.AgentSession,
      targetId: "agent-session-1",
    });
    expect(authorizedAction.requestId).not.toBe(request.requestId);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ machine, action: authorizedAction })
    );
    expect(authorizedAction).not.toHaveProperty("targetRevision");
    expect(endpoint).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      agentSessionId: "agent-session-1",
      permissionDecisionRequestDto: {
        ...request,
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      },
    });
  });
});

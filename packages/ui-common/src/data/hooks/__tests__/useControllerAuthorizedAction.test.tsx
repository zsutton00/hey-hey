import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ControllerAuthorizationCadence,
  ControllerAuthorizationDenialReason,
  ControllerDeviceGrantScope,
  CurrentAgentOperation,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  MachineExecutionReadinessState,
  type PrepareControllerAuthorizationResponseDto,
} from "../../../api";
import { useControllerAuthorizedAction } from "../useControllerAuthorizedAction";

vi.mock("../../../clients/serviceClients", () => ({
  controllerAuthorizationClient: {
    prepareControllerAuthorization: vi.fn(),
    resolveControllerAuthorization: vi.fn(),
    submitControllerAuthorizedAction: vi.fn(),
  },
}));

vi.mock(
  "../../controllerAuthorization/webauthnAssertion",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../../controllerAuthorization/webauthnAssertion")
    >();
    return { ...actual, collectControllerAssertion: vi.fn() };
  }
);

vi.mock("../../controllerAuthorization/controllerAuthorizationPrompt", () => ({
  requestControllerAuthorizationCadence: vi.fn(),
}));

import { controllerAuthorizationClient } from "../../../clients/serviceClients";
import { requestControllerAuthorizationCadence } from "../../controllerAuthorization/controllerAuthorizationPrompt";
import {
  collectControllerAssertion,
  ControllerAuthorizationClientError,
  ControllerAuthorizationClientFailureCode,
} from "../../controllerAuthorization/webauthnAssertion";

const action = {
  requestId: "10000000-0000-4000-8000-000000000001",
  actionCategory: HostActionCategory.Conversation,
  actionType: HostAffectingActionType.ConversationTrigger,
  targetKind: HostActionTargetKind.AgentSession,
  targetId: "20000000-0000-4000-8000-000000000002",
};

const grantDescriptor = {
  scope: ControllerDeviceGrantScope.ControllerDeviceWindow,
  controllerCredentialId: "credential-1",
  controllerInstallationId: "30000000-0000-4000-8000-000000000003",
  machineId: "machine-1",
  userId: "user-1",
  organizationId: "organization-1",
  cadence: ControllerAuthorizationCadence.OneDay,
  policyRevision: 1,
  allowedActionTypes: new Set(Object.values(CurrentAgentOperation)),
  allowedActionCategories: new Set([HostActionCategory.Conversation]),
  issuedAtMs: 1,
  effectiveExpiresAtMs: 86_400_001,
};

const prepared: PrepareControllerAuthorizationResponseDto = {
  intent: {
    version: 2,
    authorizationId: "authorization-1",
    controllerCredentialId: grantDescriptor.controllerCredentialId,
    controllerInstallationId: grantDescriptor.controllerInstallationId,
    machineId: grantDescriptor.machineId,
    userId: grantDescriptor.userId,
    organizationId: grantDescriptor.organizationId,
    projectId: "project-1",
    cadence: grantDescriptor.cadence,
    policyRevision: grantDescriptor.policyRevision,
    effectiveGrantExpiresAtMs: grantDescriptor.effectiveExpiresAtMs,
    grantDescriptorHash: "a".repeat(64),
    actionCategory: action.actionCategory,
    actionType: action.actionType,
    actionPayloadHash: "b".repeat(64),
    allowedActionTypes: grantDescriptor.allowedActionTypes,
    allowedActionCategories: grantDescriptor.allowedActionCategories,
    target: {
      kind: action.targetKind,
      id: action.targetId,
      revision: null,
    },
    agentSessionId: action.targetId,
    taskMonitorId: null,
    nonce: "server-nonce",
    issuedAtMs: 1,
    expiresAtMs: 120_001,
  },
  publicKey: {
    challenge: "a".repeat(43),
    rpId: "heyhey.dev",
    timeout: 120_000,
    userVerification: "required",
    allowCredentials: [
      {
        type: "public-key",
        id: "credential-1",
        transports: new Set(["internal"]),
      },
    ],
  },
  grantDescriptor,
};

const assertion = {
  kind: "controller_assertion" as const,
  intent: prepared.intent,
  credentialId: "credential-1",
  clientDataJSON: "client-data",
  authenticatorData: "authenticator-data",
  signature: "signature",
  userHandle: null,
  grantDescriptor,
};

const machine = {
  machineId: "machine-1",
  name: "Studio Mac",
  pairedAt: "2099-01-01T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: 2 as const,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerCredentialId: "credential-1",
};

const variables = (submit = vi.fn().mockResolvedValue("submitted")) => ({
  organizationId: "organization-1",
  projectId: "project-1",
  machine,
  action,
  submit,
});

describe("useControllerAuthorizedAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(requestControllerAuthorizationCadence).mockResolvedValue(
      ControllerAuthorizationCadence.OneDay
    );
    vi.mocked(
      controllerAuthorizationClient.resolveControllerAuthorization
    ).mockResolvedValue({
      data: { data: { outcome: "AUTHORIZATION_REQUIRED" } },
    });
    vi.mocked(
      controllerAuthorizationClient.prepareControllerAuthorization
    ).mockResolvedValue({ data: { data: prepared } });
    vi.mocked(
      controllerAuthorizationClient.submitControllerAuthorizedAction
    ).mockResolvedValue({
      data: {
        data: {
          outcome: "ADMITTED",
          authorizationId: prepared.intent.authorizationId,
          consumedAt: "2099-01-01T00:00:00.000Z",
          grantId: null,
        },
      },
    });
    vi.mocked(collectControllerAssertion).mockResolvedValue(assertion);
  });

  it("bypasses the dialog and WebAuthn for a matching active grant", async () => {
    vi.mocked(
      controllerAuthorizationClient.resolveControllerAuthorization
    ).mockResolvedValue({
      data: {
        data: {
          outcome: "ACTIVE_GRANT",
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
          effectiveExpiresAtMs: 99_999,
        },
      },
    });
    const submit = vi.fn().mockResolvedValue("submitted");
    const { result } = renderHook(() => useControllerAuthorizedAction());

    await act(async () => {
      await result.current.mutate(variables(submit));
    });

    expect(submit).toHaveBeenCalledWith({
      authorization: { kind: "bounded_grant", grantId: "grant-1" },
    });
    expect(
      controllerAuthorizationClient.resolveControllerAuthorization
    ).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      resolveControllerAuthorizationRequestDto: {
        machineId: machine.machineId,
        action,
      },
    });
    expect(requestControllerAuthorizationCadence).not.toHaveBeenCalled();
    expect(collectControllerAssertion).not.toHaveBeenCalled();
  });

  it("admits fresh evidence before passing the same evidence to the business request", async () => {
    const sequence: string[] = [];
    vi.mocked(requestControllerAuthorizationCadence).mockImplementation(
      async () => {
        sequence.push("dialog");
        return ControllerAuthorizationCadence.OneDay;
      }
    );
    vi.mocked(
      controllerAuthorizationClient.prepareControllerAuthorization
    ).mockImplementation(async () => {
      sequence.push("prepare");
      return { data: { data: prepared } };
    });
    vi.mocked(collectControllerAssertion).mockImplementation(async () => {
      sequence.push("assert");
      return assertion;
    });
    vi.mocked(
      controllerAuthorizationClient.submitControllerAuthorizedAction
    ).mockImplementation(async () => {
      sequence.push("admit");
      return {
        data: {
          data: {
            outcome: "ADMITTED",
            authorizationId: prepared.intent.authorizationId,
            consumedAt: "2099-01-01T00:00:00.000Z",
            grantId: null,
          },
        },
      };
    });
    const submit = vi.fn(async () => {
      sequence.push("submit");
      return "submitted";
    });
    const cause = {
      operation: "read the current changed-file count",
      purpose: "Show the current changed files for this coding session.",
    };
    const { result } = renderHook(() => useControllerAuthorizedAction());

    await act(async () => {
      await result.current.mutate({ ...variables(submit), cause });
    });

    expect(sequence).toEqual([
      "dialog",
      "prepare",
      "assert",
      "admit",
      "submit",
    ]);
    expect(requestControllerAuthorizationCadence).toHaveBeenCalledWith(
      expect.objectContaining({ cause })
    );
    expect(
      controllerAuthorizationClient.submitControllerAuthorizedAction
    ).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      submitControllerAuthorizedActionRequestDto: {
        authorizationId: prepared.intent.authorizationId,
        assertion,
      },
    });
    expect(submit).toHaveBeenCalledWith({ authorization: assertion });
    expect(
      controllerAuthorizationClient.prepareControllerAuthorization
    ).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      prepareControllerAuthorizationRequestDto: {
        machineId: machine.machineId,
        cadence: ControllerAuthorizationCadence.OneDay,
        controllerCredentialId: "credential-1",
        action,
      },
    });
    expect(action).not.toHaveProperty("targetRevision");
  });

  it("does not invoke the business request until fresh evidence is admitted", async () => {
    vi.mocked(controllerAuthorizationClient.submitControllerAuthorizedAction)
      .mockResolvedValueOnce({
        data: {
          data: {
            outcome: "DENIED",
            reason: ControllerAuthorizationDenialReason.AuthorizationExpired,
            retryable: true,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            outcome: "ADMITTED",
            authorizationId: prepared.intent.authorizationId,
            consumedAt: "2099-01-01T00:00:00.000Z",
            grantId: null,
          },
        },
      });
    const submit = vi.fn().mockResolvedValue("submitted");
    const { result } = renderHook(() => useControllerAuthorizedAction());

    await act(async () => {
      await result.current.mutate(variables(submit));
    });

    expect(
      controllerAuthorizationClient.submitControllerAuthorizedAction
    ).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(requestControllerAuthorizationCadence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        errorMessage:
          "That authorization was not admitted. Choose a cadence and authorize again.",
      })
    );
  });

  it("returns a permanent denial instead of retrying forever", async () => {
    vi.mocked(
      controllerAuthorizationClient.submitControllerAuthorizedAction
    ).mockResolvedValue({
      data: {
        data: {
          outcome: "DENIED",
          reason: ControllerAuthorizationDenialReason.SignatureInvalid,
          retryable: false,
        },
      },
    });
    const submit = vi.fn().mockResolvedValue("submitted");
    const { result } = renderHook(() => useControllerAuthorizedAction());

    await act(async () => {
      await expect(result.current.mutate(variables(submit))).resolves.toEqual({
        outcome: "DENIED",
        reason: ControllerAuthorizationDenialReason.SignatureInvalid,
        retryable: false,
      });
    });

    expect(
      controllerAuthorizationClient.submitControllerAuthorizedAction
    ).toHaveBeenCalledTimes(1);
    expect(requestControllerAuthorizationCadence).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    [
      ControllerAuthorizationClientFailureCode.UserCancelled,
      "Passkey approval was cancelled.",
    ],
    [
      ControllerAuthorizationClientFailureCode.UnsupportedWebAuthn,
      "This browser does not support passkey authorization.",
    ],
  ])("returns to the dialog after %s", async (code, message) => {
    vi.mocked(collectControllerAssertion)
      .mockRejectedValueOnce(
        new ControllerAuthorizationClientError(code, message)
      )
      .mockResolvedValueOnce(assertion);
    const { result } = renderHook(() => useControllerAuthorizedAction());

    await act(async () => {
      await result.current.mutate(variables());
    });

    expect(requestControllerAuthorizationCadence).toHaveBeenCalledTimes(2);
    expect(requestControllerAuthorizationCadence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        errorMessage: message,
      })
    );
  });

  it("returns to the dialog when an active grant is rejected", async () => {
    vi.mocked(
      controllerAuthorizationClient.resolveControllerAuthorization
    ).mockResolvedValue({
      data: {
        data: {
          outcome: "ACTIVE_GRANT",
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
          effectiveExpiresAtMs: 99_999,
        },
      },
    });
    const submit = vi
      .fn()
      .mockRejectedValueOnce({
        response: {
          data: {
            code: ControllerAuthorizationDenialReason.AuthorizationExpired,
          },
        },
      })
      .mockResolvedValueOnce("submitted");
    const { result } = renderHook(() => useControllerAuthorizedAction());

    await act(async () => {
      await result.current.mutate(variables(submit));
    });

    expect(requestControllerAuthorizationCadence).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage:
          "That authorization is no longer valid. Choose a cadence and authorize again.",
      })
    );
    expect(submit).toHaveBeenLastCalledWith({ authorization: assertion });
  });

  it("stops without preparation when the dialog is cancelled", async () => {
    vi.mocked(requestControllerAuthorizationCadence).mockRejectedValue(
      new ControllerAuthorizationClientError(
        ControllerAuthorizationClientFailureCode.ConfirmationDeclined,
        "Controller authorization was cancelled."
      )
    );
    const { result } = renderHook(() => useControllerAuthorizedAction());

    await act(async () => {
      await expect(result.current.mutate(variables())).rejects.toMatchObject({
        code: ControllerAuthorizationClientFailureCode.ConfirmationDeclined,
      });
    });

    expect(
      controllerAuthorizationClient.prepareControllerAuthorization
    ).not.toHaveBeenCalled();
  });
});

import { act, renderHook } from "@testing-library/react";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAbandonMachineEnrollmentClaim } from "../useAbandonMachineEnrollmentClaim";
import { useBeginMachineEnrollmentClaim } from "../useBeginMachineEnrollmentClaim";
import { useCompleteMachineEnrollmentClaim } from "../useCompleteMachineEnrollmentClaim";
import { MachineEnrollmentClaimError } from "../machineEnrollmentClaimError";

vi.mock("../../../clients/serviceClients", () => ({
  machinesClient: {
    abandonMachineEnrollmentClaim: vi.fn(),
    beginMachineEnrollmentClaim: vi.fn(),
    completeMachineEnrollmentClaim: vi.fn(),
  },
}));

import { machinesClient } from "../../../clients/serviceClients";

const beginResponse = {
  state: "claimable" as const,
  enrollmentId: "enrollment-1",
  machineId: "machine-1",
  userId: "user-1",
  organizationId: "org-1",
  machineName: "zac-macbook",
  osFamily: "macos" as const,
  cliVersion: "2.2.2",
  machineKeyFingerprint: "sha256:machine",
  controllerLabel: "This browser",
  expiresAt: "2099-01-01T00:00:00.000Z",
  registrationOptions: {
    challenge: "Y2hhbGxlbmdl",
    rp: { id: "heyhey.dev", name: "Hey Hey" },
    user: {
      id: "dXNlci1pZA",
      name: "zac@example.com",
      displayName: "Zac",
    },
    pubKeyCredParams: [{ type: "public-key" as const, alg: -7 as const }],
    authenticatorSelection: {
      userVerification: "required" as const,
      residentKey: "preferred" as const,
    },
    attestation: "none" as const,
  },
};

const awaitingBeginResponse = {
  state: "awaiting-machine-confirmation" as const,
  enrollmentId: "enrollment-1",
  machineId: "machine-1",
  userId: "user-1",
  organizationId: "org-1",
  controllerLabel: "This browser",
  expiresAt: "2099-01-01T00:00:00.000Z",
  credentialFingerprint: "sha256:credential",
  backupEligible: true,
  backupState: false,
};

const completeResponse = {
  enrollmentId: "enrollment-1",
  machineId: "machine-1",
  organizationId: "org-1",
  state: "awaiting-machine-confirmation" as const,
  credentialFingerprint: "sha256:credential",
  backupEligible: true,
  backupState: true,
  controllerLabel: "This browser",
};

const abandonResponse = {
  enrollmentId: "enrollment-1",
  state: "rejected" as const,
};

const credential = {
  id: "credential-id",
  rawId: "cmF3LWlk",
  type: "public-key" as const,
  response: {
    clientDataJSON: "Y2xpZW50",
    attestationObject: "YXR0ZXN0YXRpb24",
    transports: ["internal" as const],
  },
  authenticatorAttachment: "platform" as const,
};

describe("machine enrollment claim hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the generated begin-claim DTO and returns its generated response DTO", async () => {
    vi.mocked(machinesClient.beginMachineEnrollmentClaim).mockResolvedValue({
      data: { data: beginResponse },
    });

    const { result } = renderHook(() => useBeginMachineEnrollmentClaim());

    await act(async () => {
      await result.current.mutate({
        organizationId: "org-1",
        userCode: "BCDFGHJKLM",
        controllerLabel: "This browser",
      });
    });

    expect(machinesClient.beginMachineEnrollmentClaim).toHaveBeenCalledWith({
      beginMachineEnrollmentClaimRequestDto: {
        organizationId: "org-1",
        userCode: "BCDFGHJKLM",
        controllerLabel: "This browser",
      },
    });
    expect(result.current.isSuccess).toBe(true);
  });

  it("returns the generated awaiting-confirmation discriminator arm", async () => {
    vi.mocked(machinesClient.beginMachineEnrollmentClaim).mockResolvedValue({
      data: { data: awaitingBeginResponse },
    });
    const { result } = renderHook(() => useBeginMachineEnrollmentClaim());

    let returned: typeof awaitingBeginResponse | undefined;
    await act(async () => {
      returned = await result.current.mutate({
        organizationId: "org-1",
        userCode: "BCDFGHJKLM",
        controllerLabel: "This browser",
      });
    });

    expect(returned).toEqual(awaitingBeginResponse);
  });

  it("sends the generated complete-claim DTO", async () => {
    vi.mocked(machinesClient.completeMachineEnrollmentClaim).mockResolvedValue({
      data: { data: completeResponse },
    });

    const { result } = renderHook(() => useCompleteMachineEnrollmentClaim());

    await act(async () => {
      await result.current.mutate({
        enrollmentId: "enrollment-1",
        organizationId: "org-1",
        credential,
      });
    });

    const [requestCall] = vi.mocked(
      machinesClient.completeMachineEnrollmentClaim,
    ).mock.calls;

    expect(requestCall?.[0]).toEqual({
      completeMachineEnrollmentClaimRequestDto: {
        enrollmentId: "enrollment-1",
        organizationId: "org-1",
        credential,
      },
    });
    expect(JSON.stringify(requestCall?.[0])).toContain(
      '"transports":["internal"]',
    );
  });

  it("sends the generated abandon-claim DTO and returns the rejected result", async () => {
    vi.mocked(machinesClient.abandonMachineEnrollmentClaim).mockResolvedValue({
      data: { data: abandonResponse },
    });

    const { result } = renderHook(() => useAbandonMachineEnrollmentClaim());
    let returned: typeof abandonResponse | undefined;

    await act(async () => {
      returned = await result.current.mutate({
        enrollmentId: "enrollment-1",
        organizationId: "org-1",
      });
    });

    expect(machinesClient.abandonMachineEnrollmentClaim).toHaveBeenCalledWith({
      abandonMachineEnrollmentClaimRequestDto: {
        enrollmentId: "enrollment-1",
        organizationId: "org-1",
      },
    });
    expect(returned).toEqual(abandonResponse);
  });

  it.each([
    [
      "MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE",
      "Unable to claim this enrollment.",
    ],
    [
      "MACHINE_ENROLLMENT_CLAIM_EXPIRED",
      "This enrollment has expired. Start a fresh enrollment from the CLI.",
    ],
    [
      "MACHINE_ENROLLMENT_CLAIM_TERMINAL",
      "This enrollment can no longer be claimed. Start a fresh enrollment from the CLI.",
    ],
    [
      "MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE",
      "This browser is not compatible with the current enrollment contract. Refresh Hey Hey and try again.",
    ],
  ])("preserves the generated %s server failure", async (code, message) => {
    const serverError = new AxiosError("request failed");
    serverError.response = {
      data: {
        success: false,
        message,
        code,
        data: null,
        timestamp: "2099-01-01T00:00:00.000Z",
        statusCode: 400,
        path: "/api/v1/machines/enrollments/claim/begin",
      },
      status: 400,
      statusText: "Bad Request",
      headers: {},
      config: { headers: {} },
    };
    vi.mocked(machinesClient.beginMachineEnrollmentClaim).mockRejectedValue(
      serverError,
    );

    const { result } = renderHook(() => useBeginMachineEnrollmentClaim());

    await act(async () => {
      await expect(
        result.current.mutate({
          organizationId: "org-1",
          userCode: "BCDFGHJKLM",
          controllerLabel: "This browser",
        }),
      ).rejects.toBeInstanceOf(MachineEnrollmentClaimError);
    });

    expect(result.current.error).toBeInstanceOf(MachineEnrollmentClaimError);
    expect(result.current.error).toMatchObject({
      message,
      code,
      status: 400,
      retryAfterSeconds: null,
    });
  });

  it("preserves the typed rate-limit response", async () => {
    const serverError = new AxiosError("request failed");
    serverError.response = {
      data: {
        success: false,
        message:
          "Too many enrollment claim attempts. Wait before retrying this enrollment.",
        code: "MACHINE_ENROLLMENT_CLAIM_RATE_LIMITED",
        data: null,
        retryAfterSeconds: 60,
        timestamp: "2099-01-01T00:00:00.000Z",
        statusCode: 429,
        path: "/api/v1/machines/enrollments/claim/begin",
      },
      status: 429,
      statusText: "Too Many Requests",
      headers: {},
      config: { headers: {} },
    };
    vi.mocked(machinesClient.beginMachineEnrollmentClaim).mockRejectedValue(
      serverError,
    );
    const { result } = renderHook(() => useBeginMachineEnrollmentClaim());

    await act(async () => {
      await expect(
        result.current.mutate({
          organizationId: "org-1",
          userCode: "BCDFGHJKLM",
          controllerLabel: "This browser",
        }),
      ).rejects.toMatchObject({
        code: "MACHINE_ENROLLMENT_CLAIM_RATE_LIMITED",
        status: 429,
        retryAfterSeconds: 60,
        serverError: { retryAfterSeconds: 60 },
      });
    });
  });

  it("uses a generic non-speculative fallback for incompatible responses", async () => {
    const serverError = new AxiosError("request failed");
    serverError.response = {
      data: {
        success: false,
        message: "The code is stale; generate a newer one.",
        code: "UNRECOGNIZED_SERVER_CODE",
      },
      status: 400,
      statusText: "Bad Request",
      headers: {},
      config: { headers: {} },
    };
    vi.mocked(machinesClient.beginMachineEnrollmentClaim).mockRejectedValue(
      serverError,
    );
    const { result } = renderHook(() => useBeginMachineEnrollmentClaim());

    await act(async () => {
      await expect(
        result.current.mutate({
          organizationId: "org-1",
          userCode: "BCDFGHJKLM",
          controllerLabel: "This browser",
        }),
      ).rejects.toMatchObject({
        message: "Unable to claim this enrollment.",
        code: null,
        status: null,
      });
    });
  });
});

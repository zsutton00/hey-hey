import { controllerInventoryKeys } from "../../collections/controllerInventory";
import { isClientErrorResponse } from "../../query/queryPolicy";
import {
  ControllerManagementErrorDtoMessageEnum,
  ControllerManagementErrorDtoStatusCodeEnum,
  ControllerManagementOutcomeCode,
  ControllerRevocationResponseDtoOutcomeEnum,
  MachineExecutionReadinessState,
  type ControllerRevocationResponseDto,
} from "../../../api";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { AxiosError } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRevokeController } from "../useRevokeController";
import { ControllerManagementDenialError } from "../controllerManagementError";
import { machineKeys } from "../../collections/machines";

vi.mock("../../../clients/serviceClients", () => ({
  machinesClient: {
    revokeMachineController: vi.fn(),
  },
}));

import { machinesClient } from "../../../clients/serviceClients";

const response: ControllerRevocationResponseDto = {
  outcome: ControllerRevocationResponseDtoOutcomeEnum.Revoked,
  machineId: "machine-1",
  controllerCredentialId: "controller-1",
  revokedAt: "2026-08-17T12:00:00.000Z",
  executionReadiness:
    MachineExecutionReadinessState.ControllerEnrollmentRequired,
  reductionFrame: {} as ControllerRevocationResponseDto["reductionFrame"],
};

function createHarness() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(machineKeys.currentUser(), []);
  queryClient.setQueryData(controllerInventoryKeys.detail("machine-1"), {});
  queryClient.setQueryData(controllerInventoryKeys.detail("machine-2"), {});
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const machinesInvalidated = () =>
    queryClient.getQueryState(machineKeys.currentUser())?.isInvalidated;
  return { wrapper, machinesInvalidated, queryClient };
}

describe("useRevokeController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(machinesClient.revokeMachineController).mockResolvedValue({
      data: { data: response },
    });
  });

  it("sends exact machine and controller identifiers", async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useRevokeController(), { wrapper });

    await act(async () => {
      await result.current.mutate({
        machineId: "machine-1",
        controllerCredentialId: "controller-1",
      });
    });

    expect(machinesClient.revokeMachineController).toHaveBeenCalledWith({
      machineId: "machine-1",
      controllerCredentialId: "controller-1",
    });
  });

  it("invalidates only the affected controller inventory and machine after success", async () => {
    const { wrapper, machinesInvalidated, queryClient } = createHarness();
    const { result } = renderHook(() => useRevokeController(), { wrapper });

    await act(async () => {
      await result.current.mutate({
        machineId: "machine-1",
        controllerCredentialId: "controller-1",
      });
    });

    expect(
      queryClient.getQueryState(controllerInventoryKeys.detail("machine-1"))
        ?.isInvalidated
    ).toBe(true);
    expect(
      queryClient.getQueryState(controllerInventoryKeys.detail("machine-2"))
        ?.isInvalidated
    ).toBe(false);
    expect(machinesInvalidated()).toBe(true);
  });

  it("does not invalidate caches when the transport fails", async () => {
    const transportError = new Error("network down");
    vi.mocked(machinesClient.revokeMachineController).mockRejectedValue(
      transportError
    );
    const { wrapper, machinesInvalidated, queryClient } = createHarness();
    const { result } = renderHook(() => useRevokeController(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutate({
          machineId: "machine-1",
          controllerCredentialId: "controller-1",
        })
      ).rejects.toBe(transportError);
    });

    expect(
      queryClient.getQueryState(controllerInventoryKeys.detail("machine-1"))
        ?.isInvalidated
    ).toBe(false);
    expect(machinesInvalidated()).toBe(false);
  });

  it("preserves typed safe denials separately from transport failures", async () => {
    const serverError = new AxiosError("request failed");
    serverError.response = {
      data: {
        success: false,
        message:
          ControllerManagementErrorDtoMessageEnum.UnableToCompleteControllerManagementOperation,
        code: ControllerManagementOutcomeCode.AlreadyRevoked,
        data: null,
        timestamp: "2026-08-17T12:00:00.000Z",
        statusCode: ControllerManagementErrorDtoStatusCodeEnum.NUMBER_410,
        path: "/api/v1/machines/machine-1/controllers/controller-1",
      },
      status: 410,
      statusText: "Gone",
      headers: {},
      config: { headers: {} },
    };
    vi.mocked(machinesClient.revokeMachineController).mockRejectedValue(
      serverError
    );
    const { wrapper, machinesInvalidated, queryClient } = createHarness();
    const { result } = renderHook(() => useRevokeController(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutate({
          machineId: "machine-1",
          controllerCredentialId: "controller-1",
        })
      ).rejects.toBeInstanceOf(ControllerManagementDenialError);
    });

    expect(result.current.error).toBeInstanceOf(
      ControllerManagementDenialError
    );
    expect(result.current.error).toHaveProperty("status", 410);
    expect(isClientErrorResponse(result.current.error)).toBe(true);
    expect(
      queryClient.getQueryState(controllerInventoryKeys.detail("machine-1"))
        ?.isInvalidated
    ).toBe(false);
    expect(machinesInvalidated()).toBe(false);
  });
});

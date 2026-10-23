import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  HostAffectingActionType,
  MachineExecutionReadinessState,
} from "../../../api";
import { tasksClient } from "../../../clients/serviceClients";
import { useSubmitTaskMonitorCommand } from "../useSubmitTaskMonitorCommand";

vi.mock("../../../clients/serviceClients", () => ({
  tasksClient: {
    submitTaskMonitorCommand: vi.fn(),
  },
}));

const authorize = vi.hoisted(() => vi.fn());

vi.mock("../useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    machines: [
      {
        machineId: "machine-1",
        name: "Studio Mac",
        active: true,
        authorizationProtocolVersion: "V2",
        executionReadiness: MachineExecutionReadinessState.Ready,
      },
    ],
  }),
}));

vi.mock("../useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({ mutate: authorize }),
}));

const endpoint = tasksClient.submitTaskMonitorCommand as Mock;

describe("useSubmitTaskMonitorCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    endpoint.mockResolvedValue({
      data: {
        data: {
          commandId: "77777777-7777-4777-8777-777777777777",
          status: "ADMITTED",
          replayed: false,
        },
      },
    });
    authorize.mockImplementation(async (variables) => ({
      outcome: "ADMITTED",
      data: await variables.submit({
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      }),
    }));
  });

  it("calls the generated endpoint and returns its command outcome", async () => {
    const { result } = renderHook(() => useSubmitTaskMonitorCommand());
    const request = {
      requestId: "88888888-8888-4888-8888-888888888888",
      command: { cause: "STOP" as const },
    };

    let outcome: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    await act(async () => {
      outcome = await result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "66666666-6666-4666-8666-666666666666",
        request,
      });
    });

    expect(endpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "66666666-6666-4666-8666-666666666666",
        submitTaskMonitorCommandRequestDto: request,
      })
    );
    expect(outcome).toEqual({
      commandId: "77777777-7777-4777-8777-777777777777",
      status: "ADMITTED",
      replayed: false,
    });
  });

  it("rejects an invalid response envelope", async () => {
    endpoint.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSubmitTaskMonitorCommand());

    await act(async () => {
      await expect(
        result.current.mutate({
          organizationId: "org-1",
          projectId: "project-1",
          monitorId: "66666666-6666-4666-8666-666666666666",
          request: {
            requestId: "88888888-8888-4888-8888-888888888888",
            command: { cause: "PAUSE" },
          },
        })
      ).rejects.toThrow("did not return a monitor-command acknowledgement");
    });
  });

  it("authorizes an authority-increasing command before submission", async () => {
    const { result } = renderHook(() => useSubmitTaskMonitorCommand());
    const request = {
      requestId: "88888888-8888-4888-8888-888888888888",
      machineId: "machine-1",
      command: { cause: "START" as const, launchConfig: {} },
    };

    await act(async () => {
      await result.current.mutate({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "66666666-6666-4666-8666-666666666666",
        request,
      });
    });

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          actionType: HostAffectingActionType.TaskMonitorStart,
          targetId: "66666666-6666-4666-8666-666666666666",
        }),
      })
    );
    expect(endpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        submitTaskMonitorCommandRequestDto: {
          ...request,
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        },
      })
    );
  });
});

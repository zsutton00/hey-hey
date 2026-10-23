import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unifiedApiClient } from "../../../../clients/serviceClients";
import { useRemoteChangedFilesCount } from "./useRemoteChangedFilesCount";

const { authorize, pairedMachines } = vi.hoisted(() => ({
  authorize: vi.fn(),
  pairedMachines: {
    current: [
      {
        machineId: "machine-1",
        name: "Studio Mac",
        pairedAt: "2026-07-01T00:00:00.000Z",
        active: true,
        authorizationProtocolVersion: "V2",
        executionReadiness: "READY",
      },
    ],
  },
}));

vi.mock("../../../../clients/serviceClients", () => ({
  unifiedApiClient: { readAgentSessionCliState: vi.fn() },
}));
vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: { machineId: "machine-1" } }),
}));
vi.mock("../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines: pairedMachines.current }),
}));
vi.mock("../../../../data/hooks/useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({ mutate: authorize }),
}));

const read = vi.mocked(unifiedApiClient.readAgentSessionCliState);
const baseParams = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  agentSessionId: "33333333-3333-4333-8333-333333333333",
  runId: "33333333-3333-4333-8333-333333333333",
  enabled: true,
};

describe("useRemoteChangedFilesCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockImplementation(async ({ submit }) => ({
      outcome: "ADMITTED",
      data: await submit({
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      }),
    }));
  });

  it("does not read an unlaunched session", () => {
    const { result } = renderHook(() =>
      useRemoteChangedFilesCount({ ...baseParams, enabled: false })
    );
    expect(result.current.status).toBe("skipped");
    expect(read).not.toHaveBeenCalled();
  });

  it("returns the changed-file count on request", async () => {
    read.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        timestamp: new Date().toISOString(),
        statusCode: 200,
        data: {
          requestId: "44444444-4444-4444-8444-444444444444",
          operation: "run.changed_files.count",
          status: "success",
          result: { runId: baseParams.runId, changedFilesCount: 3 },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    const { result } = renderHook(() => useRemoteChangedFilesCount(baseParams));
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.count).toBe(3);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        cliReadRequestDto: expect.objectContaining({
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        }),
      })
    );
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: {
          operation:
            "read the current changed-file count from the connected computer",
          purpose: "Show the current changed files for this coding session.",
        },
      })
    );
  });

  it("keeps a valid zero count available instead of treating it as unavailable", async () => {
    read.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        timestamp: new Date().toISOString(),
        statusCode: 200,
        data: {
          requestId: "44444444-4444-4444-8444-444444444444",
          operation: "run.changed_files.count",
          status: "success",
          result: { runId: baseParams.runId, changedFilesCount: 0 },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    const { result } = renderHook(() => useRemoteChangedFilesCount(baseParams));

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.count).toBe(0);
    expect(result.current.readIdentity).toBe(
      `${baseParams.agentSessionId}:${baseParams.runId}:machine-1`
    );
    expect(result.current.retryGeneration).toBe(0);
  });

  it("preserves typed authorization denial retryability without starting the read", async () => {
    authorize.mockResolvedValue({
      outcome: "DENIED",
      reason: "MACHINE_NOT_READY",
      retryable: true,
    });

    const { result } = renderHook(() => useRemoteChangedFilesCount(baseParams));

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.retryable).toBe(true);
    expect(result.current.failureIdentity).toEqual({
      readIdentity: `${baseParams.agentSessionId}:${baseParams.runId}:machine-1`,
      retryGeneration: 0,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps an in-flight result after dependency replay", async () => {
    let resolveRead: (
      response: Awaited<ReturnType<typeof read>>
    ) => void = () => undefined;
    read.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }) as ReturnType<typeof read>
    );

    const { result, rerender } = renderHook(() =>
      useRemoteChangedFilesCount(baseParams)
    );
    await waitFor(() => expect(authorize).toHaveBeenCalledTimes(1));

    pairedMachines.current = [...pairedMachines.current];
    rerender();
    expect(authorize).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRead({
        data: {
          success: true,
          message: "ok",
          timestamp: new Date().toISOString(),
          statusCode: 200,
          data: {
            requestId: "44444444-4444-4444-8444-444444444444",
            operation: "run.changed_files.count",
            status: "success",
            result: { runId: baseParams.runId, changedFilesCount: 3 },
          },
        },
      } as Awaited<ReturnType<typeof read>>);
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.count).toBe(3);
  });

  it("does not reauthorize on dependency replay and retries exactly once", async () => {
    read.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        timestamp: new Date().toISOString(),
        statusCode: 200,
        data: {
          requestId: "44444444-4444-4444-8444-444444444444",
          operation: "run.changed_files.count",
          status: "success",
          result: { runId: baseParams.runId, changedFilesCount: 3 },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    const { result, rerender } = renderHook(() =>
      useRemoteChangedFilesCount(baseParams)
    );
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);

    pairedMachines.current = [...pairedMachines.current];
    rerender();
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await waitFor(() => {
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenCalledTimes(2);
    });
    expect(read).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentSessionId: baseParams.agentSessionId,
        cliReadRequestDto: expect.objectContaining({
          operation: "run.changed_files.count",
          runId: baseParams.runId,
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        }),
      })
    );
  });

  it("can retry again after being disabled and re-enabled", async () => {
    read.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        timestamp: new Date().toISOString(),
        statusCode: 200,
        data: {
          requestId: "44444444-4444-4444-8444-444444444444",
          operation: "run.changed_files.count",
          status: "success",
          result: { runId: baseParams.runId, changedFilesCount: 3 },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useRemoteChangedFilesCount({ ...baseParams, enabled }),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    act(() => result.current.retry());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    rerender({ enabled: false });
    await waitFor(() => expect(result.current.status).toBe("skipped"));

    rerender({ enabled: true });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3));

    act(() => result.current.retry());
    await waitFor(() => expect(read).toHaveBeenCalledTimes(4));
  });

  it("keeps typed CLI failures unavailable instead of coercing them to zero", async () => {
    read.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        timestamp: new Date().toISOString(),
        statusCode: 200,
        data: {
          requestId: "44444444-4444-4444-8444-444444444444",
          operation: "run.changed_files.count",
          status: "error",
          error: { code: "MACHINE_NOT_BOUND", message: "No machine binding." },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    const { result } = renderHook(() => useRemoteChangedFilesCount(baseParams));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.count).toBeNull();
    expect(result.current.errorCode).toBe("MACHINE_NOT_BOUND");
    expect(result.current.retryable).toBe(true);
  });

  it("marks timeout outcomes retryable and replaces the failure after an explicit retry", async () => {
    read.mockResolvedValueOnce({
      data: {
        success: true,
        message: "ok",
        timestamp: new Date().toISOString(),
        statusCode: 200,
        data: {
          requestId: "44444444-4444-4444-8444-444444444444",
          operation: "run.changed_files.count",
          status: "error",
          error: { code: "TIMEOUT", message: "The first read timed out." },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    let resolveRetry: (
      response: Awaited<ReturnType<typeof read>>
    ) => void = () => undefined;
    read.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRetry = resolve;
      }) as ReturnType<typeof read>
    );

    const { result } = renderHook(() => useRemoteChangedFilesCount(baseParams));

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.retryable).toBe(true);
    const firstFailureIdentity = result.current.failureIdentity;

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("loading"));
    if (result.current.status === "loading") {
      expect(result.current.previousFailure?.reason).toBe(
        "The first read timed out."
      );
      expect(result.current.retryGeneration).toBe(1);
    }

    await act(async () => {
      resolveRetry({
        data: {
          success: true,
          message: "ok",
          timestamp: new Date().toISOString(),
          statusCode: 200,
          data: {
            requestId: "55555555-5555-4555-8555-555555555555",
            operation: "run.changed_files.count",
            status: "error",
            error: { code: "READ_FAILED", message: "The second read failed." },
          },
        },
      } as Awaited<ReturnType<typeof read>>);
    });

    await waitFor(() => {
      expect(result.current.status).toBe("unavailable");
      expect(result.current.error).toBe("The second read failed.");
    });
    expect(result.current.failureIdentity).not.toEqual(firstFailureIdentity);
    expect(result.current.retryGeneration).toBe(1);
  });
});

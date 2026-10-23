import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unifiedApiClient } from "../../../../clients/serviceClients";
import { LocalCliRequestError } from "../directoryBindingApi";
import { useRemoteChangedFilesInventory } from "./useRemoteChangedFilesInventory";

const { authorize, machines, localApi } = vi.hoisted(() => ({
  authorize: vi.fn(),
  machines: [{ machineId: "machine-1", name: "Studio Mac" }],
  localApi: {
    listRepos: vi.fn(),
    readRunChangedFilesInventory: vi.fn(),
  },
}));

vi.mock("../../../../clients/serviceClients", () => ({
  unifiedApiClient: { readAgentSessionCliState: vi.fn() },
}));
vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: { machineId: "machine-1" } }),
}));
vi.mock("../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines }),
}));
vi.mock("../../../../data/hooks/useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({ mutate: authorize }),
}));
vi.mock("../directoryBindingApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../directoryBindingApi")>()),
  createDirectoryBindingApi: vi.fn(() => localApi),
  resolveLocalDirectoryRuntimeBaseUrl: vi.fn(() => "http://localhost:3847"),
}));

const read = vi.mocked(unifiedApiClient.readAgentSessionCliState);
const baseParams = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  agentSessionId: "33333333-3333-4333-8333-333333333333",
  runId: "44444444-4444-4444-8444-444444444444",
  open: true,
};
const entry = {
  serviceId: "55555555-5555-4555-8555-555555555555",
  repoPath: "/tmp/repository",
  filePath: "src/example.ts",
  status: "modify" as const,
};

const successResponse = () =>
  ({
    data: {
      success: true,
      message: "ok",
      timestamp: "2026-08-25T00:00:00.000Z",
      statusCode: 200,
      data: {
        operation: "run.changed_files.inventory",
        status: "success",
        result: { runId: baseParams.runId, entries: [entry] },
      },
    },
  } as Awaited<ReturnType<typeof read>>);

describe("useRemoteChangedFilesInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localApi.listRepos.mockRejectedValue(new TypeError("Failed to fetch"));
    authorize.mockImplementation(async ({ submit }) => ({
      outcome: "ADMITTED",
      data: await submit({
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      }),
    }));
  });

  it("loads inventory only while the modal is open", async () => {
    read.mockResolvedValue(successResponse());
    const { result, rerender } = renderHook(
      ({ open }) => useRemoteChangedFilesInventory({ ...baseParams, open }),
      { initialProps: { open: false } }
    );

    expect(result.current.status).toBe("idle");
    expect(read).not.toHaveBeenCalled();

    rerender({ open: true });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.entries).toEqual([entry]);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        cliReadRequestDto: expect.objectContaining({
          operation: "run.changed_files.inventory",
          runId: baseParams.runId,
        }),
      })
    );
  });

  it("retries a typed read error", async () => {
    read.mockResolvedValueOnce({
      data: {
        success: true,
        message: "timeout",
        timestamp: "2026-08-25T00:00:00.000Z",
        statusCode: 200,
        data: {
          operation: "run.changed_files.inventory",
          status: "error",
          error: { code: "TIMEOUT", message: "The read timed out." },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    const { result } = renderHook(() =>
      useRemoteChangedFilesInventory(baseParams)
    );
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.errorCode).toBe("TIMEOUT");

    read.mockResolvedValue(successResponse());
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("loads inventory over loopback when the local CLI owns the Run", async () => {
    localApi.listRepos.mockResolvedValue({
      machineId: "machine-1",
      bindings: [],
    });
    localApi.readRunChangedFilesInventory.mockResolvedValue({
      requestId: "66666666-6666-4666-8666-666666666666",
      operation: "run.changed_files.inventory",
      status: "success",
      result: { runId: baseParams.runId, entries: [entry] },
    });

    const { result } = renderHook(() =>
      useRemoteChangedFilesInventory(baseParams)
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.entries).toEqual([entry]);
    expect(localApi.readRunChangedFilesInventory).toHaveBeenCalledWith(
      baseParams.runId,
      "machine-1"
    );
    expect(authorize).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "machine mismatch",
      error: new LocalCliRequestError(
        "The requested machine does not match the locally paired CLI machine.",
        "MACHINE_NOT_BOUND"
      ),
      errorCode: "MACHINE_NOT_BOUND",
    },
    {
      label: "unknown Run",
      error: new LocalCliRequestError(
        "Persisted Run not found.",
        "RUN_NOT_FOUND"
      ),
      errorCode: "RUN_NOT_FOUND",
    },
    {
      label: "network failure",
      error: new TypeError("Failed to fetch"),
      errorCode: null,
    },
  ])(
    "surfaces a loopback $label without falling back to the remote read",
    async ({ error, errorCode }) => {
      localApi.listRepos.mockResolvedValue({
        machineId: "machine-1",
        bindings: [],
      });
      localApi.readRunChangedFilesInventory.mockRejectedValue(error);

      const { result } = renderHook(() =>
        useRemoteChangedFilesInventory(baseParams)
      );

      await waitFor(() => expect(result.current.status).toBe("unavailable"));
      expect(result.current.entries).toBeNull();
      expect(result.current.error).toBe(error.message);
      expect(result.current.errorCode).toBe(errorCode);
      expect(authorize).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    }
  );

  it("uses the remote read when the reachable CLI is a different machine", async () => {
    localApi.listRepos.mockResolvedValue({
      machineId: "machine-2",
      bindings: [],
    });
    read.mockResolvedValue(successResponse());

    const { result } = renderHook(() =>
      useRemoteChangedFilesInventory(baseParams)
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.entries).toEqual([entry]);
    expect(localApi.readRunChangedFilesInventory).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it("uses the remote read when no loopback CLI is reachable", async () => {
    read.mockResolvedValue(successResponse());

    const { result } = renderHook(() =>
      useRemoteChangedFilesInventory(baseParams)
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(localApi.listRepos).toHaveBeenCalledTimes(1);
    expect(localApi.readRunChangedFilesInventory).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledTimes(1);
  });
});

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unifiedApiClient } from "../../../../clients/serviceClients";
import {
  LocalCliRequestError,
  createDirectoryBindingApi,
} from "../directoryBindingApi";
import { useRemoteChangedFileDetail } from "./useRemoteChangedFileDetail";

const { authorize, machines, localApi } = vi.hoisted(() => ({
  authorize: vi.fn(),
  machines: [{ machineId: "machine-1", name: "Studio Mac" }],
  localApi: {
    listRepos: vi.fn(),
    readRunChangedFileDetail: vi.fn(),
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
const file = {
  serviceId: "55555555-5555-4555-8555-555555555555",
  repoPath: "/tmp/repository",
  filePath: "src/example.ts",
};
const baseParams = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  agentSessionId: "33333333-3333-4333-8333-333333333333",
  runId: "44444444-4444-4444-8444-444444444444",
  file,
  open: true,
};

describe("useRemoteChangedFileDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localApi.listRepos.mockRejectedValue(new Error("loopback unavailable"));
    authorize.mockImplementation(async ({ submit }) => ({
      outcome: "ADMITTED",
      data: await submit({
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      }),
    }));
  });

  it("falls back to the protected remote read when loopback is unreachable", async () => {
    const detail = {
      ...file,
      status: "modify" as const,
      diff: "@@ -1 +1 @@\n-before\n+after",
      preContent: "before",
      postContent: "after",
    };
    read.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        timestamp: "2026-08-25T00:00:00.000Z",
        statusCode: 200,
        data: {
          operation: "run.changed_files.detail",
          status: "success",
          result: { runId: baseParams.runId, file: detail },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    const { result } = renderHook(() => useRemoteChangedFileDetail(baseParams));

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.file).toEqual(detail);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        cliReadRequestDto: expect.objectContaining({
          operation: "run.changed_files.detail",
          runId: baseParams.runId,
          file,
        }),
      }),
    );
  });

  it("uses loopback detail only when the reachable CLI owns the Run", async () => {
    const detail = {
      ...file,
      status: "modify" as const,
      diff: "@@ -1 +1 @@\n-before\n+after",
      preContent: "before",
      postContent: "after",
    };
    localApi.listRepos.mockResolvedValue({
      machineId: "machine-1",
      bindings: [],
    });
    localApi.readRunChangedFileDetail.mockResolvedValue({
      requestId: "66666666-6666-4666-8666-666666666666",
      operation: "run.changed_files.detail",
      status: "success",
      result: { runId: baseParams.runId, file: detail },
    });

    const { result } = renderHook(() => useRemoteChangedFileDetail(baseParams));

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.file).toEqual(detail);
    expect(createDirectoryBindingApi).toHaveBeenCalledWith(
      "http://localhost:3847",
    );
    expect(localApi.readRunChangedFileDetail).toHaveBeenCalledWith(
      baseParams.runId,
      "machine-1",
      file,
    );
    expect(authorize).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps the protected remote path when the reachable CLI is another machine", async () => {
    localApi.listRepos.mockResolvedValue({
      machineId: "machine-2",
      bindings: [],
    });
    read.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        timestamp: "2026-08-25T00:00:00.000Z",
        statusCode: 200,
        data: {
          operation: "run.changed_files.detail",
          status: "success",
          result: {
            runId: baseParams.runId,
            file: {
              ...file,
              status: "modify",
              diff: "diff",
              preContent: "before",
              postContent: "after",
            },
          },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    const { result } = renderHook(() => useRemoteChangedFileDetail(baseParams));

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(localApi.readRunChangedFileDetail).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("falls back remotely when the matching loopback detail route becomes unreachable", async () => {
    localApi.listRepos.mockResolvedValue({
      machineId: "machine-1",
      bindings: [],
    });
    localApi.readRunChangedFileDetail.mockRejectedValue(
      new TypeError("fetch failed"),
    );
    read.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        timestamp: "2026-08-25T00:00:00.000Z",
        statusCode: 200,
        data: {
          operation: "run.changed_files.detail",
          status: "success",
          result: {
            runId: baseParams.runId,
            file: {
              ...file,
              status: "modify",
              diff: "diff",
              preContent: "before",
              postContent: "after",
            },
          },
        },
      },
    } as Awaited<ReturnType<typeof read>>);

    const { result } = renderHook(() => useRemoteChangedFileDetail(baseParams));

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(localApi.readRunChangedFileDetail).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("surfaces typed local detail failures without retrying over the socket", async () => {
    localApi.listRepos.mockResolvedValue({
      machineId: "machine-1",
      bindings: [],
    });
    localApi.readRunChangedFileDetail.mockRejectedValue(
      new LocalCliRequestError(
        "The selected file is outside canonical Run membership.",
        "INVALID_FILE_MEMBERSHIP",
      ),
    );

    const { result } = renderHook(() => useRemoteChangedFileDetail(baseParams));

    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.errorCode).toBe("INVALID_FILE_MEMBERSHIP");
    expect(authorize).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not read without a selected file", () => {
    const { result } = renderHook(() =>
      useRemoteChangedFileDetail({ ...baseParams, file: null }),
    );

    expect(result.current.status).toBe("idle");
    expect(read).not.toHaveBeenCalled();
  });
});

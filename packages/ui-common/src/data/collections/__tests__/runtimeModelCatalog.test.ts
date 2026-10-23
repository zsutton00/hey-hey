import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRuntimeModelCatalog } from "../runtimeModelCatalog";

const mocks = vi.hoisted(() => ({
  listMachines: vi.fn(),
  getRuntimeModelCatalog: vi.fn(),
  authorize: vi.fn(),
  dataRequest: vi.fn(),
}));

vi.mock("../../../clients", () => ({
  agentSessionsClient: {
    getRuntimeModelCatalog: mocks.getRuntimeModelCatalog,
  },
  machinesClient: { listMachines: mocks.listMachines },
  dataClient: { request: mocks.dataRequest },
}));

vi.mock("../../hooks/useControllerAuthorizedAction", () => ({
  executeControllerAuthorizedAction: mocks.authorize,
}));

const params = {
  organizationId: "org-1",
  projectId: "project-1",
  machineId: "machine-1",
};
const machine = { machineId: "machine-1", executionReadiness: "READY" };
const success = {
  requestId: "request-1",
  operation: "runtime.model_catalog.get" as const,
  status: "success" as const,
  result: {
    providers: [
      {
        provider: "claude" as const,
        models: [],
        notice: "Claude Code reported zero models on this machine.",
      },
    ],
  },
};

describe("fetchRuntimeModelCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMachines.mockResolvedValue({
      data: { data: { machines: [machine] } },
    });
    mocks.authorize.mockImplementation(
      async ({ submit }: { submit: (arg: unknown) => Promise<unknown> }) => ({
        outcome: "AUTHORIZED",
        data: await submit({
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        }),
      }),
    );
    mocks.getRuntimeModelCatalog.mockResolvedValue({
      data: { data: success },
    });
  });

  it("reads the named machine's catalog without loading an agent session", async () => {
    const read = await fetchRuntimeModelCatalog(params, {});

    expect(read).toEqual({ id: "request-1", response: success });
    expect(mocks.dataRequest).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        machine,
        action: expect.objectContaining({
          actionCategory: "CLI_READ",
          actionType: "CLI_READ",
          targetKind: "CLI_READ",
          targetId: "machine-1",
        }),
      }),
    );
    expect(mocks.getRuntimeModelCatalog).toHaveBeenCalledWith(
      {
        ...params,
        cliReadRuntimeModelCatalogGetRequest: {
          operation: "runtime.model_catalog.get",
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        },
      },
      {},
    );
  });

  it("returns the CLI's error response untouched", async () => {
    const error = {
      requestId: "request-2",
      operation: "runtime.model_catalog.get",
      status: "error",
      error: { code: "TIMEOUT", message: "No reply." },
    };
    mocks.getRuntimeModelCatalog.mockResolvedValue({ data: { data: error } });

    await expect(fetchRuntimeModelCatalog(params, {})).resolves.toEqual({
      id: "request-2",
      response: error,
    });
  });

  it("fails when the machine is not among the paired machines", async () => {
    mocks.listMachines.mockResolvedValue({ data: { data: { machines: [] } } });

    await expect(fetchRuntimeModelCatalog(params, {})).rejects.toThrow(
      "The execution machine for this protected read is unavailable.",
    );
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("fails when controller authorization is denied", async () => {
    mocks.authorize.mockResolvedValue({ outcome: "DENIED", reason: "EXPIRED" });

    await expect(fetchRuntimeModelCatalog(params, {})).rejects.toThrow(
      "Controller authorization denied: EXPIRED",
    );
    expect(mocks.getRuntimeModelCatalog).not.toHaveBeenCalled();
  });
});

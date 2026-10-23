import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CliReadErrorCode,
  ConversationStartRunRequestDtoProviderEnum,
} from "../../../api";
import { fetchRuntimeModelCatalog } from "../../../data/collections/runtimeModelCatalog";
import {
  listModels,
  listProviders,
  resetCapabilityCatalogForTests,
} from "../capabilityCatalog";
import { useRuntimeModelCatalog } from "../useRuntimeModelCatalog";

vi.mock("../../../data/collections/runtimeModelCatalog", () => ({
  fetchRuntimeModelCatalog: vi.fn(),
}));

const fetchCatalog = vi.mocked(fetchRuntimeModelCatalog);

const source = (machineId: string) => ({
  organizationId: "org-1",
  projectId: "project-1",
  machineId,
});

const success = (providers: unknown[]) => ({
  id: "request-1",
  response: {
    requestId: "request-1",
    operation: "runtime.model_catalog.get" as const,
    status: "success" as const,
    result: { providers },
  },
});

const failure = (code: string, message: string) => ({
  id: "request-1",
  response: {
    requestId: "request-1",
    operation: "runtime.model_catalog.get" as const,
    status: "error" as const,
    error: { code, message },
  },
});

const codexRow = (modelId: string) => ({
  provider: ConversationStartRunRequestDtoProviderEnum.Codex,
  models: [{ id: modelId, label: modelId, efforts: ["medium"] }],
});

describe("useRuntimeModelCatalog", () => {
  beforeEach(() => {
    resetCapabilityCatalogForTests();
    fetchCatalog.mockReset();
  });

  it("requests nothing and offers nothing until a machine is picked", () => {
    const { result } = renderHook(() => useRuntimeModelCatalog(null));

    expect(result.current).toEqual({ status: "idle" });
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(listProviders()).toEqual([]);
  });

  it("asks the CLI on the picked machine and exposes what it reports", async () => {
    fetchCatalog.mockResolvedValue(success([codexRow("cli-gpt")]));

    const { result } = renderHook(() =>
      useRuntimeModelCatalog(source("machine-a")),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(fetchCatalog).toHaveBeenCalledWith(source("machine-a"));
    expect(
      listModels(ConversationStartRunRequestDtoProviderEnum.Codex).map(
        (model) => model.id,
      ),
    ).toEqual(["cli-gpt"]);
  });

  it("keeps each machine's catalog apart and answers from the picked one", async () => {
    fetchCatalog.mockImplementation(async ({ machineId }) =>
      success([codexRow(`${machineId}-model`)]),
    );

    const { result, rerender } = renderHook(
      ({ machineId }) => useRuntimeModelCatalog(source(machineId)),
      { initialProps: { machineId: "machine-a" } },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));

    rerender({ machineId: "machine-b" });
    await waitFor(() =>
      expect(fetchCatalog).toHaveBeenCalledWith(source("machine-b")),
    );
    await waitFor(() =>
      expect(
        listModels(ConversationStartRunRequestDtoProviderEnum.Codex)[0]?.id,
      ).toBe("machine-b-model"),
    );

    rerender({ machineId: "machine-a" });
    expect(
      listModels(ConversationStartRunRequestDtoProviderEnum.Codex)[0]?.id,
    ).toBe("machine-a-model");
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it("shares one request between surfaces addressing the same machine", async () => {
    fetchCatalog.mockResolvedValue(success([codexRow("cli-gpt")]));

    const first = renderHook(() => useRuntimeModelCatalog(source("machine-a")));
    const second = renderHook(() =>
      useRuntimeModelCatalog(source("machine-a")),
    );

    await waitFor(() => expect(first.result.current.status).toBe("ready"));
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("shows the CLI's timeout instead of a built-in list", async () => {
    fetchCatalog.mockResolvedValue(
      failure(CliReadErrorCode.Timeout, "The CLI did not answer in time."),
    );

    const { result } = renderHook(() =>
      useRuntimeModelCatalog(source("machine-a")),
    );

    await waitFor(() =>
      expect(result.current).toEqual({
        status: "error",
        error: "The CLI did not answer in time.",
      }),
    );
    expect(listProviders()).toEqual([]);
  });

  it("shows a failed read, and asks again only when a surface mounts afresh", async () => {
    fetchCatalog.mockRejectedValueOnce(new Error("Machine unreachable"));
    const first = renderHook(() => useRuntimeModelCatalog(source("machine-a")));
    await waitFor(() =>
      expect(first.result.current).toEqual({
        status: "error",
        error: "Machine unreachable",
      }),
    );
    expect(fetchCatalog).toHaveBeenCalledTimes(1);

    fetchCatalog.mockResolvedValue(success([codexRow("cli-gpt")]));
    const second = renderHook(() =>
      useRuntimeModelCatalog(source("machine-a")),
    );
    await waitFor(() => expect(second.result.current.status).toBe("ready"));
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
  });

  it("shows why a catalog was rejected rather than exposing it", async () => {
    fetchCatalog.mockResolvedValue(
      success([
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          models: [{ id: "m", label: "M", efforts: ["turbo"] }],
        },
      ]),
    );

    const { result } = renderHook(() =>
      useRuntimeModelCatalog(source("machine-a")),
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({
      error: expect.stringContaining("turbo"),
    });
    expect(listProviders()).toEqual([]);
  });

  it("exposes a provider's notice when it reported zero models", async () => {
    fetchCatalog.mockResolvedValue(
      success([
        {
          provider: ConversationStartRunRequestDtoProviderEnum.Claude,
          models: [],
          notice: "Claude reported zero models.",
        },
      ]),
    );

    const { result } = renderHook(() =>
      useRuntimeModelCatalog(source("machine-a")),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => {});
    expect(result.current).toMatchObject({
      catalog: [{ notice: "Claude reported zero models." }],
    });
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSkillCatalogEntry,
  CliReadRunSkillsListSuccessResponseDtoResult,
} from "../../../../api";
import { agentSessionsClient } from "../../../../clients";
import { executeControllerAuthorizedAction } from "../../../../data/hooks/useControllerAuthorizedAction";
import { useAgentSkillsCatalog } from "./useAgentSkillsCatalog";

const mocks = vi.hoisted(() => ({
  machineQuery: {
    machines: [
      {
        machineId: "machine-1",
        executionReadiness: "READY",
      },
    ],
    isLoading: false,
    isFetched: true,
    error: null,
  },
  authorize: vi.fn(),
  read: vi.fn(),
  workspaceRead: vi.fn(),
}));

vi.mock("../../../../clients", () => ({
  agentSessionsClient: {
    readAgentSessionCliState: mocks.read,
    listWorkspaceSkills: mocks.workspaceRead,
  },
}));

vi.mock("../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => mocks.machineQuery,
}));

vi.mock("../../../../data/hooks/useControllerAuthorizedAction", () => ({
  executeControllerAuthorizedAction: mocks.authorize,
}));

const baseOptions = {
  enabled: true,
  organizationId: "org-1",
  projectId: "project-1",
  agentSessionId: "session-1",
  runId: "run-1",
  machineId: "machine-1",
  provider: "codex" as const,
};

const makeEntry = (
  overrides: Partial<AgentSkillCatalogEntry> = {}
): AgentSkillCatalogEntry => ({
  provider: "codex",
  name: "release-check",
  catalogScope: "repo",
  description: "Checks the release state.",
  enabled: true,
  ...overrides,
});

const makeResult = (
  overrides: Partial<CliReadRunSkillsListSuccessResponseDtoResult> = {}
): CliReadRunSkillsListSuccessResponseDtoResult => ({
  runId: baseOptions.runId,
  provider: "codex",
  skills: [makeEntry()],
  errors: [],
  ...overrides,
});

const resolveRead = (
  result: CliReadRunSkillsListSuccessResponseDtoResult
): void => {
  mocks.read.mockResolvedValue({
    data: {
      success: true,
      message: "ok",
      timestamp: "2026-09-03T00:00:00.000Z",
      statusCode: 200,
      data: {
        requestId: "request-1",
        operation: "run.skills.list",
        status: "success",
        result,
      },
    },
  });
};

beforeEach(() => {
  mocks.machineQuery.machines = [
    { machineId: "machine-1", executionReadiness: "READY" },
  ];
  mocks.machineQuery.isLoading = false;
  mocks.machineQuery.isFetched = true;
  mocks.machineQuery.error = null;
  mocks.authorize.mockReset();
  mocks.read.mockReset();
  mocks.workspaceRead.mockReset();
  mocks.authorize.mockImplementation(async ({ submit }) => ({
    outcome: "ADMITTED",
    data: await submit({
      authorization: { kind: "bounded_grant", grantId: "grant-1" },
    }),
  }));
});

describe("useAgentSkillsCatalog", () => {
  it("stays idle when the Skill picker is closed", () => {
    const { result } = renderHook(() =>
      useAgentSkillsCatalog({ ...baseOptions, enabled: false })
    );

    expect(result.current.state).toEqual({ status: "idle" });
    expect(mocks.authorize).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("loads the signed, pathless catalog for the selected Run", async () => {
    const catalog = makeResult();
    resolveRead(catalog);

    const { result } = renderHook(() => useAgentSkillsCatalog(baseOptions));

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state).toEqual({ status: "ready", catalog });
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: baseOptions.organizationId,
        projectId: baseOptions.projectId,
        action: expect.objectContaining({
          targetId: baseOptions.agentSessionId,
        }),
      })
    );
    expect(mocks.read).toHaveBeenCalledWith({
      organizationId: baseOptions.organizationId,
      projectId: baseOptions.projectId,
      agentSessionId: baseOptions.agentSessionId,
      cliReadRequestDto: {
        operation: "run.skills.list",
        runId: baseOptions.runId,
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      },
    });
    expect(JSON.stringify(mocks.read.mock.calls[0])).not.toContain("/private/");
  });

  it("distinguishes an empty catalog from a discovery failure", async () => {
    resolveRead(makeResult({ skills: [], errors: [] }));
    const { result, rerender } = renderHook(
      ({ reloadKey }: { reloadKey: number }) =>
        useAgentSkillsCatalog({ ...baseOptions, runId: `run-${reloadKey}` }),
      { initialProps: { reloadKey: 1 } }
    );

    await waitFor(() => expect(result.current.state.status).toBe("empty"));

    resolveRead(
      makeResult({
        skills: [],
        errors: [
          {
            provider: "codex",
            message: "The repo Skill directory is unreadable.",
          },
        ],
      })
    );
    rerender({ reloadKey: 2 });

    await waitFor(() =>
      expect(result.current.state.status).toBe("discovery-error")
    );
    expect(result.current.state).toEqual({
      status: "discovery-error",
      errors: [
        {
          provider: "codex",
          message: "The repo Skill directory is unreadable.",
        },
      ],
    });
  });

  it("reports a denied or unavailable bridge without fabricating an empty catalog", async () => {
    mocks.authorize.mockResolvedValue({
      outcome: "DENIED",
      reason: "MACHINE_NOT_READY",
      retryable: true,
    });

    const { result } = renderHook(() => useAgentSkillsCatalog(baseOptions));

    await waitFor(() =>
      expect(result.current.state.status).toBe("bridge-unavailable")
    );
    expect(result.current.state).toEqual({
      status: "bridge-unavailable",
      message: "Controller authorization denied: MACHINE_NOT_READY",
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("reloads the catalog through a fresh authorization read", async () => {
    resolveRead(makeResult());
    const { result } = renderHook(() => useAgentSkillsCatalog(baseOptions));

    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    act(() => result.current.reload());
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  });
});

describe("pre-conversation catalogs", () => {
  const options = {
    enabled: true,
    organizationId: "org-1",
    projectId: "project-1",
    machineId: "machine-1",
    provider: "codex" as const,
    catalogContext: { policy: "non_repository" as const },
  };
  const response = (name: string) => ({
    data: {
      data: {
        operation: "workspace.skills.list",
        requestId: "request-1",
        status: "success",
        result: {
          provider: "codex",
          skills: [makeEntry({ name, catalogScope: "user" })],
          errors: [],
        },
      },
    },
  });
  it("uses the selected machine and existing read approval without a session or Service", async () => {
    mocks.workspaceRead.mockResolvedValue(response("personal"));
    const { result } = renderHook(() => useAgentSkillsCatalog(options));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          actionType: "CLI_READ",
          targetKind: "CLI_READ",
          targetId: "machine-1",
          provider: "codex",
          catalogContext: { policy: "non_repository" },
        }),
      })
    );
    expect(mocks.workspaceRead).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      machineId: "machine-1",
      cliReadWorkspaceSkillsListRequest: {
        operation: "workspace.skills.list",
        provider: "codex",
        catalogContext: { policy: "non_repository" },
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      },
    });
  });
  it("ignores an obsolete catalog after an explicit Service change", async () => {
    let finish: ((value: ReturnType<typeof response>) => void) | undefined;
    mocks.workspaceRead
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValue(response("repository"));
    const { result, rerender } = renderHook(
      ({ serviceId }: { serviceId: string | null }) =>
        useAgentSkillsCatalog({
          ...options,
          catalogContext: serviceId
            ? { policy: "service_workspace", serviceId }
            : { policy: "non_repository" },
        }),
      { initialProps: { serviceId: null as string | null } }
    );
    await waitFor(() => expect(mocks.workspaceRead).toHaveBeenCalledTimes(1));
    rerender({ serviceId: "service-1" });
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(async () => {
      finish?.(response("obsolete"));
    });
    expect(result.current.state).toMatchObject({
      status: "ready",
      catalog: { skills: [{ name: "repository" }] },
    });
    expect(mocks.workspaceRead).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cliReadWorkspaceSkillsListRequest: expect.objectContaining({
          catalogContext: {
            policy: "service_workspace",
            serviceId: "service-1",
          },
        }),
      })
    );
  });
  it.each(["CATALOG_BUSY", "TIMEOUT", "PROVIDER_FAILURE"] as const)(
    "preserves %s and allows retry",
    async (code) => {
      mocks.workspaceRead
        .mockResolvedValueOnce({
          data: {
            data: {
              operation: "workspace.skills.list",
              requestId: "request-1",
              status: "error",
              error: { code, message: "Try again" },
            },
          },
        })
        .mockResolvedValue(response("retried"));
      const { result } = renderHook(() => useAgentSkillsCatalog(options));
      await waitFor(() =>
        expect(result.current.state).toEqual({
          status: "read-error",
          code,
          message: "Try again",
          retryable: true,
        })
      );
      act(() => result.current.reload());
      await waitFor(() => expect(result.current.state.status).toBe("ready"));
    }
  );
});

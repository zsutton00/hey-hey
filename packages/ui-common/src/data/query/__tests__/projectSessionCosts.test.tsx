import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectSessionCosts } from "../../hooks/useProjectSessionCosts";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  machines: vi.fn(),
  costs: vi.fn(),
}));
vi.mock("../../../clients", () => ({
  dataClient: { request: mocks.readSession },
  machinesClient: { listMachines: mocks.machines },
  agentSessionsClient: { readAgentSessionCliState: mocks.costs },
}));
vi.mock("../../hooks/useControllerAuthorizedAction", () => ({
  executeControllerAuthorizedAction: async ({
    submit,
  }: {
    submit: (input: {
      authorization: { kind: "bounded_grant"; grantId: string };
    }) => Promise<unknown>;
  }) => ({
    outcome: "ADMITTED",
    data: await submit({
      authorization: { kind: "bounded_grant", grantId: "grant" },
    }),
  }),
}));

describe("project session costs query integration", () => {
  it("shares the authorized read, keeps cursor variants separate, and exposes typed failure", async () => {
    mocks.readSession.mockResolvedValue({
      data: { data: { machineId: "machine" } },
    });
    mocks.machines.mockResolvedValue({
      data: { data: { machines: [{ machineId: "machine" }] } },
    });
    let request = 0;
    mocks.costs.mockImplementation(({ cliReadRequestDto }) =>
      Promise.resolve({
        data: {
          data: {
            requestId: `request-${++request}`,
            operation: "project.session_costs.list",
            status: "success",
            result: {
              items: [],
              nextCursor: cliReadRequestDto.cursor === null ? "next" : null,
              sourceAvailability: "available",
              costReadAt: "2026-01-01T00:00:00Z",
            },
          },
        },
      })
    );
    const { result, rerender } = renderHook(
      ({ projectId }) => [
        useProjectSessionCosts("org", projectId, "session"),
        useProjectSessionCosts("org", projectId, "session"),
      ],
      { initialProps: { projectId: "project" } }
    );
    await waitFor(() => expect(result.current[0].result).not.toBeNull());
    expect(mocks.costs).toHaveBeenCalledTimes(1);
    expect(mocks.readSession).toHaveBeenCalledTimes(1);
    expect(result.current[1].hasNextPage).toBe(true);
    act(() => {
      result.current[0].loadNextPage();
      result.current[1].loadNextPage();
    });
    await waitFor(() => expect(result.current[0].hasNextPage).toBe(false));
    expect(mocks.costs).toHaveBeenCalledTimes(2);
    expect(mocks.costs.mock.calls[1][0].cliReadRequestDto).toMatchObject({
      cursor: "next",
      authorization: { kind: "bounded_grant", grantId: "grant" },
    });
    mocks.costs.mockResolvedValue({
      data: {
        data: {
          requestId: "failure",
          operation: "project.session_costs.list",
          status: "error",
          error: { code: "UNAVAILABLE", message: "Costs unavailable" },
        },
      },
    });
    rerender({ projectId: "other" });
    expect(result.current[0].result).toBeNull();
    await waitFor(() =>
      expect(result.current[0].typedError?.message).toBe("Costs unavailable")
    );
    expect(result.current[0].requestError).toBeNull();
  });
});

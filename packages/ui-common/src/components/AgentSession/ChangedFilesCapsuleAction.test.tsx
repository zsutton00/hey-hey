import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unifiedApiClient } from "../../clients/serviceClients";
import { SessionChangedFilesCapsuleAction } from "./ChangedFilesCapsuleAction";

const { authorize, session, pairedMachines } = vi.hoisted(() => ({
  authorize: vi.fn(),
  session: { agentSession: { machineId: "machine-1" }, refetch: vi.fn() },
  pairedMachines: {
    machines: [
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

vi.mock("../../clients/serviceClients", () => ({
  unifiedApiClient: { readAgentSessionCliState: vi.fn() },
}));
vi.mock("../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => session,
}));
vi.mock("../../data/hooks/useAgentSessionCurrentState", () => ({
  useAgentSessionCurrentState: () => ({ currentState: undefined }),
}));
vi.mock("../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => pairedMachines,
}));
vi.mock("../../data/hooks/useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({ mutate: authorize }),
}));
vi.mock("../ActionsCapsule/CapsuleAction", () => ({
  CapsuleAction: ({
    id,
    label,
    onClick,
  }: {
    id: string;
    label: string;
    onClick: () => void;
  }) => (
    <button data-testid={`capsule-action-${id}`} onClick={onClick}>
      {label}
    </button>
  ),
}));
vi.mock("./CollatedFileDiffModal/CollatedFileDiffModalContainer", () => ({
  CollatedFileDiffModalContainer: ({ open }: { open: boolean }) =>
    open ? <div data-testid="diff-viewer" /> : null,
}));

const read = vi.mocked(unifiedApiClient.readAgentSessionCliState);
const params = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  agentSessionId: "33333333-3333-4333-8333-333333333333",
  runId: "33333333-3333-4333-8333-333333333333",
  canonicalCurrentState: undefined,
  order: 100,
};

const countResponse = (changedFilesCount: number) =>
  ({
    data: {
      success: true,
      message: "ok",
      timestamp: new Date().toISOString(),
      statusCode: 200,
      data: {
        requestId: "44444444-4444-4444-8444-444444444444",
        operation: "run.changed_files.count",
        status: "success",
        result: { runId: params.runId, changedFilesCount },
      },
    },
  }) as Awaited<ReturnType<typeof read>>;

describe("SessionChangedFilesCapsuleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockImplementation(async ({ submit }) => ({
      outcome: "ADMITTED",
      data: await submit({
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      }),
    }));
  });

  it("shows the Run's changed-file count and opens the diff viewer", async () => {
    read.mockResolvedValue(countResponse(3));

    render(<SessionChangedFilesCapsuleAction {...params} enabled />);

    const action = await screen.findByTestId("capsule-action-view-diffs");
    expect(action).toHaveTextContent("3 files");
    expect(screen.queryByTestId("diff-viewer")).toBeNull();

    fireEvent.click(action);

    expect(screen.getByTestId("diff-viewer")).toBeInTheDocument();
  });

  it("shows nothing and reads nothing while disabled", async () => {
    render(<SessionChangedFilesCapsuleAction {...params} enabled={false} />);

    await waitFor(() => expect(authorize).not.toHaveBeenCalled());
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByTestId("capsule-action-view-diffs")).toBeNull();
  });

  it("shows the unavailable Files entry when the count cannot be read", async () => {
    read.mockRejectedValue(new Error("boom"));

    render(<SessionChangedFilesCapsuleAction {...params} enabled />);

    expect(
      await screen.findByTestId("capsule-action-view-diffs"),
    ).toHaveTextContent("Files");
  });
});

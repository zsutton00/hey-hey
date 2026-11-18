import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { unifiedApiClient } from "../../clients/serviceClients";
import { LocalPromptType } from "../../api";
import { SessionChangedFilesCapsuleActions } from "./ChangedFilesCapsuleAction";
import { submitPromptForRun } from "./runtime/hooks/usePromptRunSubmission";

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
vi.mock("./runtime/hooks/usePromptRunSubmission", () => ({
  submitPromptForRun: vi.fn(),
}));
vi.mock("./FollowupActionModal", () => ({
  FollowupActionModal: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onSubmit: (submission: unknown) => void;
  }) =>
    open ? (
      <button
        data-testid="commit-modal-submit"
        onClick={() =>
          onSubmit({
            additionalInstructions: "only docs",
            provider: "claude",
            model: "opus",
            reasoningEffort: "high",
            fastMode: true,
          })
        }
      />
    ) : null,
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
  commitOrder: 30,
  commit: {
    runId: "33333333-3333-4333-8333-333333333333",
    providerRunId: "provider-run-1",
    provider: "claude" as const,
    organizationId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    agentSessionId: "33333333-3333-4333-8333-333333333333",
    conversationId: "55555555-5555-4555-8555-555555555555",
    interactionAccess: {
      isDeviceEnabled: true,
      interactions: {},
    } as never,
    catalogSource: null,
  },
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

describe("SessionChangedFilesCapsuleActions", () => {
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

    render(<SessionChangedFilesCapsuleActions {...params} enabled />);

    const action = await screen.findByTestId("capsule-action-view-diffs");
    expect(action).toHaveTextContent("3 files");
    expect(screen.queryByTestId("diff-viewer")).toBeNull();

    fireEvent.click(action);

    expect(screen.getByTestId("diff-viewer")).toBeInTheDocument();
  });

  it("shows nothing and reads nothing while disabled", async () => {
    render(<SessionChangedFilesCapsuleActions {...params} enabled={false} />);

    await waitFor(() => expect(authorize).not.toHaveBeenCalled());
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByTestId("capsule-action-view-diffs")).toBeNull();
  });

  it("shows the unavailable Files entry when the count cannot be read", async () => {
    read.mockRejectedValue(new Error("boom"));

    render(<SessionChangedFilesCapsuleActions {...params} enabled />);

    expect(
      await screen.findByTestId("capsule-action-view-diffs"),
    ).toHaveTextContent("Files");
  });

  it("shows no Commit while nothing is reported or no Service is in scope", async () => {
    read.mockResolvedValue(countResponse(0));
    const { unmount } = render(
      <SessionChangedFilesCapsuleActions {...params} enabled />,
    );

    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.queryByTestId("capsule-action-commit")).toBeNull();
    unmount();

    vi.clearAllMocks();
    read.mockResolvedValue(countResponse(2));
    render(<SessionChangedFilesCapsuleActions {...params} enabled={false} />);
    await waitFor(() => expect(authorize).not.toHaveBeenCalled());
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByTestId("capsule-action-commit")).toBeNull();
  });

  it("shows Commit with the count and hides it when the count cannot be read", async () => {
    read.mockResolvedValueOnce(countResponse(2));
    const { unmount } = render(
      <SessionChangedFilesCapsuleActions {...params} enabled />,
    );
    expect(await screen.findByTestId("capsule-action-commit")).toBeEnabled();
    expect(screen.getByTestId("capsule-action-view-diffs")).toHaveTextContent(
      "2 files",
    );
    unmount();

    read.mockRejectedValue(new Error("boom"));
    render(<SessionChangedFilesCapsuleActions {...params} enabled />);
    await screen.findByTestId("capsule-action-view-diffs");
    expect(screen.queryByTestId("capsule-action-commit")).toBeNull();
  });

  it("submits one commit follow-up with the selected model, effort and Fast mode", async () => {
    read.mockResolvedValue(countResponse(1));
    vi.mocked(submitPromptForRun).mockResolvedValue({
      telemetry: undefined,
    } as never);
    render(<SessionChangedFilesCapsuleActions {...params} enabled />);

    fireEvent.click(await screen.findByTestId("capsule-action-commit"));
    fireEvent.click(screen.getByTestId("commit-modal-submit"));

    await waitFor(() => expect(submitPromptForRun).toHaveBeenCalledTimes(1));
    expect(submitPromptForRun).toHaveBeenCalledWith(
      expect.objectContaining({
        localPromptType: LocalPromptType.Commit,
        promptDraft: "only docs",
        agentOverride: {
          provider: "claude",
          model: "opus",
          reasoningEffort: "high",
          fastMode: true,
        },
      }),
    );
  });
});

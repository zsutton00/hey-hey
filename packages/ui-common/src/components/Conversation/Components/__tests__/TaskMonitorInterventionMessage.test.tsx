import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskMonitorInterventionSystemMessageData } from "../../../../api";
import { TaskMonitorInterventionMessage } from "../TaskMonitorInterventionMessage";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  refetchConversation: vi.fn(),
  refetchMessages: vi.fn(),
}));

vi.mock("../ConversationContext", () => ({
  useConversationContext: () => ({
    activeConversation: { id: "conversation-1" },
    project: { id: "project-1", organizationId: "organization-1" },
    taskMonitorId: "55555555-5555-4555-8555-555555555555",
    isReadOnly: false,
  }),
}));

vi.mock("../../../../data/hooks/useSubmitTaskMonitorCommand", () => ({
  useSubmitTaskMonitorCommand: () => ({
    mutate: mocks.mutate,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("../../../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: () => ({ refetch: mocks.refetchMessages }),
}));

vi.mock("../../../../data/hooks/useConversation", () => ({
  useConversation: () => ({ refetch: mocks.refetchConversation }),
}));

const createIntervention = (
  overrides: Partial<TaskMonitorInterventionSystemMessageData> = {}
): TaskMonitorInterventionSystemMessageData => ({
  type: "TASK_MONITOR_INTERVENTION",
  response: "An exact action requires a human decision.",
  agentIdentity: "task-monitor-coordinator",
  interventionId: "22222222-2222-4222-8222-222222222222",
  providerActionId: "provider-action-1",
  runId: "33333333-3333-4333-8333-333333333333",
  agentSessionId: "44444444-4444-4444-8444-444444444444",
  action: "Delete the production deployment",
  target: "Production deployment `api-service`",
  fingerprint: "immutable-fingerprint",
  createdAt: "2026-08-10T00:00:00.000Z",
  expiresAt: "2099-08-10T01:00:00.000Z",
  choices: new Set(["APPROVE", "DENY"]),
  ...overrides,
});

describe("TaskMonitorInterventionMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refetchConversation.mockResolvedValue({});
    mocks.refetchMessages.mockResolvedValue([]);
  });

  it("renders only the generated approve and deny choices", () => {
    render(<TaskMonitorInterventionMessage data={createIntervention()} />);

    expect(
      screen.getByText("An exact action requires a human decision.")
    ).toBeVisible();
    expect(screen.getByText("Delete the production deployment")).toBeVisible();
    expect(screen.getByText(/Production deployment/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("reuses the complete request after an uncertain delivery failure", async () => {
    mocks.mutate
      .mockRejectedValueOnce(new Error("Network response was lost."))
      .mockResolvedValueOnce({ status: "ADMITTED", replayed: true });
    render(<TaskMonitorInterventionMessage data={createIntervention()} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText("Network response was lost.");
    fireEvent.click(screen.getByRole("button", { name: "Retry approve" }));

    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
    const firstRequest = mocks.mutate.mock.calls[0][0].request;
    const retryRequest = mocks.mutate.mock.calls[1][0].request;
    expect(retryRequest).toBe(firstRequest);
    expect(firstRequest.command).toMatchObject({
      cause: "HUMAN_DECISION",
      interventionId: "22222222-2222-4222-8222-222222222222",
      providerActionId: "provider-action-1",
      runId: "33333333-3333-4333-8333-333333333333",
      agentSessionId: "44444444-4444-4444-8444-444444444444",
      fingerprint: "immutable-fingerprint",
      resolution: "APPROVE",
    });
    expect(firstRequest.command).not.toHaveProperty("human");
  });

  it("allows either decision after a failed attempt and retains each retry identity", async () => {
    mocks.mutate.mockRejectedValue(new Error("Network response was lost."));
    render(<TaskMonitorInterventionMessage data={createIntervention()} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText("Network response was lost.");
    const approveRequest = mocks.mutate.mock.calls[0][0].request;

    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
    const denyRequest = mocks.mutate.mock.calls[1][0].request;
    expect(denyRequest).not.toBe(approveRequest);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(3));
    expect(mocks.mutate.mock.calls[2][0].request).toBe(approveRequest);
  });

  it("refetches canonical messages after an admitted acknowledgement", async () => {
    mocks.mutate.mockResolvedValue({ status: "ADMITTED", replayed: false });
    render(<TaskMonitorInterventionMessage data={createIntervention()} />);

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    await waitFor(() => {
      expect(mocks.refetchConversation).toHaveBeenCalledTimes(1);
      expect(mocks.refetchMessages).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.getByTestId("task-monitor-intervention-message")
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry deny" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
    expect(mocks.mutate.mock.calls[1][0].request).toBe(
      mocks.mutate.mock.calls[0][0].request
    );
  });

  it("refetches and displays a rejected acknowledgement", async () => {
    mocks.mutate.mockResolvedValue({
      status: "REJECTED",
      message: "The intervention has expired.",
      replayed: false,
    });
    render(<TaskMonitorInterventionMessage data={createIntervention()} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByText("The intervention has expired.")).toBeVisible();
    expect(mocks.refetchConversation).toHaveBeenCalledTimes(1);
    expect(mocks.refetchMessages).toHaveBeenCalledTimes(1);
  });

  it("leaves expiry admission to the canonical Task Monitor state", () => {
    render(
      <TaskMonitorInterventionMessage
        data={createIntervention({ expiresAt: "2020-01-01T00:00:00.000Z" })}
      />
    );

    expect(screen.getByText("Action required")).toBeVisible();
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();
  });

  it("replaces retry state when canonical data identifies a new intervention", async () => {
    mocks.mutate.mockRejectedValue(new Error("Network response was lost."));
    const { rerender } = render(
      <TaskMonitorInterventionMessage data={createIntervention()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByRole("button", { name: "Retry approve" });

    rerender(
      <TaskMonitorInterventionMessage
        data={createIntervention({
          interventionId: "66666666-6666-4666-8666-666666666666",
          action: "Publish the production deployment",
        })}
      />
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled()
    );
    expect(screen.getByText("Publish the production deployment")).toBeVisible();
    expect(screen.queryByText("Network response was lost.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(2));
    expect(mocks.mutate.mock.calls[1][0].request).not.toBe(
      mocks.mutate.mock.calls[0][0].request
    );
    expect(mocks.mutate.mock.calls[1][0].request.command.interventionId).toBe(
      "66666666-6666-4666-8666-666666666666"
    );
  });

  it("does not show a late delivery error on a replacement intervention", async () => {
    let rejectDelivery: (reason: Error) => void = () => undefined;
    mocks.mutate.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectDelivery = reject;
        })
    );
    const { rerender } = render(
      <TaskMonitorInterventionMessage data={createIntervention()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    rerender(
      <TaskMonitorInterventionMessage
        data={createIntervention({
          interventionId: "66666666-6666-4666-8666-666666666666",
          action: "Publish the production deployment",
        })}
      />
    );
    rejectDelivery(new Error("The old decision failed."));

    await waitFor(() =>
      expect(screen.getByText("Publish the production deployment")).toBeVisible()
    );
    expect(screen.queryByText("The old decision failed.")).not.toBeInTheDocument();
  });
});

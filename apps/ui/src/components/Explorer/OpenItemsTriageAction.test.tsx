import { ModalRestoreControls } from "@hey-hey/ui-common/components/Modals";
import { useEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenItemsTriageReviewBinding } from "../../pages/AgentSession/OpenItemsTriagePage";
import { OpenItemsTriageAction } from "./OpenItemsTriageAction";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  stop: vi.fn(),
  agentSession: undefined as unknown,
  agentSessionError: null as unknown,
  bindings: new Map<string, OpenItemsTriageReviewBinding>(),
}));
vi.mock("@hey-hey/ui-common/data", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/data")>()),
  useOpenItemsTriageSession: () => ({
    mutate: mocks.mutate,
    isPending: false,
  }),
  useAgentSession: () => ({
    agentSession: mocks.agentSession,
    error: mocks.agentSessionError,
  }),
}));
vi.mock("../../pages/AgentSession/OpenItemsTriagePage", () => ({
  OpenItemsTriagePage: ({
    agentSession,
    pageIdentity,
    preview,
    onClose,
    review,
  }: {
    agentSession: { id: string };
    pageIdentity?: string;
    preview?: boolean;
    onClose?: () => void;
    review: OpenItemsTriageReviewBinding;
  }) => {
    mocks.bindings.set(agentSession.id, review);
    const { registerStop } = review;
    useEffect(() => {
      registerStop(mocks.stop);
      return () => registerStop(null);
    }, [registerStop]);
    return (
      <div
        data-testid="triage-page"
        data-session={agentSession.id}
        data-identity={pageIdentity}
        data-preview={String(Boolean(preview))}
        data-requests={review.requestMessageIds.join(",")}
        data-mode={review.options.mode}
        data-guidance={review.options.guidance}
      >
        <h2 id="open-items-triage-title">Open Items triage</h2>
        <button data-testid="mock-page-close" onClick={onClose}>
          Close triage
        </button>
        {review.closeGate}
        <button
          data-testid="sim-launch-failed"
          onClick={() => review.onLaunchFailed("Launch rejected")}
        />
        <button data-testid="sim-run-again" onClick={review.onRunAgain} />
        <button
          data-testid="sim-submitted"
          onClick={() => review.onFreshPassSubmitted("fresh")}
        />
        <button
          data-testid="sim-running"
          onClick={() => review.onActivity("running", true)}
        />
        <button
          data-testid="sim-finished-unseen"
          onClick={() => review.onActivity("running", false)}
        />
        <button
          data-testid="sim-results"
          onClick={() => review.onActivity("results", false)}
        />
      </div>
    );
  },
}));

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}
const mount = () => {
  const onHeaderClick = vi.fn();
  render(
    <MemoryRouter initialEntries={["/projects/project-1/tasks/t"]}>
      <div data-testid="header" onClick={onHeaderClick}>
        <OpenItemsTriageAction organizationId="org-1" projectId="project-1" />
      </div>
      <Location />
      <ModalRestoreControls />
    </MemoryRouter>,
  );
  return { onHeaderClick };
};
const open = () =>
  userEvent.click(screen.getByTestId("open-items-triage-action"));
const tidyUp = async () =>
  userEvent.click(await screen.findByTestId("triage-start-tidy-up"));
const run = async (guidance?: string) => {
  if (guidance)
    await userEvent.type(
      await screen.findByTestId("triage-start-guidance-input"),
      guidance,
    );
  await tidyUp();
  return screen.findByTestId("triage-page");
};
const click = (testId: string) => userEvent.click(screen.getByTestId(testId));
const expectClosed = () =>
  waitFor(() =>
    expect(screen.queryByTestId("preview-modal")).not.toBeInTheDocument(),
  );
const atResults = async () => {
  await open();
  await run();
  await click("sim-submitted");
  await click("sim-running");
  await click("sim-results");
};
const atProgress = async () => {
  await open();
  await run();
  await click("sim-submitted");
  await click("sim-running");
};
const backdrop = () =>
  document.querySelector(".MuiBackdrop-root") as HTMLElement;

describe("Open Items triage modal", () => {
  it("replaces a failed launch with retry, creates fresh reviews and ignores abandoned callbacks", async () => {
    mount();
    await open();
    await userEvent.type(
      await screen.findByTestId("triage-start-guidance-input"),
      "Focus on stale bugs",
    );
    await userEvent.click(
      await screen.findByTestId("triage-start-spring-cleaning"),
    );
    await screen.findByTestId("triage-page");
    await click("sim-submitted");
    const abandoned = mocks.bindings.get("session")!;
    await click("sim-launch-failed");
    expect(
      await screen.findByTestId("open-items-triage-session-error"),
    ).toHaveTextContent("Launch rejected");
    expect(screen.queryByTestId("triage-page")).toBeNull();
    mocks.mutate.mockImplementationOnce(async () => {
      mocks.agentSession = {
        id: "retry-session",
        conversationId: "retry-conversation",
      };
      return {
        agentSessionId: "retry-session",
        conversationId: "retry-conversation",
      };
    });
    await click("triage-launch-retry");
    expect(await screen.findByTestId("triage-page")).toHaveAttribute(
      "data-session",
      "retry-session",
    );
    // Try again reuses the mode and guidance the review started with.
    expect(screen.getByTestId("triage-page")).toHaveAttribute(
      "data-mode",
      "springCleaning",
    );
    expect(screen.getByTestId("triage-page")).toHaveAttribute(
      "data-guidance",
      "Focus on stale bugs",
    );
    await click("sim-submitted");
    act(() => {
      abandoned.onFreshPassSubmitted("old-request");
      abandoned.onActivity("running", true);
      abandoned.onLaunchFailed("Late failure");
    });
    expect(screen.getByTestId("triage-page")).toHaveAttribute(
      "data-requests",
      "fresh",
    );
    expect(screen.queryByTestId("open-items-triage-session-error")).toBeNull();
    await click("sim-results");
    mocks.mutate.mockImplementationOnce(async () => {
      mocks.agentSession = {
        id: "again-session",
        conversationId: "again-conversation",
      };
      return {
        agentSessionId: "again-session",
        conversationId: "again-conversation",
      };
    });
    await click("sim-run-again");
    expect(await screen.findByTestId("triage-page")).toHaveAttribute(
      "data-session",
      "again-session",
    );
    expect(screen.getByTestId("triage-page")).toHaveAttribute(
      "data-requests",
      "",
    );
    // Run Again does too, without the user re-entering anything.
    expect(screen.getByTestId("triage-page")).toHaveAttribute(
      "data-mode",
      "springCleaning",
    );
    expect(screen.getByTestId("triage-page")).toHaveAttribute(
      "data-guidance",
      "Focus on stale bugs",
    );
    expect(mocks.mutate).toHaveBeenCalledTimes(3);
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/tasks/t",
    );
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentSession = { id: "session", conversationId: "conversation" };
    mocks.agentSessionError = null;
    mocks.mutate.mockResolvedValue({
      agentSessionId: "session",
      conversationId: "conversation",
      created: false,
    });
    mocks.stop.mockResolvedValue({ ok: true });
  });

  it("opens at help without resolving the session or requesting suggestions", async () => {
    const { onHeaderClick } = mount();
    await open();
    const help = await screen.findByTestId("open-items-triage-help");
    expect(help).toHaveTextContent("Run an agent to tidy up your Open Items.");
    expect(help).toHaveTextContent("Removes items you no longer need");
    expect(help).toHaveTextContent("Groups related items together");
    expect(help).toHaveTextContent("Tracks ongoing work on a Goal");
    const dialog = screen.getByRole("dialog", { name: "Open Items triage" });
    expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining("Run an agent to tidy up your Open Items."),
    );
    expect(dialog).toHaveStyle({ width: "440px" });
    expect(screen.getByTestId("triage-start-guidance-input")).toHaveValue("");
    expect(screen.getByTestId("triage-start-tidy-up")).toHaveTextContent(
      "Tidy up",
    );
    expect(
      screen.getByTestId("triage-start-spring-cleaning"),
    ).toHaveTextContent("Spring cleaning");
    expect(screen.queryByTestId("open-items-triage-run")).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("triage-page")).toBeNull();
    expect(screen.queryByTestId("preview-modal-close")).toBeNull();
    expect(onHeaderClick).not.toHaveBeenCalled();
  });

  it("Tidy up starts a review in that mode carrying the typed guidance", async () => {
    mount();
    await open();
    const page = await run("Keep anything about billing");
    expect(page).toHaveAttribute("data-mode", "tidyUp");
    expect(page).toHaveAttribute(
      "data-guidance",
      "Keep anything about billing",
    );
  });

  it("Spring cleaning starts a review in that mode without any guidance", async () => {
    mount();
    await open();
    await userEvent.click(
      await screen.findByTestId("triage-start-spring-cleaning"),
    );
    const page = await screen.findByTestId("triage-page");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(page).toHaveAttribute("data-mode", "springCleaning");
    expect(page).toHaveAttribute("data-guidance", "");
  });

  it("Run resolves the session and mounts the observational, interactive review in place", async () => {
    mount();
    await open();
    const page = await run();
    expect(mocks.mutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(page).toHaveAttribute("data-session", "session");
    expect(page).toHaveAttribute("data-identity", "observational");
    expect(page).toHaveAttribute("data-preview", "false");
    expect(page).toHaveAttribute("data-requests", "");
    expect(
      screen.getByRole("dialog", { name: "Open Items triage" }),
    ).toHaveStyle({ width: "720px" });
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/tasks/t",
    );
  });

  it.each([
    ["close control", () => click("open-items-triage-close")],
    ["Escape", () => userEvent.keyboard("{Escape}")],
    ["backdrop", () => userEvent.click(backdrop())],
  ])("closes help directly from the %s", async (_path, dismiss) => {
    mount();
    await open();
    await screen.findByTestId("open-items-triage-help");
    await dismiss();
    await expectClosed();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  describe.each([
    ["close control", () => click("open-items-triage-close")],
    ["Escape", () => userEvent.keyboard("{Escape}")],
    ["backdrop", () => userEvent.click(backdrop())],
  ])("dismissing results from the %s", (_path, dismiss) => {
    it("warns, and Keep reviewing leaves the results intact", async () => {
      mount();
      await atResults();
      await dismiss();
      const gate = await screen.findByTestId("triage-confirm-discard");
      expect(gate).toHaveTextContent(
        "Closing triage will discard these results. You won’t be able to return to them. Changes you’ve already applied will remain.",
      );
      expect(screen.getByTestId("triage-close-confirm")).toHaveTextContent(
        "Discard and close",
      );
      await click("triage-close-keep");
      expect(screen.queryByTestId("triage-confirm-discard")).toBeNull();
      expect(screen.getByTestId("triage-page")).toHaveAttribute(
        "data-requests",
        "fresh",
      );
      expect(mocks.stop).not.toHaveBeenCalled();
    });

    it("Discard and close closes without stopping and keeps the route", async () => {
      mount();
      await atResults();
      await dismiss();
      await screen.findByTestId("triage-confirm-discard");
      await click("triage-close-confirm");
      await expectClosed();
      expect(mocks.stop).not.toHaveBeenCalled();
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/projects/project-1/tasks/t",
      );
    });
  });

  describe.each([
    ["close control", () => click("open-items-triage-close")],
    ["Escape", () => userEvent.keyboard("{Escape}")],
    ["backdrop", () => userEvent.click(backdrop())],
  ])("dismissing progress from the %s", (_path, dismiss) => {
    it("asks first, and declining leaves the run running", async () => {
      mount();
      await atProgress();
      await dismiss();
      expect(
        await screen.findByTestId("triage-confirm-cancel"),
      ).toHaveTextContent("Closing will cancel this run");
      await click("triage-close-keep");
      expect(screen.queryByTestId("triage-confirm-cancel")).toBeNull();
      expect(screen.getByTestId("triage-page")).toBeInTheDocument();
      expect(mocks.stop).not.toHaveBeenCalled();
    });

    it("confirming stops the run and closes once it is no longer active", async () => {
      mount();
      await atProgress();
      await dismiss();
      await screen.findByTestId("triage-confirm-cancel");
      await click("triage-close-confirm");
      expect(mocks.stop).toHaveBeenCalledTimes(1);
      expect(await screen.findByTestId("triage-stopping")).toBeInTheDocument();
      // Further dismissal is ignored while stopping.
      await userEvent.keyboard("{Escape}");
      expect(screen.getByTestId("triage-stopping")).toBeInTheDocument();
      await click("sim-results");
      await expectClosed();
    });
  });

  it("keeps the modal open with a visible stop failure, then retries", async () => {
    mocks.stop.mockResolvedValueOnce({ ok: false, error: "Stop was denied" });
    mount();
    await atProgress();
    await click("open-items-triage-close");
    await click("triage-close-confirm");
    const failure = await screen.findByTestId("triage-stop-failed");
    expect(failure).toHaveTextContent("The run could not be cancelled");
    expect(failure).toHaveTextContent("Stop was denied");
    expect(screen.getByTestId("preview-modal")).toBeInTheDocument();
    expect(screen.getByTestId("header")).not.toContainElement(failure);
    await click("triage-close-confirm");
    expect(mocks.stop).toHaveBeenCalledTimes(2);
    await click("sim-results");
    await expectClosed();
  });

  it("closes on the no-op stop of a run that already finished", async () => {
    mount();
    await open();
    await run();
    await click("sim-submitted");
    await click("sim-finished-unseen");
    await click("open-items-triage-close");
    await click("triage-close-confirm");
    expect(mocks.stop).toHaveBeenCalledTimes(1);
    await expectClosed();
  });

  it("minimizes the same running review and warning without stopping, discarding or creating another session", async () => {
    mount();
    await open();
    await run();
    await click("sim-submitted");
    await click("sim-running");
    const page = screen.getByTestId("triage-page");
    const session = page.getAttribute("data-session");
    await click("modal-minimize");
    await click("open-items-triage-action");
    await waitFor(() => expect(page).toBeVisible());
    expect(screen.getByTestId("triage-page")).toBe(page);
    expect(page).toHaveAttribute("data-session", session);
    expect(mocks.mutate).toHaveBeenCalledOnce();
    expect(mocks.stop).not.toHaveBeenCalled();
    await click("open-items-triage-close");
    expect(screen.getByTestId("triage-confirm-cancel")).toBeVisible();
    await click("modal-minimize");
    await click("modal-restore");
    await waitFor(() =>
      expect(screen.getByTestId("triage-confirm-cancel")).toBeVisible(),
    );
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(mocks.mutate).toHaveBeenCalledOnce();
  });

  it("reopens at help with none of the closed review's state", async () => {
    mount();
    await atResults();
    await click("open-items-triage-close");
    await click("triage-close-confirm");
    await expectClosed();
    await open();
    expect(
      await screen.findByTestId("open-items-triage-help"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("triage-page")).toBeNull();
    expect(screen.getByTestId("triage-start-guidance-input")).toHaveValue("");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const page = await run();
    expect(page).toHaveAttribute("data-requests", "");
    expect(page).toHaveAttribute("data-guidance", "");
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
  });

  it("shows a resolution failure inside the modal and retries with Try again", async () => {
    mocks.mutate.mockRejectedValueOnce(new Error("Cannot resolve session"));
    const { onHeaderClick } = mount();
    await open();
    await tidyUp();
    const error = await screen.findByTestId("open-items-triage-session-error");
    expect(error).toHaveTextContent("Review could not start");
    expect(error).toHaveTextContent("Cannot resolve session");
    expect(
      screen.getByRole("dialog", { name: "Open Items triage" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("preview-modal-content")).toContainElement(error);
    expect(screen.getByTestId("header")).not.toContainElement(error);
    expect(onHeaderClick).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("triage-page")).toBeInTheDocument();
  });

  it("shows the titled header while the session loads", async () => {
    mocks.agentSession = undefined;
    mount();
    await open();
    await tidyUp();
    expect(
      await screen.findByTestId("open-items-triage-loading"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Open Items triage" }),
    ).toBeInTheDocument();
    await click("open-items-triage-close");
    await expectClosed();
  });

  it.each([
    [
      "a session fetch failure",
      () => {
        mocks.agentSession = undefined;
        mocks.agentSessionError = new Error("Session unavailable");
      },
      "Session unavailable",
    ],
    [
      "a session without a conversation",
      () => {
        mocks.agentSession = { id: "session", conversationId: null };
      },
      "The triage conversation is unavailable.",
    ],
  ])("shows %s inside the titled modal", async (_case, arrange, message) => {
    arrange();
    mount();
    await open();
    await tidyUp();
    expect(
      await screen.findByTestId("open-items-triage-session-error"),
    ).toHaveTextContent(message);
    expect(
      screen.getByRole("dialog", { name: "Open Items triage" }),
    ).toBeInTheDocument();
    await click("open-items-triage-close");
    await expectClosed();
  });
});

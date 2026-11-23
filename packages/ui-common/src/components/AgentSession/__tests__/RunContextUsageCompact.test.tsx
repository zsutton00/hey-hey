import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageResponseDto } from "../../../api";
import { useProviderUsage } from "../../../data/hooks/useProviderUsage";
import { RunContextUsageModal } from "../RunContextUsageModal";
import {
  COMPACTION_START_TIMEOUT_MS,
  useRunCompactionControl,
} from "../runtime/hooks/useRunCompactionControl";

const retry = vi.fn();
const useRunContextUsage = vi.fn();

vi.mock("../runtime/hooks/useRunContextUsage", () => ({
  useRunContextUsage: (params: unknown) => useRunContextUsage(params),
}));
vi.mock("../../../data/hooks/useProviderUsage", () => ({
  useProviderUsage: vi.fn(),
}));

const notice = (
  id: string,
  response: string,
  compaction: {
    phase: "queued" | "started" | "completed" | "failed";
    code?: string;
  },
): MessageResponseDto =>
  ({
    id,
    type: "SYSTEM",
    status: "COMPLETED",
    createdAt: "2026-11-22T00:00:00.000Z",
    data: {
      type: "AGENT",
      response,
      presentation: "notice",
      noticeSeverity: compaction.phase === "failed" ? "warning" : "info",
      compaction,
    },
  }) as unknown as MessageResponseDto;

const sessionMessage = (id: string, providerSessionId: string, label: string) =>
  ({
    id,
    type: "SYSTEM",
    status: "COMPLETED",
    createdAt: "2026-11-22T00:00:00.000Z",
    data: {
      type: "AGENT",
      response: "hi",
      providerSessionId,
      promptHandler: label,
    },
  }) as unknown as MessageResponseDto;

const Harness = ({
  messages,
  requestCompact,
}: {
  messages: MessageResponseDto[];
  requestCompact: () => Promise<void>;
}) => {
  const compaction = useRunCompactionControl({ messages, requestCompact });
  return (
    <RunContextUsageModal
      open
      onClose={vi.fn()}
      organizationId="org-1"
      projectId="project-1"
      agentSessionId="agent-session-1"
      runId="run-1"
      providerSessions={[
        { id: "session-1", label: "Planner" },
        { id: "session-2", label: "Implementation" },
      ]}
      provider="claude"
      compaction={compaction}
    />
  );
};

const status = () => screen.getByTestId("run-context-usage-compact-status");
const history = [
  sessionMessage("m1", "session-1", "Planner"),
  sessionMessage("m2", "session-2", "Implementation"),
  // An earlier compaction's notice must never settle a new request.
  notice("old-done", "Finished compact…", { phase: "completed" }),
];

beforeEach(() => {
  vi.mocked(useProviderUsage).mockReturnValue({
    providers: null,
    typedError: null,
    requestError: null,
    isInitialLoading: false,
  });
  useRunContextUsage.mockReset().mockReturnValue({
    status: "idle",
    data: null,
    error: null,
    errorCode: null,
    retry,
  });
  retry.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Compact from the Context modal", () => {
  it("moves through queued, compacting and finished, then reads the current session again", async () => {
    const requestCompact = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <Harness messages={history} requestCompact={requestCompact} />,
    );

    // Inspect a historical session first.
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Planner" }));

    await act(async () => {
      fireEvent.click(screen.getByTestId("run-context-usage-compact"));
    });
    expect(requestCompact).toHaveBeenCalledTimes(1);
    expect(status()).toHaveTextContent("Requesting compaction…");
    expect(screen.getByTestId("run-context-usage-compact")).toBeDisabled();

    const queued = [
      ...history,
      notice("q", "Compact queued until the current turn finishes", {
        phase: "queued",
      }),
    ];
    rerender(<Harness messages={queued} requestCompact={requestCompact} />);
    expect(status()).toHaveTextContent(
      "Waiting for the current turn to finish…",
    );

    const started = [
      ...queued,
      notice("s", "Starting compact…", { phase: "started" }),
    ];
    rerender(<Harness messages={started} requestCompact={requestCompact} />);
    expect(status()).toHaveTextContent("Compacting…");

    const done = [
      ...started,
      notice("d", "Finished compact…", { phase: "completed" }),
    ];
    rerender(<Harness messages={done} requestCompact={requestCompact} />);
    expect(status()).toHaveTextContent("Compaction finished");
    expect(retry).toHaveBeenCalled();
    expect(useRunContextUsage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: "run-1",
        providerSessionId: "session-2",
      }),
    );
  });

  it("shows the typed unsupported outcome", async () => {
    const requestCompact = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <Harness messages={history} requestCompact={requestCompact} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("run-context-usage-compact"));
    });
    rerender(
      <Harness
        messages={[
          ...history,
          notice("f", "Compact failed: No active runner supports compaction.", {
            phase: "failed",
            code: "NOT_SUPPORTED",
          }),
        ]}
        requestCompact={requestCompact}
      />,
    );
    expect(status()).toHaveTextContent(
      "This agent's provider doesn't support compaction.",
    );
    expect(screen.getByTestId("run-context-usage-compact")).toBeEnabled();
  });

  it("fails instead of staying pending when no compaction notice arrives", async () => {
    vi.useFakeTimers();
    const requestCompact = vi.fn().mockResolvedValue(undefined);
    render(<Harness messages={history} requestCompact={requestCompact} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("run-context-usage-compact"));
    });
    act(() => {
      vi.advanceTimersByTime(COMPACTION_START_TIMEOUT_MS);
    });
    expect(status()).toHaveTextContent(
      "Compaction didn't start. The agent may be disconnected.",
    );
  });

  it("shows a refused request immediately", async () => {
    const requestCompact = vi
      .fn()
      .mockRejectedValue(new Error("Controller authorization denied: EXPIRED"));
    render(<Harness messages={history} requestCompact={requestCompact} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("run-context-usage-compact"));
    });
    expect(status()).toHaveTextContent(
      "Controller authorization denied: EXPIRED",
    );
  });
});

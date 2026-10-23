import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SentAttachmentOpenProvider,
  useSentAttachmentOpenTarget,
} from "../SentAttachmentOpenContext";

const useAgentSession = vi.hoisted(() => vi.fn());
const useLocalCliForSession = vi.hoisted(() => vi.fn());

vi.mock("../../../../data/hooks/useAgentSession", () => ({ useAgentSession }));
vi.mock("../../../AgentSession/runtime/hooks/useLocalCliForSession", () => ({
  useLocalCliForSession,
}));

const ids = {
  organizationId: "org-1",
  projectId: "project-1",
  agentSessionId: "session-1",
  conversationId: "conversation-1",
};
const persistedSession = {
  id: ids.agentSessionId,
  organizationId: ids.organizationId,
  projectId: ids.projectId,
  conversationId: ids.conversationId,
  machineId: "machine-1",
  status: "RUNNING",
};

function Probe() {
  const target = useSentAttachmentOpenTarget();
  return (
    <output>{target ? `${target.runId}@${target.machineId}` : "none"}</output>
  );
}

const renderProvider = (
  agentSessionId: string | undefined = ids.agentSessionId,
) =>
  render(
    <SentAttachmentOpenProvider {...ids} agentSessionId={agentSessionId}>
      <Probe />
    </SentAttachmentOpenProvider>,
  );

describe("SentAttachmentOpenProvider", () => {
  beforeEach(() => {
    useAgentSession.mockReturnValue({
      agentSession: persistedSession,
      error: null,
    });
    useLocalCliForSession.mockReturnValue({
      status: "local",
      machineId: "machine-1",
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the Run and machine for a persisted session on the local machine", () => {
    renderProvider();

    expect(screen.getByRole("status")).toHaveTextContent("session-1@machine-1");
    expect(useLocalCliForSession).toHaveBeenCalledWith("machine-1");
  });

  it.each([
    ["checking", { status: "checking" }],
    ["unreachable", { status: "unavailable", reason: "cli-unreachable" }],
    [
      "a different machine",
      { status: "unavailable", reason: "different-machine" },
    ],
  ])("exposes no target while the local CLI is %s", (_name, state) => {
    useLocalCliForSession.mockReturnValue(state);

    renderProvider();

    expect(screen.getByRole("status")).toHaveTextContent("none");
  });

  it("exposes no target when the session is missing or failed to load", () => {
    useAgentSession.mockReturnValue({ agentSession: null, error: null });
    const { unmount } = renderProvider();
    expect(screen.getByRole("status")).toHaveTextContent("none");
    unmount();

    useAgentSession.mockReturnValue({
      agentSession: persistedSession,
      error: new Error("failed"),
    });
    renderProvider();
    expect(screen.getByRole("status")).toHaveTextContent("none");
  });

  it("exposes no target for a session of another conversation", () => {
    useAgentSession.mockReturnValue({
      agentSession: { ...persistedSession, conversationId: "other" },
      error: null,
    });

    renderProvider();

    expect(screen.getByRole("status")).toHaveTextContent("none");
  });

  it("exposes no target for a conversation without an agent session", () => {
    useAgentSession.mockReturnValue({ agentSession: null, error: null });
    useLocalCliForSession.mockReturnValue({
      status: "unavailable",
      reason: "no-session-machine",
    });

    renderProvider(undefined);

    expect(screen.getByRole("status")).toHaveTextContent("none");
    expect(useLocalCliForSession).toHaveBeenCalledWith(null);
  });
});

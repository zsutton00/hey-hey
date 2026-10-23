import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageByIdResolver } from "./MessageByIdResolver";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

const useMessageMock = vi.fn();
const useAgentSessionsMock = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useMessage: (...args: unknown[]) => useMessageMock(...args),
  useAgentSessions: (...args: unknown[]) => useAgentSessionsMock(...args),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  usePathService: () => ({
    agentSession: ({
      projectId,
      agentSessionId,
    }: {
      projectId: string;
      agentSessionId: string;
    }) => `/projects/${projectId}/resolve-agent-session-by-id/${agentSessionId}`,
    conversation: ({
      projectId,
      conversationId,
    }: {
      projectId: string;
      conversationId: string;
    }) => `/projects/${projectId}/conversations/${conversationId}`,
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

const renderResolver = (): void => {
  render(
    <MemoryRouter initialEntries={["/projects/proj-1/resolve-message/msg-1"]}>
      <Routes>
        <Route
          path="/projects/:projectId/resolve-message/:messageId"
          element={<MessageByIdResolver />}
        />
      </Routes>
    </MemoryRouter>,
  );
};

describe("MessageByIdResolver", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useMessageMock.mockReset();
    useAgentSessionsMock.mockReset();
  });

  it("redirects to the agent-session-by-id resolver when the conversation has an agent session", async () => {
    useMessageMock.mockReturnValue({
      data: { id: "msg-1", conversationId: "conv-1" },
      isLoading: false,
      isFetched: true,
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [{ id: "session-1" }],
      isFetched: true,
      isLoading: false,
    });

    renderResolver();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        "/projects/proj-1/resolve-agent-session-by-id/session-1",
        { replace: true },
      );
    });
  });

  it("redirects to the conversation route when no agent session exists", async () => {
    useMessageMock.mockReturnValue({
      data: { id: "msg-1", conversationId: "conv-1" },
      isLoading: false,
      isFetched: true,
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [],
      isFetched: true,
      isLoading: false,
    });

    renderResolver();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        "/projects/proj-1/conversations/conv-1",
        { replace: true },
      );
    });
  });

  it("does not navigate while the message is loading", () => {
    useMessageMock.mockReturnValue({
      data: null,
      isLoading: true,
      isFetched: false,
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [],
      isFetched: true,
      isLoading: false,
    });

    renderResolver();

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("does not report a missing session while the session lookup is unfetched", () => {
    useMessageMock.mockReturnValue({
      data: { id: "msg-1", conversationId: "conv-1" },
      isLoading: false,
      isFetched: true,
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [],
      isLoading: false,
      isFetched: false,
    });

    renderResolver();

    expect(screen.getByText("Loading message...")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

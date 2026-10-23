import { describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  type AgentSessionDto,
  type UpdateAgentSessionDto,
} from "../../../../../api";
import { updateAgentSessionRecord } from "../update-agent-session-record";

const createAgentSession = (
  status: AgentSessionDto["status"] = AgentSessionStatus.NotStarted
): AgentSessionDto => ({
  id: "session-123",
  organizationId: "org-456",
  userId: "user-789",
  initiativeId: "initiative-101",
  taskId: "task-202",
  designDocId: "doc-303",
  conversationId: "conv-404",
  startedAt: "2024-01-01T10:00:00Z",
  endedAt: "2024-01-01T11:00:00Z",
  duration: 3600,
  content: "Coding session content",
  status,
  createdAt: "2024-01-01T10:00:00Z",
  updatedAt: "2024-01-01T11:00:00Z",
});

describe("updateAgentSessionRecord", () => {
  it("supports status-only updates", async () => {
    const updateAgentSession = vi.fn(
      async (
        _organizationId: string,
        _projectId: string,
        _agentSessionId: string,
        payload: UpdateAgentSessionDto
      ) => ({
        data: createAgentSession(
          payload.status ?? AgentSessionStatus.NotStarted
        ),
      })
    );

    const result = await updateAgentSessionRecord(
      {
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        status: AgentSessionStatus.InProgress,
      },
      { updateAgentSession }
    );

    expect(updateAgentSession).toHaveBeenCalledWith(
      "org-1",
      "proj-1",
      "agent-session-1",
      {
        machineId: "machine-1",
        status: AgentSessionStatus.InProgress,
      }
    );
    expect(result).toEqual({
      ok: true,
      session: createAgentSession(AgentSessionStatus.InProgress),
    });
  });

  it("passes opencode through verbatim in the PATCH payload", async () => {
    const updateAgentSession = vi.fn(
      async (
        _organizationId: string,
        _projectId: string,
        _agentSessionId: string,
        _payload: UpdateAgentSessionDto
      ) => ({
        data: createAgentSession(),
      })
    );

    await updateAgentSessionRecord(
      {
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        provider: "opencode",
      },
      { updateAgentSession }
    );

    expect(updateAgentSession).toHaveBeenCalledWith(
      "org-1",
      "proj-1",
      "agent-session-1",
      { machineId: "machine-1", provider: "opencode" }
    );
  });

  it("forwards a V2 config payload verbatim", async () => {
    const updateAgentSession = vi.fn(
      async (
        _organizationId: string,
        _projectId: string,
        _agentSessionId: string,
        _payload: UpdateAgentSessionDto
      ) => ({
        data: createAgentSession(),
      })
    );

    await updateAgentSessionRecord(
      {
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        config: {
          version: "v2",
          method: "plan",
          model: "claude-opus-4-8",
          effort: "medium",
        },
      },
      { updateAgentSession }
    );

    expect(updateAgentSession).toHaveBeenCalledWith(
      "org-1",
      "proj-1",
      "agent-session-1",
      {
        machineId: "machine-1",
        config: {
          version: "v2",
          method: "plan",
          model: "claude-opus-4-8",
          effort: "medium",
        },
      }
    );
  });

  it("forwards a V2 config with effort and worktree omitted", async () => {
    const updateAgentSession = vi.fn(
      async (
        _organizationId: string,
        _projectId: string,
        _agentSessionId: string,
        _payload: UpdateAgentSessionDto
      ) => ({
        data: createAgentSession(),
      })
    );

    await updateAgentSessionRecord(
      {
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
        config: {
          version: "v2",
          method: "open",
          model: "gpt-5-codex",
        },
      },
      { updateAgentSession }
    );

    expect(updateAgentSession).toHaveBeenCalledWith(
      "org-1",
      "proj-1",
      "agent-session-1",
      {
        machineId: "machine-1",
        config: {
          version: "v2",
          method: "open",
          model: "gpt-5-codex",
        },
      }
    );
  });

  it("supports machine-only updates", async () => {
    const session = createAgentSession();
    const updateAgentSession = vi.fn(async () => ({ data: session }));

    const result = await updateAgentSessionRecord(
      {
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "agent-session-1",
        machineId: "machine-1",
      },
      {
        updateAgentSession,
      }
    );

    expect(updateAgentSession).toHaveBeenCalledWith(
      "org-1",
      "proj-1",
      "agent-session-1",
      { machineId: "machine-1" }
    );
    expect(result).toEqual({
      ok: true,
      session,
    });
  });
});

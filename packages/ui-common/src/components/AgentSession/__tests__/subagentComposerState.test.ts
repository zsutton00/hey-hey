import { describe, expect, it } from "vitest";
import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionDto,
} from "../../../api";
import {
  resolveSubagentReadiness,
  type SubagentReadinessInput,
} from "../subagentComposerState";
import type { AgentSessionInteractionAccess } from "../operations/AgentOperationCoordinator";

const session: AgentSessionDto = {
  id: "session",
  organizationId: "org",
  projectId: "project",
  conversationId: "conversation",
  machineId: "machine",
  userId: "user",
  status: AgentSessionStatus.Completed,
  currentState: AgentSessionCurrentState.Idle,
  type: AgentSessionType.EntityConversation,
  sessionDate: "2026-09-28",
  title: "Conversation",
  autoDecide: false,
  monitoringEnabled: false,
  hasUnsyncedChanges: false,
};
const access: AgentSessionInteractionAccess = {
  isDeviceEnabled: true,
  unavailable: null,
  interactions: {
    startSession: async () => {
      throw new Error("Not used");
    },
    submitMessage: async () => {
      throw new Error("Not used");
    },
    requestSubagent: async () => {},
  },
};
const input: SubagentReadinessInput = {
  organizationId: "org",
  projectId: "project",
  agentSessionId: "session",
  conversationId: "conversation",
  readOnly: false,
  session,
  interactionAccess: access,
  recoveryState: {
    type: "ready",
    machine: {
      machineId: "machine",
      name: "Machine",
      executionReadiness: "READY",
      currentControllerEligibility: "ELIGIBLE",
    },
  },
};
describe("subagent readiness", () => {
  it("allows reopened graph-only sessions without provider or Service identities", () => {
    expect(resolveSubagentReadiness(input)).toEqual({
      kind: "ready",
      runId: "session",
      requestSubagent: access.interactions?.requestSubagent,
    });
  });
  it.each([
    { session: null },
    { readOnly: true },
    { session: { ...session, status: AgentSessionStatus.NotStarted } },
    { session: { ...session, machineId: null } },
    { session: { ...session, machineId: "other" } },
    { session: { ...session, id: "other" } },
    { session: { ...session, organizationId: "other" } },
    { session: { ...session, projectId: "other" } },
    { session: { ...session, conversationId: "other" } },
    { recoveryState: { type: "loading" } },
    { recoveryState: { type: "legacy_non_resumable" } },
    { recoveryState: { type: "status_unavailable" } },
    {
      interactionAccess: {
        isDeviceEnabled: false,
        interactions: null,
        unavailable: { type: "machine_unavailable", message: "Unavailable" },
      },
    },
  ] satisfies Partial<SubagentReadinessInput>[])(
    "withholds execution for %j",
    (override) => {
      expect(resolveSubagentReadiness({ ...input, ...override }).kind).toBe(
        "unavailable"
      );
    }
  );
});

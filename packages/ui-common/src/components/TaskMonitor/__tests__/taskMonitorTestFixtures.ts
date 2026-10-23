import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  TaskSource,
  WorkStatus,
  type AgentSessionDto,
  type TaskMonitorExecutionDefinition,
  type TaskResponseDto,
} from "../../../api";

export const firstTaskId = "11111111-1111-4111-8111-111111111111";
export const secondTaskId = "22222222-2222-4222-8222-222222222222";
export const sessionId = "33333333-3333-4333-8333-333333333333";

export const createTaskMonitorDefinition =
  (): TaskMonitorExecutionDefinition => ({
    executionPlan: [
      {
        taskId: firstTaskId,
        dependsOnTaskIds: [],
        launchConfiguration: {
          method: "quick",
          provider: "codex",
          model: "gpt-5.5",
          reasoningEffort: "high",
        },
      },
      {
        taskId: secondTaskId,
        dependsOnTaskIds: [firstTaskId],
        launchConfiguration: {
          method: "open",
          provider: "codex",
          model: "gpt-5.5",
          reasoningEffort: "high",
        },
        agentSessionId: sessionId,
      },
    ],
    launchPolicy: {
      terminalSupervision: { mode: "AGENT_DECIDES" },
    },
    cursor: 1,
  });

export const createTask = (
  id: string,
  name: string,
  status: WorkStatus = WorkStatus.Ready,
): TaskResponseDto => ({
  id,
  name,
  type: "STANDARD",
  organizationId: "org-1",
  projectId: "project-1",
  status,
  source: TaskSource.User,
});

export const createSession = (): AgentSessionDto => ({
  id: sessionId,
  organizationId: "org-1",
  projectId: "project-1",
  userId: "user-1",
  status: AgentSessionStatus.InProgress,
  currentState: AgentSessionCurrentState.Idle,
  conversationId: null,
  sessionDate: "2026-07-20T00:00:00.000Z",
  title: "Second task session",
  hasUnsyncedChanges: false,
  monitoringEnabled: true,
  autoDecide: false,
  type: AgentSessionType.Coding,
});

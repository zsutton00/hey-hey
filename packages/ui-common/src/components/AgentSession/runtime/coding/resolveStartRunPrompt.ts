import type {
  AgentSessionConfig,
  ProjectModeSelection,
  ProjectModeSnapshot,
  WorkflowName,
} from "../../../../api";
import {
  buildDefaultStartupSessionPayload,
  buildTaskEntity,
  DEFAULT_HANDLER_PROMPT_TYPE,
  getMethodConfig,
  type StartRunLaunchContext,
} from "../../../../agents/coordination/sessionMethodRegistry";
import {
  AgentSessionConfigV2TypeEnum,
  LocalPromptType,
  type RunCreatePayload,
  type RunCreatePayloadProjectMode,
  ProjectModeFilesSchemaVersionEnum,
  ProjectModeSelectionSchemaVersionEnum,
  ProjectModeSnapshotSchemaVersionEnum,
  RunCreatePayloadWorkflowKickoffPromptTypeEnum,
  type RunCreatePayloadWorkflowKickoff,
} from "../../../../api";

export interface ResolveStartRunPromptArgs {
  launch: StartRunLaunchContext;
  launchPlanId?: string | null;
  launchStepId?: string | null;
  launchStageId?: string | null;
  userMessage: string;
  /**
   * The server-returned AgentSession config is authoritative for launch
   * routing. In particular, project-mode selection must not be reconstructed
   * from the live MODE catalog or UI state.
   */
  config?: AgentSessionConfig | null;
}

/**
 * The two start-run arms the platform accepts. `workflow` materializes the
 * Run and binds the conversation to a Temporal workflow without firing a
 * first turn; `handler` carries an envelope-level `handlerPromptType` plus
 * the in-payload `promptType`+body that the CLI dispatches as the first
 * turn. The workflow arm carries a typed `workflow_kickoff` payload so the
 * Run materializes with the launch surface's canonical task entity.
 */
export type ResolvedStartRunPrompt =
  | {
      kind: "workflow";
      workflowName: WorkflowName;
      payload: RunCreatePayloadWorkflowKickoff;
    }
  | {
      kind: "handler";
      promptType: LocalPromptType;
      payload: RunCreatePayload;
    };

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isCompleteProjectModeCapture = (
  selection: ProjectModeSelection,
  snapshot: ProjectModeSnapshot,
): boolean =>
  selection.schemaVersion ===
    ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1 &&
  hasText(selection.modeId) &&
  (snapshot.schemaVersion ===
    ProjectModeSnapshotSchemaVersionEnum.ProjectModeSnapshotV1 ||
    ((snapshot.schemaVersion ===
      ProjectModeSnapshotSchemaVersionEnum.ProjectModeSnapshotV2 ||
      (snapshot.schemaVersion ===
        ProjectModeSnapshotSchemaVersionEnum.ProjectModeSnapshotV3 &&
        snapshot.sessionRole !== undefined)) &&
      typeof snapshot.projectAssistant?.enabled === "boolean")) &&
  hasText(snapshot.modeId) &&
  snapshot.modeId === selection.modeId &&
  typeof snapshot.catalogDescription === "string" &&
  Array.isArray(snapshot.applicableWorkItemTypeKeys) &&
  hasText(snapshot.snapshotHash) &&
  snapshot.files?.schemaVersion ===
    ProjectModeFilesSchemaVersionEnum.ProjectModeFilesV1 &&
  hasText(snapshot.files?.files?.["MODE.md"]);

const resolveProjectModeCapture = (
  config: AgentSessionConfig | null | undefined,
) => {
  if (config?.type !== AgentSessionConfigV2TypeEnum.CodingSession) return null;

  const { projectModeSelection: selection, projectModeSnapshot: snapshot } =
    config;
  if (selection === undefined && snapshot === undefined) return null;

  if (
    !selection ||
    !snapshot ||
    !isCompleteProjectModeCapture(selection, snapshot)
  ) {
    throw new Error(
      "Cannot start project mode: the captured selection and snapshot are missing or incomplete.",
    );
  }

  return { selection, snapshot };
};

/**
 * Maps the coding session's method to a start-run arm in one place — the
 * registry — so the envelope promptType, the in-payload promptType, and the
 * workflowName-vs-handler choice all originate from the same row and can
 * never drift. Methods with `dispatch.kind === "workflow"` emit the
 * materialize-only `workflowName` arm; handler-arm methods invoke the row's
 * `buildPayload` closure for the in-payload body. When the caller has no
 * `sessionMethod` (legacy callers), defaults to the historical
 * `startup_session` handler arm.
 */
export const resolveStartRunPrompt = ({
  launch,
  launchPlanId,
  launchStepId,
  launchStageId,
  userMessage,
  config,
}: ResolveStartRunPromptArgs): ResolvedStartRunPrompt => {
  const method = launch.sessionMethod?.method;
  if (resolveProjectModeCapture(config)) {
    const payload: RunCreatePayloadProjectMode = {
      entity: buildTaskEntity(launch),
      promptType: "project_mode",
      userMessage,
    };
    return {
      kind: "handler",
      promptType: LocalPromptType.ProjectMode,
      payload,
    };
  }
  const ctx = {
    launch,
    userMessage,
    ...(launchPlanId !== undefined ? { launchPlanId } : {}),
    ...(launchStepId !== undefined ? { launchStepId } : {}),
    ...(launchStageId !== undefined ? { launchStageId } : {}),
  };

  if (!method || method === "validation") {
    return {
      kind: "handler",
      promptType: DEFAULT_HANDLER_PROMPT_TYPE,
      payload: buildDefaultStartupSessionPayload(ctx),
    };
  }

  const dispatch = getMethodConfig(method).dispatch;
  if (dispatch.kind === "workflow") {
    return {
      kind: "workflow",
      workflowName: dispatch.workflowName,
      payload: {
        promptType:
          RunCreatePayloadWorkflowKickoffPromptTypeEnum.WorkflowKickoff,
        entity: buildTaskEntity(launch),
        userMessage,
      },
    };
  }
  return {
    kind: "handler",
    promptType: dispatch.handlerPromptType,
    payload: dispatch.buildPayload(ctx),
  };
};

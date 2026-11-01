import { describe, expect, it } from "vitest";
import {
  AgentSessionConfigV2TypeEnum,
  ProjectModeFilesSchemaVersionEnum,
  ProjectModeSelectionSchemaVersionEnum,
  ProjectModeSnapshotSchemaVersionEnum,
  SessionRole,
  WorkflowName,
  type AgentSessionConfigV2,
} from "../../../../../api";
import type { SessionMethod } from "../../../../../agents/prompts.js";
import type { StartRunLaunchContext } from "../../../../../agents/coordination/sessionMethodRegistry";
import { LocalPromptType } from "../../../../../api";
import { resolveStartRunPrompt } from "../resolveStartRunPrompt";

const makeLaunch = (
  method?: SessionMethod,
  taskId = "task-1",
): StartRunLaunchContext => ({
  taskId,
  ...(method
    ? { sessionMethod: { method, serviceIds: [], services: [] } }
    : {}),
});

// Reads the in-payload discriminator without leaning on the cast-away union.
const payloadPromptType = (payload: unknown): string =>
  (payload as { promptType: string }).promptType;

const makeProjectModeConfig = (
  overrides: Partial<AgentSessionConfigV2> = {},
): AgentSessionConfigV2 => ({
  type: AgentSessionConfigV2TypeEnum.CodingSession,
  version: "v2",
  model: "gpt-5",
  projectModeSelection: {
    schemaVersion: ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
    modeId: "mode-review",
  },
  projectModeSnapshot: {
    schemaVersion: ProjectModeSnapshotSchemaVersionEnum.ProjectModeSnapshotV1,
    modeId: "mode-review",
    catalogDescription: "Review mode",
    applicableWorkItemTypeKeys: ["STANDARD"],
    files: {
      schemaVersion: ProjectModeFilesSchemaVersionEnum.ProjectModeFilesV1,
      files: {
        "MODE.md": "Review the implementation carefully.",
        "review.md": "Supporting review guidance.",
      },
    },
    snapshotHash: "snapshot-hash",
  },
  ...overrides,
});

describe("resolveStartRunPrompt", () => {
  it("maps plan to an entity-scoped FeatureSync materialization request", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch("plan"),
      launchPlanId: "plan-1",
      launchStepId: "step-1",
      launchStageId: "stage-1",
      userMessage: "kick it off",
    });

    expect(resolved.kind).toBe("workflow");
    if (resolved.kind !== "workflow") throw new Error("expected workflow arm");
    expect(resolved).toEqual({
      kind: "workflow",
      workflowName: WorkflowName.FeatureSync,
      payload: {
        promptType: "workflow_kickoff",
        entity: { entityType: "TASK", entityId: "task-1" },
        userMessage: "kick it off",
      },
    });
  });

  it("plan ignores launch ids — they belong to the handler arm only", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch("plan"),
      userMessage: "",
    });

    expect(resolved.kind).toBe("workflow");
  });

  it("maps open to a free_form handler payload", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch("open"),
      userMessage: "",
    });

    expect(resolved.kind).toBe("handler");
    if (resolved.kind !== "handler") throw new Error("expected handler arm");
    expect(resolved.promptType).toBe(LocalPromptType.FreeForm);
    expect(payloadPromptType(resolved.payload)).toBe("free_form");
    expect(resolved.payload).toMatchObject({
      entity: { entityType: "TASK", entityId: "task-1" },
    });
    expect(resolved.payload).not.toHaveProperty("splitMode");
  });

  it("maps a project-mode selection to the dedicated project_mode handler payload", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch(),
      config: makeProjectModeConfig(),
      userMessage: "Review the implementation.",
    });

    expect(resolved).toEqual({
      kind: "handler",
      promptType: LocalPromptType.ProjectMode,
      payload: {
        entity: { entityType: "TASK", entityId: "task-1" },
        promptType: "project_mode",
        userMessage: "Review the implementation.",
      },
    });
  });

  it.each(Object.values(SessionRole))(
    "launches a v3 capture with role %s",
    (sessionRole) => {
      const config = makeProjectModeConfig();
      config.projectModeSnapshot = {
        ...config.projectModeSnapshot!,
        schemaVersion:
          ProjectModeSnapshotSchemaVersionEnum.ProjectModeSnapshotV3,
        projectAssistant: { enabled: false },
        sessionRole,
      };
      expect(
        resolveStartRunPrompt({
          launch: makeLaunch(),
          config,
          userMessage: "Continue captured work.",
        }),
      ).toEqual({
        kind: "handler",
        promptType: LocalPromptType.ProjectMode,
        payload: {
          entity: { entityType: "TASK", entityId: "task-1" },
          promptType: "project_mode",
          userMessage: "Continue captured work.",
        },
      });
    },
  );

  const expectIncompleteProjectModeConfig = (config: AgentSessionConfigV2) => {
    expect(() =>
      resolveStartRunPrompt({
        launch: makeLaunch(),
        config,
        userMessage: "Review the implementation.",
      }),
    ).toThrow(
      "Cannot start project mode: the captured selection and snapshot are missing or incomplete.",
    );
  };

  it("rejects project-mode launch when the captured selection is missing", () => {
    expectIncompleteProjectModeConfig(
      makeProjectModeConfig({ projectModeSelection: undefined }),
    );
  });

  it("rejects project-mode launch when the captured snapshot is missing", () => {
    expectIncompleteProjectModeConfig(
      makeProjectModeConfig({ projectModeSnapshot: undefined }),
    );
  });

  const makeV2ProjectModeConfig = (
    projectAssistant: { enabled: boolean } | undefined,
  ): AgentSessionConfigV2 => {
    const base = makeProjectModeConfig();
    return {
      ...base,
      projectModeSnapshot: {
        ...base.projectModeSnapshot!,
        schemaVersion:
          ProjectModeSnapshotSchemaVersionEnum.ProjectModeSnapshotV2,
        projectAssistant,
      },
    };
  };

  it("accepts a v2 snapshot that carries the Project Assistant setting", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch(),
      config: makeV2ProjectModeConfig({ enabled: true }),
      userMessage: "Review the implementation.",
    });

    expect(resolved.kind).toBe("handler");
    if (resolved.kind !== "handler") throw new Error("expected handler arm");
    expect(resolved.promptType).toBe(LocalPromptType.ProjectMode);
  });

  it("rejects a v2 snapshot without the Project Assistant setting", () => {
    expectIncompleteProjectModeConfig(makeV2ProjectModeConfig(undefined));
  });

  it("maps split_by_service to set_splitting with splitMode 'service'", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch("split_by_service"),
      userMessage: "",
    });

    expect(resolved.kind).toBe("handler");
    if (resolved.kind !== "handler") throw new Error("expected handler arm");
    expect(resolved.promptType).toBe(LocalPromptType.SetSplitting);
    expect(resolved.payload).toMatchObject({
      promptType: "set_splitting",
      splitMode: "service",
    });
  });

  it("maps split_by_function to set_splitting with splitMode 'feature'", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch("split_by_function"),
      userMessage: "",
    });

    expect(resolved.kind).toBe("handler");
    if (resolved.kind !== "handler") throw new Error("expected handler arm");
    expect(resolved.promptType).toBe(LocalPromptType.SetSplitting);
    expect(resolved.payload).toMatchObject({
      promptType: "set_splitting",
      splitMode: "feature",
    });
  });

  it("defaults an absent method to the startup_session handler arm and carries launch ids", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch(),
      launchPlanId: "plan-9",
      launchStepId: "step-9",
      launchStageId: "stage-9",
      userMessage: "Supplemental context",
    });

    expect(resolved.kind).toBe("handler");
    if (resolved.kind !== "handler") throw new Error("expected handler arm");
    expect(resolved.promptType).toBe(LocalPromptType.StartupSession);
    expect(payloadPromptType(resolved.payload)).toBe("startup_session");
    expect(resolved.payload).toMatchObject({
      launchPlanId: "plan-9",
      launchStepId: "step-9",
      launchStageId: "stage-9",
      userMessage: "Supplemental context",
    });
  });

  it("omits absent launch ids on the startup_session payload", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch(),
      userMessage: "",
    });

    expect(resolved.kind).toBe("handler");
    if (resolved.kind !== "handler") throw new Error("expected handler arm");
    expect(resolved.payload).not.toHaveProperty("launchPlanId");
    expect(resolved.payload).not.toHaveProperty("launchStepId");
    expect(resolved.payload).not.toHaveProperty("launchStageId");
    expect(resolved.payload).not.toHaveProperty("userMessage");
  });

  it("maps debug to a debug handler payload", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch("debug"),
      userMessage: "",
    });

    expect(resolved.kind).toBe("handler");
    if (resolved.kind !== "handler") throw new Error("expected handler arm");
    expect(resolved.promptType).toBe(LocalPromptType.Debug);
    expect(payloadPromptType(resolved.payload)).toBe("debug");
  });

  it("maps research to a research handler payload", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch("research"),
      userMessage: "",
    });

    expect(resolved.kind).toBe("handler");
    if (resolved.kind !== "handler") throw new Error("expected handler arm");
    expect(resolved.promptType).toBe(LocalPromptType.Research);
    expect(payloadPromptType(resolved.payload)).toBe("research");
  });

  it("maps Task Only to the stable quick handler payload", () => {
    const resolved = resolveStartRunPrompt({
      launch: makeLaunch("quick"),
      userMessage: "",
    });

    expect(resolved.kind).toBe("handler");
    if (resolved.kind !== "handler") throw new Error("expected handler arm");
    expect(resolved.promptType).toBe(LocalPromptType.Quick);
    expect(payloadPromptType(resolved.payload)).toBe("quick");
    expect(resolved.payload).toMatchObject({
      promptType: "quick",
      userMessage: "",
    });
    expect(resolved.payload).not.toHaveProperty("startupInput");
  });

  it("always emits an envelope promptType equal to the payload promptType for handler arms", () => {
    // Plan rides the workflow arm and has no envelope promptType — excluded.
    const handlerMethods: (SessionMethod | undefined)[] = [
      "open",
      "debug",
      "research",
      "quick",
      "split_by_service",
      "split_by_function",
      undefined,
    ];

    for (const method of handlerMethods) {
      const resolved = resolveStartRunPrompt({
        launch: makeLaunch(method),
        userMessage: "",
      });
      expect(resolved.kind).toBe("handler");
      if (resolved.kind !== "handler") throw new Error("expected handler arm");
      expect(resolved.promptType).toBe(payloadPromptType(resolved.payload));
      expect(resolved.payload).toMatchObject({
        entity: { entityType: "TASK", entityId: "task-1" },
      });
    }
  });

  describe("project-defined work-item types", () => {
    // The launch carries the task id only; the Run's focal identity is the
    // TASK entity reference, so the work item's type can never be mapped,
    // coerced or rejected on the way to the wire.
    const CUSTOM_TASK_ID = "job-application-record-1";
    const allMethods: (SessionMethod | undefined)[] = [
      "plan",
      "open",
      "debug",
      "research",
      "quick",
      "split_by_service",
      "split_by_function",
      undefined,
    ];

    it.each(allMethods)(
      "launches method %s with the real task id and no copied task content",
      (method) => {
        const resolved = resolveStartRunPrompt({
          launch: makeLaunch(method, CUSTOM_TASK_ID),
          userMessage: "go",
        });

        expect(resolved.payload).toMatchObject({
          entity: { entityType: "TASK", entityId: CUSTOM_TASK_ID },
        });
        expect(resolved.payload).not.toHaveProperty("startupInput");
      },
    );

    it("launches a project-mode capture for a custom-type task", () => {
      const resolved = resolveStartRunPrompt({
        launch: makeLaunch(undefined, CUSTOM_TASK_ID),
        config: makeProjectModeConfig(),
        userMessage: "Review it.",
      });

      expect(resolved).toEqual({
        kind: "handler",
        promptType: LocalPromptType.ProjectMode,
        payload: {
          entity: { entityType: "TASK", entityId: CUSTOM_TASK_ID },
          promptType: "project_mode",
          userMessage: "Review it.",
        },
      });
    });

    it("still rejects an incomplete project-mode capture for a custom-type task", () => {
      expect(() =>
        resolveStartRunPrompt({
          launch: makeLaunch(undefined, CUSTOM_TASK_ID),
          config: makeProjectModeConfig({ projectModeSnapshot: undefined }),
          userMessage: "Review it.",
        }),
      ).toThrow(
        "Cannot start project mode: the captured selection and snapshot are missing or incomplete.",
      );
    });

    it("rejects a launch without a task id", () => {
      expect(() =>
        resolveStartRunPrompt({
          launch: makeLaunch("open", "  "),
          userMessage: "",
        }),
      ).toThrow("A task-scoped Run requires a task id.");
    });

    it("threads the selected services into set_splitting from the launch", () => {
      const resolved = resolveStartRunPrompt({
        launch: {
          taskId: CUSTOM_TASK_ID,
          sessionMethod: {
            method: "split_by_service",
            serviceIds: ["svc-1"],
            services: [{ id: "svc-1", name: "API" }],
          },
        },
        userMessage: "",
      });

      expect(resolved.payload).toMatchObject({
        promptType: "set_splitting",
        splitMode: "service",
        services: [{ id: "svc-1", name: "API" }],
      });
    });
  });
});

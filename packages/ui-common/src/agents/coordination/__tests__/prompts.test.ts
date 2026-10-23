import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildFinalAssessmentPrompt,
  buildVerificationPlanPrompt,
} from "../prompts";
import { AgentEdgeType, TaskSource, WorkStatus } from "../../../api";

const { mockUnifiedApiClient } = vi.hoisted(() => ({
  mockUnifiedApiClient: {
    getTask: vi.fn(),
    getTasks: vi.fn(),
  },
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: mockUnifiedApiClient,
}));

const FIXED_TIME = "2026-02-23T00:00:00.000Z";

const createCanonicalWorkItem = (input: {
  id: string;
  type: string;
  parentTaskId: string;
  dependencies?: string[];
  description?: string;
  acceptanceCriteria?: string;
}) => ({
  id: input.id,
  name: `Task ${input.id}`,
  type: input.type,
  organizationId: "org-1",
  projectId: "project-1",
  parentTaskId: input.parentTaskId,
  status: WorkStatus.Active,
  source: TaskSource.Agent,
  sections: [
    {
      id: `${input.id}-description`,
      key: "description",
      order: 0,
      materializedMarkdown: input.description ?? "",
    },
    {
      id: `${input.id}-acceptanceCriteria`,
      key: "acceptanceCriteria",
      order: 1,
      materializedMarkdown: input.acceptanceCriteria ?? "",
    },
  ],
  edges: (input.dependencies ?? []).map((dependencyId) => ({
    id: `${input.id}-${dependencyId}`,
    sourceNodeId: input.id,
    targetNodeId: dependencyId,
    type: AgentEdgeType.DependsOn,
    reasoning: "Dependency",
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  })),
  createdAt: FIXED_TIME,
  updatedAt: FIXED_TIME,
});

describe("coordination prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const parent = createCanonicalWorkItem({
      id: "task-0",
      type: "STANDARD",
      parentTaskId: "stage-1",
      description: "Parent description",
      acceptanceCriteria: "Parent acceptance criteria",
    });
    const active = createCanonicalWorkItem({
      id: "task-1",
      type: "STANDARD",
      parentTaskId: "stage-1",
      dependencies: ["task-0"],
    });
    const child = createCanonicalWorkItem({
      id: "task-2",
      type: "STANDARD",
      parentTaskId: "stage-1",
      dependencies: ["task-1"],
      description: "Child description",
      acceptanceCriteria: "Child acceptance criteria",
    });
    mockUnifiedApiClient.getTask.mockImplementation(
      ({ taskId }: { taskId: string }) =>
        Promise.resolve({
          data: {
            data:
              taskId === "task-1"
                ? active
                : taskId === "stage-1"
                  ? createCanonicalWorkItem({
                      id: "stage-1",
                      type: "PLAN_STAGE",
                      parentTaskId: "plan-1",
                    })
                  : createCanonicalWorkItem({
                      id: "plan-1",
                      type: "PLAN",
                      parentTaskId: "feature-1",
                    }),
          },
        }),
    );
    mockUnifiedApiClient.getTasks.mockResolvedValue({
      data: { data: [parent, active, child] },
    });
  });

  it("matches final assessment prompt snapshot", async () => {
    const prompt = await buildFinalAssessmentPrompt({
      context: {
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: null,
        taskId: "task-1",
        planId: "plan-1",
        designDocId: "doc-1",
      },
      startupInput: {
        task: {
          id: "task-1",
          title: "Implement startup workflow",
          taskType: "STANDARD",
          description: "Add startup planning",
          acceptanceCriteria: "Discrepancies include source refs",
        },
        designDoc: {
          id: "doc-1",
          title: "Agent lifecycle",
          sections: {
            context: "Session startup context",
          },
        },
        adjacentScopeTasks: [],
        evidenceItems: [
          {
            id: "ev-1",
            type: "task",
            title: "Task evidence",
            content: "Task details",
            topologySummary: "Flow summary",
            score: 0.91,
            source: "unified_search",
          },
        ],
      },
      startupDiscrepancyContext: [
        {
          discrepancyIndex: 0,
          sourceRef: {
            sourceType: "evidenceItem",
            sourceId: "ev-1",
          },
          sourceField: "content",
          sourceExcerpt: "Task evidence",
          reasoning: "Source path references are stale.",
          discrepancyText: "Evidence references outdated entrypoints.",
          severity: "medium",
          disposition: "acknowledged",
          dispositionNote: "Accepted for this session.",
          sourceEventMetadata: {
            startupPlanResponseEventSeq: 11,
            startupPlanReviewActionEventSeq: 22,
            startupPlanReviewSourceEventSeq: 11,
          },
        },
      ],
      executionSummary:
        "Implemented parser and prompt snapshots. Found one outdated evidence note about previous file paths.",
    });

    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain("task_status|");
    expect(prompt).toContain(
      "Assess task completion against effective acceptance criteria: the task's existing acceptanceCriteria plus any explicit user-approved adjustments recorded in startup discrepancy handling or execution summary.",
    );
    expect(prompt).toContain(
      "Treat startup-logged discrepancies that were explicitly acknowledged/approved as resolved context, not blockers.",
    );
    expect(prompt).toContain(
      "Treat startup discrepancy context as a high-priority signal for evidenceCorrections, especially when sourceRef.sourceType is evidenceItem.",
    );
    expect(prompt).toContain(
      "Include evidenceCorrections when startup discrepancies reveal stale or inaccurate evidence, even if the discrepancy was acknowledged.",
    );
    expect(prompt).toContain(
      "implementationNotes must summarize concrete code or behavior changes completed in this session; do not describe planned or hypothetical work.",
    );
    expect(prompt).toContain('"implementationNotes":');
    expect(prompt).toContain("Startup discrepancy context:");
    expect(prompt).toContain(
      'Treat execution-summary statements like "skipped by request", "deferred by request", or equivalent explicit user approvals as resolved for verdict purposes, not as incompleteness.',
    );
    expect(prompt).toContain(
      "Do not lower the verdict solely because an originally listed criterion was explicitly waived or changed by user request during this session.",
    );
    expect(prompt).toContain(
      "Lower the verdict only for unresolved discrepancies or new material gaps that were not previously acknowledged/approved.",
    );
    expect(prompt).toContain('"parentTasks": [');
    expect(prompt).toContain('"childTasks": [');
    expect(mockUnifiedApiClient.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        parentTaskId: "stage-1",
        type: "STANDARD",
        includeEdges: true,
      }),
    );
    expect(prompt).toContain(
      "When suggesting task/design-doc edits, make the smallest possible textual and structural changes while emulating existing wording, tone, and organization.",
    );
    expect(prompt).toContain(
      "Treat task description/acceptanceCriteria as canonical artifact fields, not execution summaries.",
    );
    expect(prompt).toContain(
      'Do not replace task description/acceptanceCriteria with session narrative framing (for example, "this session implemented..." or "we added...") unless that phrasing already exists in the task text and you are making a minimal edit to it.',
    );
    expect(prompt).toContain(
      "Preserve existing task/design-doc text outside the directly affected portion; apply minimal-delta edits only.",
    );
    expect(prompt).toContain(
      "For partial implementation sessions, assess completion and recommend updates only for portions evidenced as implemented in this session; do not rewrite untouched task portions.",
    );
    expect(prompt).toContain(
      "If out-of-repo or out-of-session work is required but not implemented here, capture it in openQuestions instead of rewriting task description/acceptanceCriteria.",
    );
  });

  it("matches verification plan prompt snapshot", () => {
    const prompt = buildVerificationPlanPrompt({
      context: {
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: null,
        taskId: "task-1",
        designDocId: "doc-1",
      },
      startupInput: {
        task: {
          id: "task-1",
          title: "Implement startup workflow",
          taskType: "STANDARD",
          description: "Add startup planning",
          acceptanceCriteria: "Discrepancies include source refs",
        },
        designDoc: {
          id: "doc-1",
          title: "Agent lifecycle",
          sections: {
            verification: "Confirm behavior through real UX flow first",
          },
        },
        adjacentScopeTasks: [],
        evidenceItems: [
          {
            id: "ev-1",
            type: "design_doc",
            title: "Lifecycle evidence",
            content: "Verification should prioritize product flow.",
            score: 0.88,
            source: "unified_search",
          },
        ],
      },
      executionSummary:
        "Added startup/final prompts and parser wiring. Need explicit end-to-end verification steps for user review.",
    });

    expect(prompt).toMatchSnapshot();
  });
});

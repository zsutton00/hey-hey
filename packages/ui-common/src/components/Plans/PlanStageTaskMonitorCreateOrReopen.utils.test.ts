import { describe, expect, it } from "vitest";
import {
  type TaskMonitorExecutionDefinition,
} from "../../api";
import {
  buildPlanStageTaskMonitorCreateDto,
  TASK_MONITOR_EXECUTION_DEFINITION_SECTION_KEY,
  TASK_MONITOR_SUMMARY_SECTION_KEY,
  TASK_MONITOR_TYPE,
  type PlanStageTaskMonitorSourceContext,
} from "./PlanStageTaskMonitorCreateOrReopen.utils";

const context: PlanStageTaskMonitorSourceContext = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  planId: "33333333-3333-4333-8333-333333333333",
  planParentTaskId: "66666666-6666-4666-8666-666666666666",
  stageId: "44444444-4444-4444-8444-444444444444",
  planLabel: "Release plan",
  stageLabel: "Ship stage",
};
const definition: TaskMonitorExecutionDefinition = {
  executionPlan: [
    {
      taskId: "55555555-5555-4555-8555-555555555555",
      dependsOnTaskIds: [],
      launchConfiguration: {
        method: "quick",
        provider: "codex",
        model: "gpt-5.5",
        reasoningEffort: "medium",
      },
    },
  ],
  launchPolicy: {
    terminalSupervision: { mode: "AGENT_DECIDES" as const },
  },
  cursor: 0,
};

describe("plan-stage Task Monitor creation", () => {
  it("persists the confirmed minimal definition exactly", () => {
    expect(buildPlanStageTaskMonitorCreateDto(context, definition)).toEqual({
      name: "Release plan — Ship stage monitor",
      type: TASK_MONITOR_TYPE,
      parentTaskId: context.planParentTaskId,
      sections: [
        {
          key: TASK_MONITOR_SUMMARY_SECTION_KEY,
          content:
            "Monitors the reviewed execution definition for Release plan — Ship stage.",
          order: 0,
        },
        {
          key: TASK_MONITOR_EXECUTION_DEFINITION_SECTION_KEY,
          content: definition,
          order: 1,
        },
      ],
    });
  });
});

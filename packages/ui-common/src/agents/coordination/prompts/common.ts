import type {
  AgentWorkflowContext,
  FinalAssessmentStartupDiscrepancyContextItem,
  FinalAssessmentTaskNeighborhoodInput,
  StartupPromptInput,
} from "../types";

export const stringifyContext = (context: AgentWorkflowContext): string =>
  JSON.stringify(
    {
      organizationId: context.organizationId,
      projectId: context.projectId,
      taskId: context.taskId ?? null,
      designDocId: context.designDocId ?? null,
      initiativeId: context.initiativeId ?? null,
      planId: context.planId ?? null,
      agentSessionId: context.providerAgentSessionId ?? null,
      serviceId: context.serviceId ?? null,
    },
    null,
    2
  );

export const jsonOnlyInstructions = `Return JSON only. Do not include markdown fences.\nDo not include additional commentary outside JSON.`;

const normalizeEvidenceItemForPrompt = (
  evidenceItem: StartupPromptInput["evidenceItems"][number]
): StartupPromptInput["evidenceItems"][number] => {
  const content =
    typeof evidenceItem.content === "string" ? evidenceItem.content.trim() : "";
  if (content.length > 0) {
    return evidenceItem;
  }

  const topologySummary =
    typeof evidenceItem.topologySummary === "string"
      ? evidenceItem.topologySummary.trim()
      : "";
  if (topologySummary.length === 0) {
    return evidenceItem;
  }

  return {
    ...evidenceItem,
    content: topologySummary,
  };
};

export const formatStartupPromptInput = (input: StartupPromptInput): string =>
  JSON.stringify(
    {
      task: input.task,
      ...(input.designDoc ? { designDoc: input.designDoc } : {}),
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.initiative ? { initiative: input.initiative } : {}),
      ...(input.taskNeighborhood
        ? { taskNeighborhood: input.taskNeighborhood }
        : {}),
      adjacentScopeTasks: input.adjacentScopeTasks,
      evidenceItems: input.evidenceItems.map(normalizeEvidenceItemForPrompt),
      ...(input.sessionMethod ? { sessionMethod: input.sessionMethod } : {}),
    },
    null,
    2
  );

export const formatFinalAssessmentTaskNeighborhood = (
  taskNeighborhood: FinalAssessmentTaskNeighborhoodInput
): string =>
  JSON.stringify(
    {
      parentTasks: taskNeighborhood.parentTasks,
      childTasks: taskNeighborhood.childTasks,
    },
    null,
    2
  );

export const formatFinalAssessmentStartupDiscrepancyContext = (
  discrepancies: FinalAssessmentStartupDiscrepancyContextItem[]
): string =>
  JSON.stringify(
    {
      discrepancies,
    },
    null,
    2
  );

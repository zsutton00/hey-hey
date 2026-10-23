export interface CrossServiceReviewTarget {
  serviceId: string;
  serviceName: string;
  repositoryPath: string;
}

export interface BuildCrossServiceReviewPromptInput {
  taskId: string;
  taskName: string;
  workspaceRoot: string;
  serviceTargets: CrossServiceReviewTarget[];
}

const renderServiceTarget = (
  target: CrossServiceReviewTarget,
  index: number
): string =>
  `${String(index + 1)}. ${target.serviceName} (${
    target.serviceId
  })\n   - Repo: ${target.repositoryPath}`;

export const buildCrossServiceReviewPrompt = ({
  taskId,
  taskName,
  workspaceRoot,
  serviceTargets,
}: BuildCrossServiceReviewPromptInput): string => {
  const serviceList = serviceTargets
    .map((target, index) => renderServiceTarget(target, index))
    .join("\n");

  return [
    "Perform a cross-service code review across all repositories listed below.",
    "",
    `Task: ${taskName} (${taskId})`,
    `Workspace root: ${workspaceRoot}`,
    "",
    "Review targets:",
    serviceList,
    "",
    "Required review focus:",
    "1. API contract alignment across services (request/response models, enums, schema drift).",
    "2. Cross-service data flow consistency (producer/consumer assumptions, validation symmetry).",
    "3. Shared type and event contract compatibility.",
    "4. Migration and deployment sequencing risks across repositories.",
    "5. Integration and regression test coverage gaps spanning services.",
    "",
    "Output format:",
    "- Findings first, ordered by severity (high -> medium -> low).",
    "- For each finding include impacted services and file paths.",
    "- Include concrete remediation suggestions and test additions.",
  ].join("\n");
};

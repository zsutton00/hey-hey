const WORKFLOW_LABELS: Record<string, string> = {
  adr: "ADR",
  rfc: "RFC",
  onboarding: "Onboarding",
  "initiative-refinement": "Initiative Refinement",
  "task-generation": "Task Generation",
  "task-refinement": "Task Refinement",
  "coding-prompts": "Coding Prompts",
};

export const getWorkflowLabel = (workflowName?: string | null): string => {
  if (!workflowName) {
    return "Conversation";
  }

  return (
    WORKFLOW_LABELS[workflowName] ||
    workflowName
      .split("-")
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ")
  );
};

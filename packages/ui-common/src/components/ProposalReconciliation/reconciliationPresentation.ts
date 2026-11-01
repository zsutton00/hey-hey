import type { WorkItemTypeDefinitionDto } from "../../api";

export type ReconciliationPresentation =
  | { kind: "work-item"; definition: WorkItemTypeDefinitionDto | undefined }
  | { kind: "design-doc" };

const fieldLabels: Readonly<Record<string, string>> = {
  name: "Name",
  status: "Status",
  priority: "Priority",
  tag: "Tag",
  dueDate: "Due date",
  assigneeId: "Assignee",
  parentTaskId: "Parent",
  serviceIds: "Services",
  summary: "Summary",
};

export function reconciliationFieldLabel(
  path: string,
  presentation: ReconciliationPresentation,
): string {
  const [, key] = path.split(".");
  if (!path.startsWith("sections.")) return fieldLabels[path] ?? "Item change";
  if (presentation.kind === "design-doc")
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/[_-]/g, " ")
      .replace(/^./, (character) => character.toUpperCase());
  return (
    presentation.definition?.sections.find((section) => section.key === key)
      ?.label ?? "Section change"
  );
}

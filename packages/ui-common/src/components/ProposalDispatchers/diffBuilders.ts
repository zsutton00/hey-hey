import type {
  UpdateTaskDto,
  UpdateDesignDocDto,
  DesignDocResponseDto,
  WorkItemTypeDefinitionDto,
} from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { resolveProposalWorkItemSections } from "./workItemProposalSections";

export interface TaskDiffResolved {
  existingAssigneeName?: string;
  newAssigneeName?: string;
  existingParentTaskName?: string;
  newParentTaskName?: string;
  existingServiceNames?: string[];
  newServiceNames?: string[];
  excludedSectionKeys?: readonly string[];
}

/**
 * Builds a diff string for task fields by comparing existing sections
 * with proposed updates.
 */
export function buildTaskDiff(
  existing: WorkItemResponseDto,
  updates: UpdateTaskDto,
  resolved: TaskDiffResolved = {},
  workItemTypeDefinition?: WorkItemTypeDefinitionDto,
): { oldContent: string; newContent: string } {
  const lines: { old: string[]; new: string[] } = { old: [], new: [] };

  if (updates.name !== undefined) {
    lines.old.push(`**Name:** ${existing.name}`);
    lines.new.push(`**Name:** ${updates.name}`);
  }

  if (updates.status !== undefined) {
    lines.old.push(`**Status:** ${existing.status}`);
    lines.new.push(`**Status:** ${updates.status}`);
  }

  if (updates.priority !== undefined) {
    lines.old.push(`**Priority:** ${existing.priority ?? "(none)"}`);
    lines.new.push(`**Priority:** ${updates.priority}`);
  }

  if (updates.type !== undefined) {
    lines.old.push(`**Type:** ${existing.type}`);
    lines.new.push(`**Type:** ${updates.type}`);
  }

  if (updates.dueDate !== undefined) {
    lines.old.push(`**Due Date:** ${existing.dueDate ?? "(none)"}`);
    lines.new.push(`**Due Date:** ${updates.dueDate}`);
  }

  if (updates.assigneeId !== undefined) {
    const existingName = existing.assigneeId
      ? (resolved.existingAssigneeName ?? existing.assigneeId)
      : "(none)";
    const newName = updates.assigneeId
      ? (resolved.newAssigneeName ?? updates.assigneeId)
      : "(none)";
    lines.old.push(`**Assignee:** ${existingName}`);
    lines.new.push(`**Assignee:** ${newName}`);
  }

  if (updates.parentTaskId !== undefined) {
    const existingParentName = existing.parentTaskId
      ? (resolved.existingParentTaskName ?? existing.parentTaskId)
      : "(none)";
    const newParentName = resolved.newParentTaskName ?? updates.parentTaskId;
    lines.old.push(`**Parent Task:** ${existingParentName}`);
    lines.new.push(`**Parent Task:** ${newParentName}`);
  }

  if ("serviceIds" in updates && updates.serviceIds !== undefined) {
    lines.old.push(
      `**Services:** ${resolved.existingServiceNames?.join(", ") || "(none)"}`,
    );
    lines.new.push(
      `**Services:** ${resolved.newServiceNames?.join(", ") || "(none)"}`,
    );
  }

  if (workItemTypeDefinition && updates.sections) {
    const sections = resolveProposalWorkItemSections({
      definition: workItemTypeDefinition,
      proposedSections: updates.sections,
      existingSections: existing.sections,
    });

    for (const section of sections) {
      if (resolved.excludedSectionKeys?.includes(section.key)) continue;
      if (section.kind === "html/css") continue;
      lines.old.push(
        `\n### ${section.label}\n${section.existingContent || "(empty)"}`,
      );
      lines.new.push(
        `\n### ${section.label}\n${section.proposedContent || "(empty)"}`,
      );
    }
  } else if (updates.sections?.length) {
    throw new Error(
      "Task section diffs require the work-item type definition.",
    );
  }

  return {
    oldContent: lines.old.join("\n") || "(no changes)",
    newContent: lines.new.join("\n") || "(no changes)",
  };
}

export function buildDesignDocDiff(
  existing: DesignDocResponseDto,
  updates: UpdateDesignDocDto,
): { oldContent: string; newContent: string } {
  const lines: { old: string[]; new: string[] } = { old: [], new: [] };

  if (updates.name !== undefined) {
    lines.old.push(`**Name:** ${existing.name}`);
    lines.new.push(`**Name:** ${updates.name}`);
  }

  if (updates.summary !== undefined) {
    lines.old.push(`**Summary:** ${existing.summary ?? "(empty)"}`);
    lines.new.push(`**Summary:** ${updates.summary ?? "(empty)"}`);
  }

  if (updates.sections) {
    for (const section of updates.sections) {
      const existingSection = existing.sections?.find(
        (s) => s.key === section.key,
      );

      lines.old.push(
        `\n### ${section.key}\n${
          existingSection?.materializedMarkdown ?? "(empty)"
        }`,
      );
      lines.new.push(`\n### ${section.key}\n${section.content ?? "(empty)"}`);
    }
  }

  return {
    oldContent: lines.old.join("\n") || "(no changes)",
    newContent: lines.new.join("\n") || "(no changes)",
  };
}

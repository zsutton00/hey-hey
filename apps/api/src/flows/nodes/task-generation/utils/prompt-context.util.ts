import { StandardPlaceholders as P } from '../../../../services/llm/placeholders';
import {
  SuggestedActionsFlowContext,
  TaskGenerationFlowContext,
} from '../../../../types/flow-internal.types';
import type { TaskStub } from '../../../../generated';

type ContextSectionOptions = {
  includeInitiativeArtifacts?: boolean;
  includeStubs?: boolean;
  includeMentions?: boolean;
  /**
   * Suppress the CRITICAL_OPERATION_MODE section for stub expansion
   * Use this for nodes that generate stubs rather than expand them
   */
  suppressExpansionMode?: boolean;
};

type TaskGenerationContextLike =
  | TaskGenerationFlowContext
  | SuggestedActionsFlowContext;

/**
 * Determines if we're in stub expansion mode based on context
 * Stub expansion mode is active when there are stubs awaiting expansion
 * (status: suggested, approved, or user_added)
 */
function hasActiveStubSession(context: TaskGenerationContextLike): boolean {
  // Check if context has stubSession property (type guard)
  if (!('stubSession' in context) || !context.stubSession) {
    return false;
  }

  const session = context.stubSession;
  if (!session.stubs || session.stubs.length === 0) {
    return false;
  }

  // Check if there are any stubs that should be expanded
  // (not rejected)
  return session.stubs.some((stub: TaskStub) => stub.status !== 'rejected');
}

function buildPrimaryTargetingGuidance(
  context: TaskGenerationContextLike,
): string | undefined {
  const { workflowAboutType } = context.core;
  const { parentTaskId, initiativeId, designDocId } = context;

  const lines: string[] = [];

  const addInitiativeReference = () => {
    if (initiativeId) {
      lines.push(
        `The initiative provides direction only; keep outputs focused on the ${workflowAboutType}.`,
      );
    }
  };

  const addDesignDocReference = () => {
    if (designDocId) {
      lines.push(
        `Use any design doc as background context only—the ${workflowAboutType} is the objective.`,
      );
    }
  };

  const addDParentTaskReference = () => {
    if (parentTaskId) {
      lines.push(
        `Use the parent task as background context only—the ${workflowAboutType} is the objective.`,
      );
    }
  };

  if (workflowAboutType === 'initiative') {
    addDesignDocReference();
    addDParentTaskReference();
    lines.push(
      'Primary target: This workflow is about an initiative; every task should directly advance it.',
    );
  } else if (workflowAboutType === 'task') {
    addInitiativeReference();
    addDesignDocReference();
    lines.push('Primary target: Generate tasks that help deliver the task.');
  } else if (workflowAboutType === 'design-doc') {
    addInitiativeReference();
    addDParentTaskReference();
    lines.push(
      "Primary target: Generate tasks that help deliver the design document' goals.",
    );
  } else if (workflowAboutType) {
    lines.push(
      `Primary target: Generated tasks should support the workflow's ${workflowAboutType} entity.`,
      'Treat other artifacts as supplemental context only.',
    );
  }

  if (!lines.length) {
    return undefined;
  }

  return `Primary targeting guidance:\n- ${lines.join('\n- ')}`;
}

export function buildTaskGenerationContextSection(
  context: TaskGenerationContextLike,
  {
    includeStubs = true,
    includeMentions = true,
    suppressExpansionMode = false,
  }: ContextSectionOptions = {},
): string {
  const sections: string[] = [];
  const { workflowAboutType } = context.core;

  // Detect if we're in stub expansion mode (unless explicitly suppressed)
  const isStubExpansionMode =
    !suppressExpansionMode && hasActiveStubSession(context);

  const primaryTargetingGuidance = buildPrimaryTargetingGuidance(context);
  if (primaryTargetingGuidance) {
    sections.push(primaryTargetingGuidance);
  }

  // CRITICAL: Add stub expansion mode guidance at the very top
  if (isStubExpansionMode) {
    sections.push(`<<<CRITICAL_OPERATION_MODE>>>
TASK STUB SESSION ACTIVE - You are in STUB EXPANSION mode.

Your job is to expand the task stubs in BEGIN_TASK_STUB_SESSION into complete tasks.
- Create exactly ONE task per stub in "Outstanding suggestions awaiting review"
- Create exactly ONE task per stub in "Approved or user supplied stubs"
- DO NOT generate additional tasks beyond the stubs unless user explicitly requests more
- DO NOT skip any stub suggestions
- Each stub becomes a complete task with title, description, taskType, and profile-appropriate sections
<<<END_CRITICAL_OPERATION_MODE>>>`);
  }

  sections.push(P.CONVERSATION_HISTORY.insert());
  if (includeMentions) {
    sections.push(P.CONVERSATION_MENTIONS.insert());
  }

  const addHeaderGuidance = (targetType: string) => {
    if (workflowAboutType === targetType) {
      const taskLabel = includeStubs ? 'Generate task stubs' : 'Generate tasks';
      sections.push(`${taskLabel} for this ${targetType} that follows:`);
    } else {
      sections.push(`Use this ${targetType} that follows for context only:`);
    }
  };

  if (context.initiativeId) {
    addHeaderGuidance('initiative');
    sections.push(P.INITIATIVE.insert());

    sections.push(
      '## Initiative tasks guidance\n  These tasks have already been created.',
    );
    sections.push(`- Do NOT create tasks that significantly overlap in scope or intent with existing initiative tasks, even if phrased differently.
- If a concern is already covered by an existing task, assume it is handled elsewhere and exclude it.
`);
    sections.push(P.INITIATIVE_TASKS.insert({ fields: ['name'] }));
  }

  if (context.parentTaskId) {
    addHeaderGuidance('task');
    sections.push(P.TASK.insert());
  }

  if (context.designDocId) {
    addHeaderGuidance('design-doc');
    sections.push(P.DESIGN_DOC.insert());
  }

  if (includeStubs) {
    sections.push(P.TASK_STUB_SESSION.insert());
  }

  return sections.join('\n\n');
}

// Export helper for use in other modules
export { hasActiveStubSession };

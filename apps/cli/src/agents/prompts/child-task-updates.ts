import type { LocalChildTaskUpdatesPromptPayload } from '../../shared/agent-bridge-contract/index';
import { jsonOnlyInstructions } from './common';

type ChildTaskPrompt = Pick<
  LocalChildTaskUpdatesPromptPayload['childTasks'][number],
  'id' | 'title' | 'taskType' | 'description' | 'acceptanceCriteria'
>;

const formatChildTask = (
  task: LocalChildTaskUpdatesPromptPayload['childTasks'][number],
): ChildTaskPrompt => ({
  id: task.id,
  title: task.title,
  ...(task.taskType ? { taskType: task.taskType } : {}),
  description: task.description,
  ...(task.acceptanceCriteria ? { acceptanceCriteria: task.acceptanceCriteria } : {}),
});

export const buildChildTaskUpdatesPrompt = (
  payload: LocalChildTaskUpdatesPromptPayload,
): string => {
  if (payload.childTasks.length === 0) {
    throw new Error('buildChildTaskUpdatesPrompt requires at least one child task');
  }

  const contextSections: string[] = [];

  if (payload.initiative) {
    contextSections.push(`Initiative:\n${JSON.stringify(payload.initiative, null, 2)}`);
  }

  if (payload.designDoc) {
    contextSections.push(`Design doc:\n${JSON.stringify(payload.designDoc, null, 2)}`);
  }

  const optionalContext = contextSections.length > 0 ? `\n\n${contextSections.join('\n\n')}` : '';

  return `You are updating child task descriptions after a parent coding session completed.

Your single goal: for each child task, add a short integration note to its description explaining how the completed parent session's work connects to it. Do not rewrite or restructure the existing description.

Completed parent task:
${JSON.stringify(
  {
    id: payload.completedTask.id,
    title: payload.completedTask.title,
  },
  null,
  2,
)}

Assessment summary:
${JSON.stringify(
  {
    verdict: payload.finalAssessment.taskAssessment,
  },
  null,
  2,
)}${optionalContext}

Child tasks to update:
${JSON.stringify(payload.childTasks.map(formatChildTask), null, 2)}

Return a strict JSON object with this exact structure and lowerCamel keys:
{
  "responseType": "child_task_description_update_v1",
  "updates": [
    {
      "taskId": "child task id",
      "integrationNote": "two to four sentences describing how the parent session's implementation connects to this child task — contracts established, patterns to follow, components built that this task will consume or extend, or scope already covered by the parent session"
    }
  ]
}

Rules:
- Emit one entry per child task. Omit a child task only if the parent session's work has zero relevance to it.
- integrationNote is additive context, not a replacement for the child task's description.
- Focus on concrete integration points: interfaces, contracts, conventions, components, or acceptance criteria overlap.
- Do not include implementation details like class names, method names, or file paths — describe what was built and what contract it exposes.
- Do not speculate about work that was not completed in the parent session. Use only what is evidenced in the assessment summary.
- If the parent session partially or fully addressed acceptance criteria of a child task, say so explicitly.
- Keep integrationNote concise: two to four sentences maximum.
- If there are no relevant updates for any child task, return an empty updates array.

${jsonOnlyInstructions}`;
};

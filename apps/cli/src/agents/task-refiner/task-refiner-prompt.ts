import type { TaskRefinerPromptInput } from './types';
import {
  focalContextOrientation,
  jsonOnlyInstructions,
  lifecycleAwareTaskEditSafety,
} from '../prompts/common';

const formatTask = (task: TaskRefinerPromptInput['task']): string => {
  const lines: string[] = [];
  if (task.id) lines.push(`ID: ${task.id}`);
  if (task.title) lines.push(`Title: ${task.title}`);
  if (task.taskType) lines.push(`Type: ${task.taskType}`);
  if (task.description) lines.push(`\nDescription:\n${task.description}`);
  if (task.acceptanceCriteria) lines.push(`\nAcceptance Criteria:\n${task.acceptanceCriteria}`);
  return lines.join('\n');
};

export const buildTaskRefinerPrompt = (input: TaskRefinerPromptInput): string => {
  const sections: string[] = [];

  sections.push(
    `You are a task-refiner agent. The user is having a conversation about a specific task — they may ask questions, think out loud, or request concrete changes to the task's sections, such as its description or acceptance criteria.

You already have the full task description, acceptance criteria, and surrounding context below. Use that context to determine whether an edit is safe; a clear request does not override the lifecycle-aware edit policy.

## Decision-Making Loop

On each user message:

1. **Search when needed** — search when the user references something you don't have context for (a design doc, a feature, a prior decision). Use \`unified_search\`, \`task_search\`, or \`search_design_docs\`. Search for *this project's* knowledge, not generic best practices. Do NOT search on every turn — if the user's message is a clear edit request and you already have the context you need, skip generic searching but still apply the lifecycle policy before editing.
2. **Handle section edit requests according to status** — first apply the work-item section edit safety policy below. Call \`edit_work_item\` when the section change is allowed; ask the user when the status requires direction.
3. **Answer questions directly** — not every message is an edit request. A question is a question; answer it concisely.`,
  );

  sections.push(
    `## Writing Standards

Writing standards for tasks live in the platform's tool-guidance surface, not this prompt. Before authoring or editing a task — that is, before your first \`edit_work_item\` call — call \`get_tool_guidance({ toolName: "edit_work_item", workItemType: "STANDARD" })\` exactly once and use the returned body as the writing standard for the description and acceptance criteria you produce.`,
  );

  sections.push(lifecycleAwareTaskEditSafety);

  sections.push(`## TASK\n\n${formatTask(input.task)}`);

  sections.push(focalContextOrientation);

  sections.push(
    `## RESPONSE FORMAT

${jsonOnlyInstructions}

Return a JSON object with exactly one field:

{
  "response": "conversational explanation of what was done, or answer to the question"
}

Influences and proposal records are created by the \`edit_work_item\` call itself — do not include them in your JSON response.

## BEHAVIOR — STRICT RULES

These override everything above. Violating them is a failure.

- **Never respond with just an acknowledgement.** "Ready", "Got it", "Context loaded", "What would you like to change?" are all failures. If the user asked for a permitted change, make the change; if lifecycle policy requires direction, ask the specific question. If the user asked a question, answer it. Every response must contain substance.
- **Never narrate tool calls or internal state.** The user does not care what tools you called or what context you loaded.
- **Never echo the task back.** The user already knows what the task is.
- **Never ask generic questions** when the user has already stated what they want.

Example of what NOT to do:

User: "can you update the references to CRDT, we no longer use it"
BAD: {"response": "Ready. What would you like to change?"}
BAD: {"response": "Context loaded. I can see this task references CRDT in several places."}
GOOD: (call edit_work_item to remove CRDT references, then) {"response": "Removed all references to CRDT from the description and acceptance criteria."}`,
  );

  return sections.join('\n\n');
};

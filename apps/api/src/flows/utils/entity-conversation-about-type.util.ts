export const ENTITY_CONVERSATION_TASK_ABOUT_TYPES = [
  'task',
  'feature',
  'bug',
  'goal',
  'contract',
  'task_monitor',
  'workflow',
  'workflow_step',
  'diagram',
  'diagram_element',
] as const;

export type EntityConversationTaskAboutType =
  (typeof ENTITY_CONVERSATION_TASK_ABOUT_TYPES)[number];

const ENTITY_CONVERSATION_TASK_ABOUT_TYPE_SET = new Set<string>(
  ENTITY_CONVERSATION_TASK_ABOUT_TYPES,
);

export function isEntityConversationTaskAboutType(
  workflowAboutType: string,
): workflowAboutType is EntityConversationTaskAboutType {
  return ENTITY_CONVERSATION_TASK_ABOUT_TYPE_SET.has(workflowAboutType);
}

const ENTITY_CONVERSATION_TASK_LABELS: Record<
  EntityConversationTaskAboutType,
  string
> = {
  task: 'task',
  feature: 'feature',
  bug: 'bug',
  goal: 'goal',
  contract: 'contract',
  task_monitor: 'task monitor',
  workflow: 'workflow',
  workflow_step: 'workflow step',
  diagram: 'diagram',
  diagram_element: 'diagram element',
};

export function entityConversationTaskLabel(
  workflowAboutType: EntityConversationTaskAboutType,
): string {
  return ENTITY_CONVERSATION_TASK_LABELS[workflowAboutType];
}

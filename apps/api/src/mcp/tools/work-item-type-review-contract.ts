import { WorkStatus } from '../../generated/model/workStatus';

const displayStatus = (status: WorkStatus): string =>
  status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

export const CREATE_WORK_ITEM_TYPE_GUESS_LEAD_INS = Object.freeze([
  'It sounds like',
  'My read is',
  'Based on your description',
  'I’m assuming',
] as const);

export const CREATE_WORK_ITEM_TYPE_REVIEW_QUESTIONS = Object.freeze([
  {
    title: 'Identity, purpose, and success',
    prompt: 'What should this type be called?',
    exampleGuess: 'Networking Opportunity.',
  },
  {
    title: 'Information people need',
    prompt: 'What fields do you want this type to have?',
    exampleGuess:
      'Contact, context, source, next step, and follow-up date; contact and context should be required.',
  },
  {
    title: 'Creation and organization',
    prompt:
      'Where should people create and find these items, and should they stand alone, belong to something, or contain other work?',
    exampleGuess:
      'Create them from the project and find them in one list. Each can stand alone and can contain follow-up tasks.',
  },
  {
    title: 'Progress and resolution',
    prompt:
      'What progress stages should people recognize, what counts as resolved, and which changes may the assistant make on its own?',
    exampleGuess:
      `Use ${displayStatus(WorkStatus.Backlog)}, ${displayStatus(WorkStatus.Active)}, and ${displayStatus(WorkStatus.Completed)}. ` +
      `${displayStatus(WorkStatus.Completed)} means no further follow-up is needed, and the assistant may move items between ${displayStatus(WorkStatus.Backlog)} and ${displayStatus(WorkStatus.Active)}.`,
  },
  {
    title: 'Connections and collected work',
    prompt:
      'What should $customType connect to? Should one also gather related work from elsewhere in the project without moving that work underneath it?',
    exampleGuess:
      'Networking Opportunities connect to tasks and features, but do not gather work from elsewhere in the project.',
  },
  {
    title: 'Goal tracking',
    prompt: 'Do you want Goals to be able to track $customType?',
    exampleGuess: 'No, Goals should not track Networking Opportunities.',
  },
  {
    title: 'Sidebar',
    prompt: 'Do you want $customType to appear in the sidebar?',
    exampleGuess:
      'Yes, Networking Opportunities should be easy to open from the sidebar.',
  },
] as const);

export function renderCreateWorkItemTypeReviewPrompt(
  prompt: string,
  customTypeName: string,
): string {
  return prompt.replaceAll('$customType', customTypeName);
}

export const CREATE_WORK_ITEM_TYPE_REVIEW_INSTRUCTION =
  'Review every answer carefully and correct or expand anything that does not match what you want.';

export const CREATE_WORK_ITEM_TYPE_TOOL_DESCRIPTION =
  'Propose a new custom work-item type for user review. Before authoring the ' +
  'definition, call get_tool_guidance({ toolName: "create_work_item_type" }) ' +
  'for the canonical review questionnaire and complete configuration contract. ' +
  'Creation requires one completed review of every question.';

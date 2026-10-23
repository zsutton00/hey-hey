import {
  CREATE_WORK_ITEM_TOOL_DESCRIPTION,
  EDIT_TASKS_TOOL_DESCRIPTION,
  EDIT_WORK_ITEM_TOOL_DESCRIPTION,
  editTasksParameters,
  editWorkItemParameters,
} from '../tools/proposal-tools.provider';
import { LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY } from '../tools/tool-guidance';

describe('generic task edit tool descriptions', () => {
  it('advertises canonical Diagram authoring vocabulary on create_work_item', () => {
    expect(CREATE_WORK_ITEM_TOOL_DESCRIPTION).toContain('DIAGRAM');
    expect(CREATE_WORK_ITEM_TOOL_DESCRIPTION).toContain('DIAGRAM_ELEMENT');
    expect(CREATE_WORK_ITEM_TOOL_DESCRIPTION).not.toContain('workflow');
    expect(CREATE_WORK_ITEM_TOOL_DESCRIPTION).not.toContain('workflow_step');
  });

  it.each([
    ['edit_work_item', EDIT_WORK_ITEM_TOOL_DESCRIPTION],
    ['edit_tasks', EDIT_TASKS_TOOL_DESCRIPTION],
  ])('directs %s to the canonical lifecycle policy', (_name, description) => {
    expect(description).toContain(LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY);
    expect(description).toContain(
      'section content that records what the work does or did',
    );
    expect(description).toContain('check status before editing sections');
    expect(description).not.toMatch(/edit (?:the task|whenever|immediately)/i);
  });

  it('keeps parameter-facing guidance aligned with the same policy', () => {
    expect(editWorkItemParameters.shape.reason.description).toBe(
      'Why this change is being proposed',
    );
    expect(editWorkItemParameters.shape.sections.description).toContain(
      LIFECYCLE_AWARE_TASK_EDIT_SAFETY_SUMMARY,
    );
    expect(editTasksParameters.shape.edits.description).toContain(
      'apply the canonical section-edit policy to `sections`',
    );
  });
});

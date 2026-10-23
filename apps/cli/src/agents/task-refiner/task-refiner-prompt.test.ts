import { describe, it, expect } from 'vitest';
import { buildTaskRefinerPrompt } from './task-refiner-prompt';
import type { TaskRefinerPromptInput } from './types';

const makeInput = (overrides?: Partial<TaskRefinerPromptInput>): TaskRefinerPromptInput => ({
  task: {
    id: 'task-abc-123',
    title: 'Implement widget',
    taskType: 'STANDARD',
    description: 'Build the widget component.',
    acceptanceCriteria: 'Widget renders correctly.',
  },
  ...overrides,
});

describe('buildTaskRefinerPrompt', () => {
  it('uses entity-independent conditional focal orientation', () => {
    const result = buildTaskRefinerPrompt(makeInput());
    expect(result).toContain('get_context');
    expect(result).toContain('Do not reload that same focal entity by default');
    expect(result).toContain('user requests fresh state');
    expect(result).toContain('different referenced entity');
    expect(result).toContain('supplied neighborhood is insufficient');
    expect(result).not.toContain('entityId: "task-abc-123"');
    expect(result).toMatchSnapshot();
  });

  it('includes the task details in the prompt', () => {
    const result = buildTaskRefinerPrompt(makeInput());
    expect(result).toContain('Implement widget');
    expect(result).toContain('Build the widget component.');
    expect(result).toContain('Widget renders correctly.');
  });

  it('keeps the orientation rule stable when task identity is absent', () => {
    const result = buildTaskRefinerPrompt(
      makeInput({
        task: { title: 'No-id task', taskType: 'STANDARD', description: '' },
      }),
    );
    expect(result).not.toContain('entityType: "TASK"');
    expect(result).not.toContain('task-abc-123');
    expect(result).toContain('Do not reload that same focal entity by default');
  });

  it('directs the agent to fetch writing standards via get_tool_guidance for edit_work_item', () => {
    const result = buildTaskRefinerPrompt(makeInput());
    expect(result).toContain('Writing Standards');
    expect(result).toContain('get_tool_guidance');
    expect(result).toContain('"edit_work_item"');
    expect(result).toContain('workItemType: "STANDARD"');
  });

  it('does not embed inline writing standards content in the prompt', () => {
    const result = buildTaskRefinerPrompt(makeInput());
    expect(result).not.toContain('What you get');
    expect(result).not.toContain("What you don't get");
  });

  it('includes behavior rules', () => {
    const result = buildTaskRefinerPrompt(makeInput());
    expect(result).toContain('BEHAVIOR — STRICT RULES');
    expect(result).toContain('Never respond with just an acknowledgement');
  });

  it('renders the work-item section status rules', () => {
    const result = buildTaskRefinerPrompt(makeInput());
    expect(result).toContain('## Work-item section edit safety');
    expect(result).toContain('registry role `work-item`');
    expect(result).toContain('Section content records what the work does or did.');
    expect(result).toContain('ACTIVE is ambiguous');
    expect(result).toContain('VERIFYING:** Ask before editing sections.');
    expect(result).toContain('COMPLETED:** Do not edit sections unless the user instructs you to.');
    expect(result).not.toContain('Act on edit requests immediately');
  });

  it('omits the structural-correction reflection rule', () => {
    const result = buildTaskRefinerPrompt(makeInput());
    expect(result).not.toContain('## Structural-Correction Reflection');
  });
});

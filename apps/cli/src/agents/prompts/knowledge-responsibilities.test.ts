import { describe, expect, it } from 'vitest';
import { buildImplementPrompt } from '../implement/prompts';
import { buildCodingConversationPrompt } from './coding-conversation';
import { buildProjectModePrompt } from '../project-mode/project-mode-prompt';
import { buildPlatformSystemPrompt } from './common';
import { implementationResponsibility } from './knowledge-responsibilities';

const prompts = [
  ['Implement', () => buildImplementPrompt()],
  [
    'free_form without a plan',
    () => buildCodingConversationPrompt({ userMessage: 'Build search' }, { kind: 'launch' }),
  ],
  [
    'coding_freeform without a plan',
    () =>
      buildCodingConversationPrompt(
        { userMessage: 'Fix search' },
        { kind: 'follow_up', awaitingUserReview: false, taskId: null },
      ),
  ],
  [
    'project mode without a plan',
    () =>
      buildProjectModePrompt({
        bundleLocation: '/captured-mode',
        snapshot: {
          files: {
            schemaVersion: 'project-mode-files.v1',
            files: { 'MODE.md': 'Build carefully.' },
          },
        },
      }),
  ],
] as const;

describe('requirement-based implementation evidence', () => {
  it.each(prompts)('composes one shared testing obligation into %s', (_name, build) => {
    const prompt = build();
    expect(prompt.split(implementationResponsibility)).toHaveLength(2);
    expect(prompt).toContain('A task that touches Feature requirements must have tests');
    expect(prompt).toContain('Existing tests satisfy this obligation');
    expect(prompt).toContain('wording-only changes do not by themselves require new tests');
    expect(prompt).toContain(
      'The approved plan, when present, and the latest applicable user request',
    );
    expect(prompt).not.toContain('Applicable items govern research');
  });

  it('keeps the ambient fulfillment rule in its canonical system layer', () => {
    const prompt = buildPlatformSystemPrompt([]);
    expect(
      prompt.split('Judge completion against governing Feature requirements and Contracts'),
    ).toHaveLength(2);
    expect(prompt).toContain('Passing checks alone do not establish fulfillment.');
    expect(prompt).not.toContain(implementationResponsibility);
  });
});

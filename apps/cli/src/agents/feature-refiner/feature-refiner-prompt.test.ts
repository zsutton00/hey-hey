import { describe, it, expect } from 'vitest';
import { buildFeatureRefinerPrompt } from './feature-refiner-prompt';
import type { FeatureRefinerPromptInput } from './types';

const makeInput = (overrides?: Partial<FeatureRefinerPromptInput>): FeatureRefinerPromptInput => ({
  feature: {
    id: 'feat-abc-123',
    title: 'User Dashboard',
    taskType: 'FEATURE',
    description: 'Displays user activity and metrics.',
  },
  ...overrides,
});

describe('buildFeatureRefinerPrompt', () => {
  it('includes the feature details in the prompt', () => {
    const result = buildFeatureRefinerPrompt(makeInput());
    expect(result).toContain('User Dashboard');
    expect(result).toContain('feat-abc-123');
    expect(result).toContain('Displays user activity and metrics.');
  });

  it('directs the agent to fetch writing standards via get_tool_guidance for edit_work_item', () => {
    const result = buildFeatureRefinerPrompt(makeInput());
    expect(result).toContain('Writing Standards');
    expect(result).toContain('get_tool_guidance');
    expect(result).toContain('"edit_work_item"');
    expect(result).toContain('workItemType: "FEATURE"');
  });

  it('does not embed inline definitional or writing-standards content in the prompt', () => {
    const result = buildFeatureRefinerPrompt(makeInput());
    expect(result).not.toContain('What a feature is');
    expect(result).not.toContain('Describe the outcome');
    expect(result).not.toContain('hard, declarative statements');
    expect(result).not.toContain('standalone, atomic statements');
  });

  it('includes behavior rules', () => {
    const result = buildFeatureRefinerPrompt(makeInput());
    expect(result).toContain('BEHAVIOR — STRICT RULES');
    expect(result).toContain('Never respond with just an acknowledgement');
  });

  it('forbids weakening requirements or conflating them with description', () => {
    const result = buildFeatureRefinerPrompt(makeInput());
    expect(result).toContain('Never weaken a requirement');
    expect(result).toContain('Never conflate description and requirements');
  });

  it('renames mechanism-shaped titles while preserving legitimate technical capabilities', () => {
    const result = buildFeatureRefinerPrompt(makeInput());
    expect(result).toContain('Never preserve a mechanism-shaped feature name');
    expect(result).toContain('primarily answers “how is this built?”');
    expect(result).toContain('`Send Updates over WebSockets`');
    expect(result).toContain('`Live Updates`');
    expect(result).toContain('`Build SearchIndexService`');
    expect(result).toContain('`Feature Search`');
    expect(result).toContain('`Event Delivery`');
    expect(result).toContain('not a closed vocabulary');
  });

  it('includes context when relatedEntities are provided', () => {
    const result = buildFeatureRefinerPrompt(
      makeInput({
        relatedEntities: [
          {
            displayName: 'Metrics Service',
            entityType: 'SERVICE',
            entityId: 'svc-123',
            status: 'ACTIVE',
            relationship: 'mentions',
          },
        ],
      }),
    );
    expect(result).toContain('## CONTEXT');
    expect(result).toContain('Metrics Service');
    expect(result).toContain('[mentions]');
  });

  it('omits context section when no relatedEntities, agentSessions, or proposals', () => {
    const result = buildFeatureRefinerPrompt(makeInput());
    expect(result).not.toContain('## CONTEXT');
  });

  it('omits the structural-correction reflection rule', () => {
    const result = buildFeatureRefinerPrompt(makeInput());
    expect(result).not.toContain('## Structural-Correction Reflection');
  });
});

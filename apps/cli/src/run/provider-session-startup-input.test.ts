import { describe, expect, it } from 'vitest';
import type { AgentStartupPromptInputResult } from '../agents/prompt-type-handler';
import {
  projectProviderSessionStartupInput,
  type ProviderSessionDecision,
} from './provider-session-startup-input';

const startupPromptInput: AgentStartupPromptInputResult = {
  startupInput: {
    task: { taskType: 'STANDARD', description: 'CURRENT ENTITY CONTEXT' },
    adjacentScopeTasks: [],
    evidenceItems: [],
  },
  renderedInput: 'CURRENT ENTITY CONTEXT',
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: 'task-1' },
    entity: {} as never,
    context: {} as never,
  },
  provenance: {
    templateKey: 'task',
    ownershipSource: { scope: 'CANONICAL' },
    revisionId: 'revision-1',
    revisionNumber: 1,
  },
};

describe('projectProviderSessionStartupInput', () => {
  it.each<ProviderSessionDecision>([
    'agent-transition-mint',
    'unowned-session-mint',
    'explicit-fresh-mint',
    'per-turn-mint',
  ])('delivers retained input for the %s remint decision', (decision) => {
    expect(
      projectProviderSessionStartupInput({
        decision,
        prompt: 'TURN INPUT',
        startupPromptInput,
      }),
    ).toEqual({
      action: 'remint',
      delivered: true,
      input: { kind: 'turn', prompt: 'CURRENT ENTITY CONTEXT\n\n---\n\nTURN INPUT' },
    });
  });

  it('delivers retained input on the first mint', () => {
    expect(
      projectProviderSessionStartupInput({
        decision: 'first-turn-mint',
        prompt: 'TURN INPUT',
        startupPromptInput,
      }),
    ).toEqual({
      action: 'mint',
      delivered: true,
      input: { kind: 'turn', prompt: 'CURRENT ENTITY CONTEXT\n\n---\n\nTURN INPUT' },
    });
  });

  it.each<ProviderSessionDecision>([
    'first-turn-mint',
    'agent-transition-mint',
    'unowned-session-mint',
    'explicit-fresh-mint',
    'per-turn-mint',
  ])('keeps stable instructions separate from freshly projected context on %s', (decision) => {
    expect(
      projectProviderSessionStartupInput({
        decision,
        prompt: 'LEGACY COMPOSED INPUT',
        startupPromptInput,
        promptSegments: {
          stableInstructions: 'STABLE INSTRUCTIONS',
          dynamicContext: 'HANDLER ENTITY CONTEXT',
          userInput: 'CURRENT USER INPUT',
        },
      }),
    ).toEqual({
      action: decision === 'first-turn-mint' ? 'mint' : 'remint',
      delivered: true,
      input: {
        kind: 'startup',
        segments: {
          stableInstructions: 'STABLE INSTRUCTIONS',
          dynamicContext: 'CURRENT ENTITY CONTEXT\n\n---\n\nHANDLER ENTITY CONTEXT',
          userInput: 'CURRENT USER INPUT',
        },
      },
    });
  });

  it('keeps an ordinary resume turn-only', () => {
    expect(
      projectProviderSessionStartupInput({
        decision: 'resume',
        prompt: 'FOLLOW UP',
        startupPromptInput,
      }),
    ).toEqual({
      action: 'resume',
      delivered: false,
      input: { kind: 'turn', prompt: 'FOLLOW UP' },
    });
  });

  it('preserves unscoped prompts for mint and remint decisions', () => {
    expect(
      projectProviderSessionStartupInput({
        decision: 'first-turn-mint',
        prompt: 'TURN INPUT',
        startupPromptInput: null,
      }),
    ).toEqual({
      action: 'mint',
      delivered: false,
      input: { kind: 'turn', prompt: 'TURN INPUT' },
    });
  });
});

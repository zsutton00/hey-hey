import { describe, it, expect } from 'vitest';
import { buildDesignDocRefinerPrompt } from './design-doc-refiner-prompt';
import type { DesignDocRefinerPromptInput } from './types';

const makeInput = (
  overrides?: Partial<DesignDocRefinerPromptInput>,
): DesignDocRefinerPromptInput => ({
  designDoc: {
    id: 'dd-abc-123',
    title: 'Auth Middleware Redesign',
    sections: {
      'Problem Statement': 'The current auth middleware stores session tokens insecurely.',
      'Proposed Approach': 'Replace with JWT-based stateless auth.',
      'Alternatives Considered': 'Session cookies, OAuth2 proxy.',
    },
  },
  ...overrides,
});

describe('buildDesignDocRefinerPrompt', () => {
  it('includes the design doc details in the prompt', () => {
    const result = buildDesignDocRefinerPrompt(makeInput());
    expect(result).toContain('Auth Middleware Redesign');
    expect(result).toContain('dd-abc-123');
    expect(result).toContain('stores session tokens insecurely');
    expect(result).toContain('JWT-based stateless auth');
  });

  it('formats all sections from the payload', () => {
    const result = buildDesignDocRefinerPrompt(makeInput());
    expect(result).toContain('### Problem Statement');
    expect(result).toContain('### Proposed Approach');
    expect(result).toContain('### Alternatives Considered');
  });

  it('directs the agent to fetch writing standards via get_tool_guidance for edit_design_doc', () => {
    const result = buildDesignDocRefinerPrompt(makeInput());
    expect(result).toContain('Writing Standards');
    expect(result).toContain('get_tool_guidance');
    expect(result).toContain('"edit_design_doc"');
  });

  it('does not embed inline writing standards content in the prompt', () => {
    const result = buildDesignDocRefinerPrompt(makeInput());
    expect(result).not.toContain('Problem statements describe what is wrong');
    expect(result).not.toContain('Trade-offs should be explicit');
    expect(result).not.toContain('What a design document is');
  });

  it('includes behavior rules', () => {
    const result = buildDesignDocRefinerPrompt(makeInput());
    expect(result).toContain('BEHAVIOR — STRICT RULES');
    expect(result).toContain('Never respond with just an acknowledgement');
  });

  it('includes context when relatedEntities are provided', () => {
    const result = buildDesignDocRefinerPrompt(
      makeInput({
        relatedEntities: [
          {
            displayName: 'Auth Service',
            entityType: 'SERVICE',
            entityId: 'svc-123',
            status: 'ACTIVE',
            relationship: 'mentions',
          },
        ],
      }),
    );
    expect(result).toContain('## CONTEXT');
    expect(result).toContain('Auth Service');
    expect(result).toContain('[mentions]');
  });

  it('renders agentSessions in their own block', () => {
    const result = buildDesignDocRefinerPrompt(
      makeInput({
        agentSessions: [
          {
            displayName: 'Refactor pass',
            entityType: 'AGENT_SESSION',
            entityId: 'sess-1',
            status: 'COMPLETED',
          },
        ],
      }),
    );
    expect(result).toContain('Agent sessions');
    expect(result).toContain('Refactor pass');
  });

  it('renders sibling-via-parent entries with a via path', () => {
    const result = buildDesignDocRefinerPrompt(
      makeInput({
        relatedEntities: [
          {
            displayName: 'Sibling Task',
            entityType: 'TASK',
            entityId: 'task-sib-1',
            relationship: 'sibling-via-parent',
            via: [
              {
                displayName: 'Parent Feature',
                entityType: 'TASK',
                entityId: 'feat-1',
                relationship: 'sibling-via-parent',
              },
            ],
          },
        ],
      }),
    );
    expect(result).toContain('[sibling-via-parent]');
    expect(result).toContain('via Parent Feature');
  });

  it('omits context section when no relatedEntities, agentSessions, or proposals', () => {
    const result = buildDesignDocRefinerPrompt(makeInput());
    expect(result).not.toContain('## CONTEXT');
  });

  it('handles design doc with no sections', () => {
    const result = buildDesignDocRefinerPrompt(
      makeInput({
        designDoc: { id: 'dd-empty', title: 'Empty Doc', sections: {} },
      }),
    );
    expect(result).toContain('Empty Doc');
    expect(result).not.toContain('###');
  });

  it('omits the structural-correction reflection rule', () => {
    const result = buildDesignDocRefinerPrompt(makeInput());
    expect(result).not.toContain('## Structural-Correction Reflection');
  });
});

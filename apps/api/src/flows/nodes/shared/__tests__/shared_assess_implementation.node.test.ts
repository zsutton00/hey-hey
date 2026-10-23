import { SharedAssessImplementationNode } from '../shared-assess-implementation.node';
import { SHARED_NODES } from '../../../constants/node-ids';
import { NodeType } from '../../../../types/flow-internal.types';

describe('Shared Assessment Implementation Node', () => {
  const node = new SharedAssessImplementationNode();

  it('should have correct basic properties', () => {
    expect(node.id).toBe(SHARED_NODES.ASSESS_IMPLEMENTATION);
    expect(node.type).toBe(NodeType.LLM_QUESTIONS);
    expect(node.title).toBe('Current Implementation Assessment');
  });

  it('should have prompt configuration', () => {
    expect((node as any).promptConfig).toBeDefined();
    expect((node as any).promptConfig.systemPromptTemplate).toBeDefined();
    expect((node as any).promptConfig.temperature).toBe(0.7);
  });

  it('should include project maturity considerations in prompt', () => {
    const prompt = (node as any).promptConfig.systemPromptTemplate;

    // Check that it mentions different project maturity levels
    expect(prompt).toContain('EARLY projects');
    expect(prompt).toContain('MATURE projects');
    expect(prompt).toContain('LEGACY projects');

    // Check that it focuses on existing work assessment
    expect(prompt).toContain('existing project');
    expect(prompt).toContain('current implementation');
    expect(prompt).toContain('already been built');
  });

  it('should have proper response schema for LLM_QUESTIONS nodes', () => {
    const responseSchema = (node as any).promptConfig.responseSchema;
    expect(responseSchema).toBeDefined();

    // Test that schema validates correctly structured response
    const validResponse = {
      category: 'technology' as const,
      selectedExistingSubfacetNames: [],
      proposedNewSubfacetName: null,
      proposedNewSubfacetConfidence: null,
      proposedNewSubfacetRationale: null,
      subfacets: ['platform readiness'],
      summary: 'Current system has an early platform foundation.',
      priority_hint: {
        urgency: 'medium',
        importance: 'medium',
        effort: 'small',
        blocking_state: 'independent',
      },
      next_step_hint: 'Clarify system boundaries and existing components.',
      type: 'QUESTIONS' as const,
      response: 'Test response',
      detectedIntent: 'assess_implementation',
      intentConfidence: 0.9,
      uiElements: [
        {
          id: 'test_question',
          type: 'textarea' as const,
          label: 'Test question',
          required: true,
          influences: [] as any[],
        },
      ],
      insights: [] as any[],
    };

    expect(() => responseSchema.parse(validResponse)).not.toThrow();
  });

  it('should have nextNode set correctly', () => {
    expect((node as any).nextNode).toBeUndefined();
  });
});

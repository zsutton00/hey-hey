import { planGenerationAgent } from '../plan-generation.agent';
import { type AgentDefinition } from '../initiative-analyzer.agent';

describe('Plan Generation Agent Definition', () => {
  it('should expose the expected onboarding plan generation id', () => {
    expect(planGenerationAgent.id).toBe('onboarding-plan-generator');
  });

  it('should define workflow output contract with plans array item fields', () => {
    const presentationStep = planGenerationAgent.workflow.steps.find(
      (step) => step.id === 'present_plan_options',
    );
    expect(presentationStep).toBeDefined();
    expect(presentationStep?.type).toBe('presentation');
    expect(presentationStep?.config.template).toMatchObject({
      detectedIntent: 'plan_generation_complete',
      systemMessage: expect.objectContaining({
        message: 'string',
        uiElements: 'array<object>',
      }),
      plans: [
        expect.objectContaining({
          title: 'string',
          description: 'string',
          outcome: 'string',
        }),
      ],
    });
  });

  it('should satisfy the shared AgentDefinition contract', () => {
    const typedAgent: AgentDefinition = planGenerationAgent;
    expect(typedAgent).toBeDefined();
    expect(typedAgent.metadata.category).toBe('onboarding');
    expect(typedAgent.metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

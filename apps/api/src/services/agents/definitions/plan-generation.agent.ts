import { type AgentDefinition } from './initiative-analyzer.agent';

export const planGenerationAgent: AgentDefinition = {
  id: 'onboarding-plan-generator',
  name: 'Onboarding Plan Generation Agent',
  description:
    'Generates concise initial plans during onboarding with title, description, and outcome fields',
  workflow: {
    steps: [
      {
        id: 'generate_initial_plans',
        type: 'llm_generation',
        config: {
          systemPrompt: `You generate concise onboarding plans for initial execution.

Output must contain a plans array with this exact item shape:
Array<{ title: string; description: string; outcome: string }>

Rules:
- Generate 2-4 plans.
- Keep language generic and actionable.
- Do not include proper names unless explicitly provided by the user.
- Each plan must include title, description, and outcome with non-empty strings.

Return JSON with:
{
  "detectedIntent": "plan_generation_complete",
  "systemMessage": {
    "message": "short summary message for user",
    "uiElements": []
  },
  "plans": [
    { "title": "...", "description": "...", "outcome": "..." }
  ]
}`,
          temperature: 0.5,
          max_tokens: 2500,
          response_format: 'json',
        },
      },
      {
        id: 'present_plan_options',
        type: 'presentation',
        config: {
          template: {
            detectedIntent: 'plan_generation_complete',
            systemMessage: {
              message: 'string',
              uiElements: 'array<object>',
            },
            plans: [
              {
                title: 'string',
                description: 'string',
                outcome: 'string',
              },
            ],
          },
        },
      },
    ],
  },
  timeout: 60000,
  max_iterations: 3,
  metadata: {
    category: 'onboarding',
    version: '1.0.0',
    tags: ['onboarding', 'planning', 'plan-generation'],
  },
};

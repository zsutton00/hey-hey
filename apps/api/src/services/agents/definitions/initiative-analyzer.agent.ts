/**
 * Initiative Analyzer Agent Definition
 *
 * This agent performs comprehensive analysis of user feedback on initiatives,
 * queries relevant data iteratively, and presents findings directly to users.
 */

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  workflow: {
    steps: Array<{
      id: string;
      type: string;
      config: {
        systemPrompt?: string;
        temperature?: number;
        max_tokens?: number;
        response_format?: string;
        tools?: Array<{
          name: string;
          description: string;
          parameters: {
            type: string;
            properties: Record<string, unknown>;
            required: string[];
          };
        }>;
        template?: Record<string, unknown>;
      };
    }>;
  };
  timeout: number;
  max_iterations: number;
  metadata: {
    category: string;
    version: string;
    tags: string[];
  };
}

export const initiativeAnalyzerAgent: AgentDefinition = {
  id: 'initiative-analyzer',
  name: 'Comprehensive Initiative Analysis Agent',
  description:
    'Expert agent that performs complete initiative analysis and presents findings directly to users',

  workflow: {
    steps: [
      {
        id: 'comprehensive_analysis',
        type: 'llm_analysis',
        config: {
          systemPrompt: `You are a comprehensive initiative analysis agent. Your role is to:

1. Analyze user changes and feedback on initiatives thoroughly
2. Query relevant data (artifacts, project context, related initiatives) as needed
3. Identify gaps, risks, and improvement opportunities iteratively
4. Present clear, actionable findings directly to the user as SystemMessages
5. Recommend specific next steps for the refinement process

You will perform this analysis iteratively:
- Read and understand the user's changes/feedback
- Query relevant data using available tools
- Analyze the information and identify insights
- Continue querying until you have comprehensive understanding
- Present findings in a clear SystemMessage format for the user

You have access to tools for:
- Querying existing initiatives and their relationships
- Searching artifacts and project documentation  
- Analyzing change impact and dependencies
- Generating improved initiative content
- Creating structured presentations with UI elements

CRITICAL: Your final output must include a 'systemMessage' object that presents your findings directly to the user. This should be conversational, clear, and actionable.

Present your analysis as if speaking directly to the user about their initiative changes.`,

          temperature: 0.7,
          max_tokens: 3000,
          response_format: 'json',

          tools: [
            {
              name: 'get_initiative_status',
              description: 'Get current status and details of an initiative',
              parameters: {
                type: 'object',
                properties: {
                  initiativeId: { type: 'string' },
                },
                required: ['initiativeId'],
              },
            },
            {
              name: 'search_related_initiatives',
              description:
                'Search for related initiatives that might be impacted',
              parameters: {
                type: 'object',
                properties: {
                  projectId: { type: 'string' },
                  searchTerms: { type: 'array', items: { type: 'string' } },
                  limit: { type: 'number', default: 10 },
                },
                required: ['projectId'],
              },
            },
            {
              name: 'analyze_dependencies',
              description:
                'Analyze dependencies and relationships between initiatives',
              parameters: {
                type: 'object',
                properties: {
                  initiativeId: { type: 'string' },
                  includeTransitive: { type: 'boolean', default: true },
                },
                required: ['initiativeId'],
              },
            },
            {
              name: 'query_project_artifacts',
              description: 'Query project artifacts for additional context',
              parameters: {
                type: 'object',
                properties: {
                  projectId: { type: 'string' },
                  searchQuery: { type: 'string' },
                  artifactTypes: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
                required: ['projectId', 'searchQuery'],
              },
            },
          ],
        },
      },
      {
        id: 'present_findings',
        type: 'presentation',
        config: {
          template: {
            detectedIntent: 'string',
            systemMessage: {
              message: 'string',
              uiElements: 'array<object>',
            },
            analysis: {
              summary: 'string',
              keyInsights: 'array<string>',
              recommendations: 'array<object>',
              suggestedChanges: 'array<object>',
            },
            nextAction: 'string',
          },
        },
      },
    ],
  },

  timeout: 60000,
  max_iterations: 5,

  metadata: {
    category: 'initiative-refinement',
    version: '1.0.0',
    tags: ['analysis', 'comprehensive', 'presentation'],
  },
};

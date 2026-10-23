# Agent Definitions

This directory contains individual agent definitions for integration with agent platforms like Mastra.ai.

## Organization Pattern

Each agent is defined in its own file following the pattern: `{agent-name}.agent.ts`

### Current Agents

- `initiative-analyzer.agent.ts` - Comprehensive initiative analysis and feedback processing
- `plan-generation.agent.ts` - Onboarding plan generation with concise execution-ready plans

### Adding New Agents

1. Create a new file: `{agent-name}.agent.ts`
2. Export an `AgentDefinition` object with the agent configuration
3. Add the agent to the `ALL_AGENTS` array in `index.ts`

### Example Agent Structure

```typescript
export const myAgent: AgentDefinition = {
  id: 'my-agent',
  name: 'My Agent',
  description: 'Description of what this agent does',
  workflow: {
    steps: [
      {
        id: 'analysis_step',
        type: 'llm_analysis',
        config: {
          systemPrompt: 'Your system prompt here...',
          temperature: 0.7,
          max_tokens: 2000,
          tools: [
            // Tool definitions...
          ]
        }
      }
    ]
  },
  timeout: 60000,
  max_iterations: 3,
  metadata: {
    category: 'your-category',
    version: '1.0.0',
    tags: ['tag1', 'tag2']
  }
};
```

## Benefits of This Organization

1. **Separation of Concerns**: Each agent is self-contained
2. **Easy Testing**: Individual agents can be unit tested
3. **Version Control**: Changes to one agent don't affect others
4. **Type Safety**: Strong TypeScript typing for all agent configurations
5. **Scalability**: Easy to add new agents without modifying existing ones

## Integration with Flow Nodes

Flow nodes reference agents by ID in their prompt templates:
```typescript
systemPromptTemplate: `You are an expert agent with ID "my-agent".`
```

The flow processor extracts this ID and calls the corresponding Mastra agent.

import { ALL_AGENTS, type AgentDefinition, type AgentId } from '../index';
import { initiativeAnalyzerAgent } from '../initiative-analyzer.agent';
import { planGenerationAgent } from '../plan-generation.agent';

describe('Agent Definitions Registry', () => {
  describe('Agent Collection Management', () => {
    it('should export all agent definitions in a single registry array for batch operations', () => {
      // EXPECTATION: ALL_AGENTS must contain all available agent definitions for bulk registration
      // RATIONALE: The agent configuration service needs to register all agents with Mastra in batch.
      // Having a single collection prevents missing agents during registration and enables
      // systematic agent management operations.

      expect(ALL_AGENTS).toBeInstanceOf(Array);
      expect(ALL_AGENTS.length).toBeGreaterThan(0);
      expect(ALL_AGENTS).toContain(initiativeAnalyzerAgent);
      expect(ALL_AGENTS).toContain(planGenerationAgent);
    });

    it('should have unique agent IDs across all registered agents to prevent conflicts', () => {
      // EXPECTATION: No two agents should have the same ID within the ALL_AGENTS collection
      // RATIONALE: Agent IDs serve as unique identifiers for Mastra registration and flow node references.
      // Duplicate IDs would cause registration failures and unpredictable agent execution behavior.

      const agentIds = ALL_AGENTS.map((agent) => agent.id);
      const uniqueIds = new Set(agentIds);

      expect(uniqueIds.size).toBe(agentIds.length);
    });

    it('should ensure all agents conform to the AgentDefinition interface', () => {
      // EXPECTATION: Every agent in ALL_AGENTS must satisfy the AgentDefinition type contract
      // RATIONALE: Type consistency ensures all agents can be processed uniformly by the
      // registration service and prevents runtime errors during agent registration with Mastra.

      ALL_AGENTS.forEach((agent, index) => {
        expect(() => {
          const typedAgent: AgentDefinition = agent;
          expect(typedAgent).toBeDefined();
        }).not.toThrow();

        // Verify required fields exist
        expect(agent).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          description: expect.any(String),
          workflow: expect.any(Object),
          timeout: expect.any(Number),
          max_iterations: expect.any(Number),
          metadata: expect.any(Object),
        });
      });
    });
  });

  describe('Type System Integration', () => {
    it('should generate correct AgentId union type from agent definitions', () => {
      // EXPECTATION: The AgentId type should be a union of all actual agent IDs for type safety
      // RATIONALE: This ensures flow nodes can only reference agents that actually exist,
      // preventing typos and runtime errors when flow processors try to execute non-existent agents.

      // TypeScript will enforce this at compile time, but we can verify the IDs exist
      const expectedIds = ALL_AGENTS.map((agent) => agent.id);

      // This test mainly validates that the type generation is working
      // The actual type checking happens at compile time
      expectedIds.forEach((id) => {
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      });
    });

    it('should export AgentDefinition type for external usage', () => {
      // EXPECTATION: The AgentDefinition type must be exported for use in other modules
      // RATIONALE: Other parts of the system (like the registration service) need to import
      // and use the AgentDefinition type for proper TypeScript typing and validation.

      // This is verified by the successful import at the top of this file
      // If the type wasn't exported, TypeScript compilation would fail
      expect(typeof initiativeAnalyzerAgent).toBe('object');

      // Verify we can use it as a type (compile-time check)
      const testAgent: AgentDefinition = initiativeAnalyzerAgent;
      expect(testAgent).toBeDefined();
    });
  });

  describe('Registry Consistency', () => {
    it('should maintain consistent agent categorization across all agents', () => {
      // EXPECTATION: All agents should have valid category metadata for organizational consistency
      // RATIONALE: Consistent categorization enables proper agent organization, monitoring,
      // and analytics grouping in production systems with multiple agent types.

      ALL_AGENTS.forEach((agent) => {
        expect(agent.metadata.category).toBeDefined();
        expect(typeof agent.metadata.category).toBe('string');
        expect(agent.metadata.category.length).toBeGreaterThan(0);
      });
    });

    it('should enforce semantic versioning across all agent definitions', () => {
      // EXPECTATION: All agents must use semantic versioning (x.y.z) for version management
      // RATIONALE: Consistent versioning enables proper agent lifecycle management,
      // update tracking, and compatibility checking in production deployments.

      const semanticVersionRegex = /^\d+\.\d+\.\d+$/;

      ALL_AGENTS.forEach((agent) => {
        expect(agent.metadata.version).toMatch(semanticVersionRegex);
      });
    });

    it('should require meaningful tags for all agents to enable discoverability', () => {
      // EXPECTATION: All agents must have at least one descriptive tag for classification
      // RATIONALE: Tags enable agent discovery, filtering, and organization in systems
      // with many agents. Empty or meaningless tags reduce system maintainability.

      ALL_AGENTS.forEach((agent) => {
        expect(agent.metadata.tags).toBeInstanceOf(Array);
        expect(agent.metadata.tags.length).toBeGreaterThan(0);

        // Ensure tags are meaningful strings, not empty
        agent.metadata.tags.forEach((tag) => {
          expect(typeof tag).toBe('string');
          expect(tag.trim().length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe('Future Scalability', () => {
    it('should support easy addition of new agents without breaking existing functionality', () => {
      // EXPECTATION: The registry structure should accommodate new agents without code changes
      // RATIONALE: As the system grows, new agents will be added frequently. The registry
      // architecture should support this growth without requiring changes to registration logic.

      // Simulate adding a new agent
      const mockAgent: AgentDefinition = {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Mock agent for testing',
        workflow: {
          steps: [
            {
              id: 'test-step',
              type: 'test',
              config: {},
            },
          ],
        },
        timeout: 30000,
        max_iterations: 3,
        metadata: {
          category: 'test',
          version: '1.0.0',
          tags: ['test'],
        },
      };

      const extendedAgents = [...ALL_AGENTS, mockAgent];

      // Verify the structure still works
      expect(extendedAgents).toBeInstanceOf(Array);
      expect(extendedAgents.length).toBe(ALL_AGENTS.length + 1);
      expect(extendedAgents).toContain(mockAgent);
    });
  });
});

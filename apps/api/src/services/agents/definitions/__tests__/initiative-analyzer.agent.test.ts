import {
  initiativeAnalyzerAgent,
  type AgentDefinition,
} from '../initiative-analyzer.agent';

describe('Initiative Analyzer Agent Definition', () => {
  describe('Agent Configuration Validation', () => {
    it('should have a properly structured agent definition that can be registered with Mastra', () => {
      // EXPECTATION: The agent definition must be a valid configuration object that Mastra can register and execute
      // RATIONALE: Agent definitions serve as the contract between our flow system and Mastra.ai
      // They must contain all necessary fields for Mastra to create and run the agent workflow.

      expect(initiativeAnalyzerAgent).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        description: expect.any(String),
        workflow: expect.objectContaining({
          steps: expect.any(Array),
        }),
        timeout: expect.any(Number),
        max_iterations: expect.any(Number),
        metadata: expect.objectContaining({
          category: expect.any(String),
          version: expect.any(String),
          tags: expect.any(Array),
        }),
      });
    });

    it('should have the correct agent ID that matches flow node references', () => {
      // EXPECTATION: The agent ID must be 'initiative-analyzer' to match flow node agentId references
      // RATIONALE: Flow nodes reference agents by ID, so this must be consistent across the system
      // to enable proper agent execution when the workflow processor encounters AGENT nodes.

      expect(initiativeAnalyzerAgent.id).toBe('initiative-analyzer');
    });
  });

  describe('Workflow Configuration', () => {
    it('should have a comprehensive analysis step with required tools for initiative analysis', () => {
      // EXPECTATION: The agent must have analysis capabilities with tools for querying initiatives, artifacts, and dependencies
      // RATIONALE: Initiative refinement requires the agent to gather context from multiple sources
      // (existing initiatives, project artifacts, dependencies) to provide meaningful analysis and recommendations.

      const analysisStep = initiativeAnalyzerAgent.workflow.steps.find(
        (step) => step.id === 'comprehensive_analysis',
      );

      expect(analysisStep).toBeDefined();
      expect(analysisStep?.type).toBe('llm_analysis');
      expect(analysisStep?.config.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'get_initiative_status',
            description: expect.stringContaining('initiative'),
          }),
          expect.objectContaining({
            name: 'search_related_initiatives',
            description: expect.stringContaining('related initiatives'),
          }),
          expect.objectContaining({
            name: 'analyze_dependencies',
            description: expect.stringContaining('dependencies'),
          }),
          expect.objectContaining({
            name: 'query_project_artifacts',
            description: expect.stringContaining('artifacts'),
          }),
        ]),
      );
    });

    it('should have a presentation step that formats findings for user consumption', () => {
      // EXPECTATION: The agent must have a presentation step that formats analysis results into user-friendly SystemMessages
      // RATIONALE: Raw analysis results from LLMs are not suitable for direct user consumption.
      // The presentation step transforms technical analysis into conversational, actionable feedback.

      const presentationStep = initiativeAnalyzerAgent.workflow.steps.find(
        (step) => step.id === 'present_findings',
      );

      expect(presentationStep).toBeDefined();
      expect(presentationStep?.type).toBe('presentation');
      expect(presentationStep?.config.template).toMatchObject({
        detectedIntent: 'string',
        systemMessage: expect.objectContaining({
          message: 'string',
          uiElements: 'array<object>',
        }),
        analysis: expect.objectContaining({
          summary: 'string',
          keyInsights: 'array<string>',
          recommendations: 'array<object>',
        }),
        nextAction: 'string',
      });
    });

    it('should have appropriate timeout and iteration limits for complex analysis tasks', () => {
      // EXPECTATION: The agent should have sufficient time and iteration limits for comprehensive analysis
      // RATIONALE: Initiative analysis involves multiple tool calls, data gathering, and iterative reasoning.
      // Insufficient limits would cause premature timeouts, while excessive limits would waste resources.

      expect(initiativeAnalyzerAgent.timeout).toBeGreaterThan(30000); // At least 30 seconds
      expect(initiativeAnalyzerAgent.timeout).toBeLessThanOrEqual(120000); // Max 2 minutes
      expect(initiativeAnalyzerAgent.max_iterations).toBeGreaterThan(1); // Must allow iterative analysis
      expect(initiativeAnalyzerAgent.max_iterations).toBeLessThanOrEqual(10); // Prevent infinite loops
    });
  });

  describe('Tool Parameter Validation', () => {
    it('should have properly structured tool parameters that can be validated at runtime', () => {
      // EXPECTATION: All agent tools must have valid parameter schemas for runtime validation
      // RATIONALE: Mastra validates tool parameters before execution. Invalid schemas cause runtime failures
      // when the agent attempts to use tools, breaking the entire initiative refinement flow.

      const analysisStep = initiativeAnalyzerAgent.workflow.steps.find(
        (step) => step.id === 'comprehensive_analysis',
      );

      analysisStep?.config.tools?.forEach((tool) => {
        expect(tool.parameters).toMatchObject({
          type: 'object',
          properties: expect.any(Object),
          required: expect.any(Array),
        });

        // Ensure required fields are actually defined in properties
        tool.parameters.required.forEach((requiredField) => {
          expect(tool.parameters.properties).toHaveProperty(requiredField);
        });
      });
    });

    it('should have initiative-specific tool parameters for proper context passing', () => {
      // EXPECTATION: Tools must accept initiative and project context parameters
      // RATIONALE: Initiative analysis requires specific context (initiativeId, projectId) to function correctly.
      // Missing these parameters would cause the agent to operate without proper context.

      const analysisStep = initiativeAnalyzerAgent.workflow.steps.find(
        (step) => step.id === 'comprehensive_analysis',
      );

      const initiativeStatusTool = analysisStep?.config.tools?.find(
        (tool) => tool.name === 'get_initiative_status',
      );

      expect(initiativeStatusTool?.parameters.properties).toHaveProperty(
        'initiativeId',
      );
      expect(initiativeStatusTool?.parameters.required).toContain(
        'initiativeId',
      );

      const searchTool = analysisStep?.config.tools?.find(
        (tool) => tool.name === 'search_related_initiatives',
      );

      expect(searchTool?.parameters.properties).toHaveProperty('projectId');
      expect(searchTool?.parameters.required).toContain('projectId');
    });
  });

  describe('Metadata Configuration', () => {
    it('should have proper categorization and versioning for agent management', () => {
      // EXPECTATION: Agent metadata must include category, version, and tags for proper classification
      // RATIONALE: In production systems with many agents, proper metadata enables:
      // - Agent discovery and organization
      // - Version management and updates
      // - Monitoring and analytics grouping

      expect(initiativeAnalyzerAgent.metadata.category).toBe(
        'initiative-refinement',
      );
      expect(initiativeAnalyzerAgent.metadata.version).toMatch(
        /^\d+\.\d+\.\d+$/,
      ); // Semantic versioning
      expect(initiativeAnalyzerAgent.metadata.tags).toBeInstanceOf(Array);
      expect(initiativeAnalyzerAgent.metadata.tags.length).toBeGreaterThan(0);
    });
  });

  describe('TypeScript Type Compliance', () => {
    it('should satisfy the AgentDefinition interface completely', () => {
      // EXPECTATION: The agent definition must conform to the AgentDefinition TypeScript interface
      // RATIONALE: Type compliance ensures consistency across all agent definitions and prevents
      // runtime errors when the agent registry processes agent configurations.

      // This test passes by virtue of TypeScript compilation, but we can also do runtime checks
      const agentDef: AgentDefinition = initiativeAnalyzerAgent;

      expect(agentDef).toBeDefined();
      expect(typeof agentDef.id).toBe('string');
      expect(typeof agentDef.name).toBe('string');
      expect(typeof agentDef.description).toBe('string');
      expect(typeof agentDef.workflow).toBe('object');
      expect(typeof agentDef.timeout).toBe('number');
      expect(typeof agentDef.max_iterations).toBe('number');
      expect(typeof agentDef.metadata).toBe('object');
    });
  });
});

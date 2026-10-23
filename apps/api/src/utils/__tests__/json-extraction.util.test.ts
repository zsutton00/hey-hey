import { JsonExtractionUtil } from '../json-extraction.util';

describe('JsonExtractionUtil', () => {
  describe('extractJSONFromResponse', () => {
    it('should extract JSON from ```json code blocks', () => {
      const input = `\`\`\`json
{
  "nextNodeId": "setup_integrations",
  "reasoning": "Test reasoning",
  "confidence": 0.95
}
\`\`\``;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);
      const parsed = JSON.parse(result);

      expect(parsed.nextNodeId).toBe('setup_integrations');
      expect(parsed.reasoning).toBe('Test reasoning');
      expect(parsed.confidence).toBe(0.95);
    });

    it('should extract JSON from generic ``` code blocks if content is valid JSON', () => {
      const input = `\`\`\`
{
  "status": "success",
  "data": {"id": 123}
}
\`\`\``;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);
      const parsed = JSON.parse(result);

      expect(parsed.status).toBe('success');
      expect(parsed.data.id).toBe(123);
    });

    it('should not extract from generic ``` code blocks if content is not valid JSON', () => {
      const input = `\`\`\`
This is not JSON content
Just some text
\`\`\``;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);

      expect(result).toBe(input.trim());
    });

    it('should extract JSON from mixed content with explanatory text', () => {
      const input = `Looking at the conversation history, I can see that the user has indicated they are working on a "greenfield" project - specifically mentioning they are "starting from scratch" with a new e-commerce platform.

The user's explicit statement about project maturity being "greenfield" and starting from scratch clearly indicates this is a new project that needs technical architecture definition rather than assessment of existing systems.

\`\`\`json
{
  "nextNodeId": "setup_integrations",
  "reasoning": "User explicitly indicated 'greenfield' project maturity and mentioned starting from scratch with a new e-commerce platform. This aligns with the Technical Discovery for Greenfield Projects path, which is appropriate for defining technical architecture for new projects.",
  "confidence": 0.95
}
\`\`\``;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);
      const parsed = JSON.parse(result);

      expect(parsed.nextNodeId).toBe('setup_integrations');
      expect(parsed.reasoning).toContain('greenfield');
      expect(parsed.confidence).toBe(0.95);
    });

    it('should handle JSON without closing ``` when at end of response', () => {
      const input = `Some explanation text here.

\`\`\`json
{
  "result": "incomplete",
  "success": true
}`;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);
      const parsed = JSON.parse(result);

      expect(parsed.result).toBe('incomplete');
      expect(parsed.success).toBe(true);
    });

    it('should return original content when no JSON patterns are found', () => {
      const input = 'This is just plain text with no JSON content';

      const result = JsonExtractionUtil.extractJSONFromResponse(input);

      expect(result).toBe(input);
    });

    it('should handle already clean JSON without code blocks', () => {
      const input = `{
  "clean": "json",
  "no_blocks": true
}`;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);
      const parsed = JSON.parse(result);

      expect(parsed.clean).toBe('json');
      expect(parsed.no_blocks).toBe(true);
    });

    it('should handle empty or whitespace-only input', () => {
      expect(JsonExtractionUtil.extractJSONFromResponse('')).toBe('');
      expect(JsonExtractionUtil.extractJSONFromResponse('   ')).toBe('');
      expect(JsonExtractionUtil.extractJSONFromResponse('\n\t ')).toBe('');
    });

    it('should handle malformed code blocks gracefully', () => {
      const input = `\`\`\`json
{
  "malformed": "json"
  "missing_comma": true
}
\`\`\``;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);

      // Should extract the content even if it's malformed JSON
      // The calling code will handle the JSON parsing error
      expect(result).toContain('"malformed": "json"');
      expect(result).toContain('"missing_comma": true');
    });

    it('should preserve whitespace and formatting in extracted JSON', () => {
      const input = `\`\`\`json
{
  "formatted": {
    "nested": "object",
    "array": [
      1,
      2,
      3
    ]
  }
}
\`\`\``;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);

      expect(result).toContain('  "nested": "object"');
      expect(result).toContain('    ]');
    });

    it('should handle multiple code blocks by extracting the first JSON one', () => {
      const input = `Here's some code:

\`\`\`javascript
console.log('not json');
\`\`\`

And here's the JSON:

\`\`\`json
{
  "target": "this one",
  "should": "be extracted"
}
\`\`\`

\`\`\`json
{
  "this": "should not be extracted"
}
\`\`\``;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);
      const parsed = JSON.parse(result);

      expect(parsed.target).toBe('this one');
      expect(parsed.should).toBe('be extracted');
      expect(parsed.this).toBeUndefined();
    });

    it('should handle newlines', () => {
      const actualRespose = {
        content:
          '{\n  "type": "ARTIFACTS_GENERATION",\n  "followUpNeeded": false,\n  "followUpQuestions": [],\n  "response": "Thank you for providing the detailed context on your knowledge management platform project. Based on the information shared, I\'ve extracted the following key insights that can help inform future initiatives:",\n  "insights": [\n    {\n      "category": "userGoals",\n      "title": "Comprehensive Knowledge Management Platform",\n      "confidence": 0.9,\n      "reasoning": "The user explicitly described the primary objective of building a knowledge management platform that supports various stakeholders across the product lifecycle, from PMs to developers to management.",\n      "content": "The key user goal is to build a comprehensive knowledge management platform that helps teams find, share, and leverage institutional knowledge. This platform aims to assist product managers, developers, and business leaders by providing a shared space for planning, design, and progress tracking throughout the product lifecycle.",\n      "influences": [\n        {\n          "artifact_id": "90a9fd55-2f8f-4571-a448-721e907bedcc",\n          "reasoning": "The user provided a detailed description of the core functionality and target users for the knowledge management platform."\n        },\n        {\n          "artifact_id": "2b63d4b2-6d84-4ad5-8963-fec3903ce61f",\n          "reasoning": "The user further elaborated on the specific user problems and workflows the platform aims to address across different roles."\n        }\n      ],\n      "tags": [\n        "goal",\n        "objective"\n      ]\n    },\n    {\n      "category": "technicalAnalysis",\n      "title": "Integrated AI/ML-Powered Architecture",\n      "confidence": 0.8,\n      "reasoning": "The user mentioned several key technical components and integration requirements, indicating a complex, AI/ML-driven architecture.",\n      "content": "The knowledge management platform will require an integrated, web-based architecture with several AI and machine learning components, including:\n- Vector search for artifact retrieval\n- Graph-based relationships and knowledge modeling\n- Integration with large language models (LLMs) for design assistance, prompting, and summarization\n- Event-driven workflows and real-time collaboration features",\n      "influences": [\n        {\n          "artifact_id": "a1fc9fb0-82b3-47e9-91a8-f8ae207619a8",\n          "reasoning": "The user identified the key technical challenge of integrating with newer, less deterministic AI/ML technologies."\n        },\n        {\n          "artifact_id": "61bf048d-72a0-44f5-b1ba-1f32d045a0e9",\n          "reasoning": "The user provided details on the established technical stack and architectural patterns, including React, Node.js, Temporal.io, vector search, and graph databases."\n        }\n      ],\n      "tags": [\n        "technical",\n        "architecture"\n      ]\n    },\n    {\n      "category": "businessContext",\n      "title": "Improved Cross-Functional Collaboration and Visibility",\n      "confidence": 0.8,\n      "reasoning": "The user described the platform\'s value proposition of enhancing collaboration and communication across different roles and teams involved in the product lifecycle.",\n      "content": "The knowledge management platform aims to improve cross-functional collaboration and visibility by providing a centralized hub for product planning, design, development, and progress tracking. This will enable better alignment and information sharing between product managers, engineers, and business leaders, ultimately driving more efficient and effective product development.",\n      "influences": [\n        {\n          "artifact_id": "90a9fd55-2f8f-4571-a448-721e907bedcc",\n          "reasoning": "The user highlighted the platform\'s goal of assisting various stakeholders, from PMs to developers to management, throughout the product lifecycle."\n        },\n        {\n          "artifact_id": "2b63d4b2-6d84-4ad5-8963-fec3903ce61f",\n          "reasoning": "The user described specific user workflows and pain points the platform aims to address, such as improving communication and understanding between different roles."\n        }\n      ],\n      "tags": [\n        "value proposition",\n        "stakeholders"\n      ]\n    },\n    {\n      "category": "integrationContext",\n      "title": "Integration with AI/ML Services and Workflows",\n      "confidence": 0.8,\n      "reasoning": "The user mentioned several key integrations and technical components required to build the knowledge management platform, including AI/ML services and event-driven workflows.",\n      "content": "The knowledge management platform will require integration with the following services and technologies:\n- Large language models (LLMs) for design assistance, prompting, and summarization\n- Vector search and graph databases for artifact retrieval and knowledge modeling\n- Event-driven workflows (e.g., Temporal.io) for managing product management processes like onboarding and initiative creation\n- Real-time collaboration features (e.g., websockets) to enable cross-functional visibility and alignment",\n      "influences": [\n        {\n          "artifact_id": "61bf048d-72a0-44f5-b1ba-1f32d045a0e9",\n          "reasoning": "The user provided details on the established technical stack and architectural patterns, including the integration of various services and technologies."\n        },\n        {\n          "artifact_id": "7a46625f-3299-4981-adf3-e992af15d570",\n          "reasoning": "The user highlighted specific integration and refinement work needed for LLM integration and other key platform features."\n        }\n      ],\n      "tags": [\n        "integration",\n        "architecture"\n      ]\n    },\n    {\n      "category": "technicalAnalysis",\n      "title": "Minimum Viable Product (MVP) Priorities",\n      "confidence": 0.7,\n      "reasoning": "The user outlined the current state of the project and the main areas that need improvement, indicating the key MVP features and requirements.",\n      "content": "Based on the user\'s feedback, the main priorities for the initial MVP of the knowledge management platform should be:\n1. Onboarding experience: Refine the user onboarding flow to provide a seamless and engaging first-time experience.\n2. Initiative creation: Improve the user interface and functionality for creating and managing product initiatives.\n3. LLM integration refinement: Validate the prompting system and output quality to ensure the AI/ML components are delivering the desired functionality.\n4. RAG (Red-Amber-Green) reporting: Enhance the conceptual RAG reporting feature to provide better visibility into project status and progress.",\n      "influences": [\n        {\n          "artifact_id": "7a46625f-3299-4981-adf3-e992af15d570",\n          "reasoning": "The user outlined the current state of the project and the main areas that need improvement, indicating the key MVP features and requirements."\n        },\n        {\n          "artifact_id": "63174653-ba72-4151-80cd-71c276964e4e",\n          "reasoning": "The user provided details on the core features and modules that have already been implemented, which can inform the MVP priorities."\n        }\n      ],\n      "tags": [\n        "MVP",\n        "requirements"\n      ]\n    }\n  ],\n  "detectedIntent": "INSIGHT_GENERATION",\n  "intentConfidence": 0.9,\n  "reasoning": "Based on the comprehensive information provided about the knowledge management platform project, I was able to extract several key insights across user goals, technical analysis, integration context, and business context. These insights can help inform the next steps and initiatives for the project."\n}',
        usage: {
          promptTokens: 2407,
          completionTokens: 1821,
          totalTokens: 4228,
        },
        requestId: 'msg_01JXWqApFddGd8xKpSqvqp8k',
      };

      const result = JsonExtractionUtil.extractJSONFromResponse(
        actualRespose.content,
      );
      const parsed = JSON.parse(result);

      expect(parsed.detectedIntent).toBe('INSIGHT_GENERATION');
      expect(Array.isArray(parsed.insights)).toBe(true);
    });

    it('should extract JSON from response with text preamble (initiatives example)', () => {
      const input = `Based on the information provided about the current state of the project, here are 4 key initiatives I would recommend:

{
  "type": "INITIATIVES",
  "response": "Based on the analysis of the current project state, I've generated a set of strategic initiatives to help move the project forward.",
  "detectedIntent": "initiative_generation_complete",
  "intentConfidence": 0.95,
  "initiatives": [
    {
      "name": "Improve Reliability of LLM Integration",
      "description": "Address the pain points with getting reliable results from the large language models (LLMs) used in the system.",
      "details": "Investigate and implement techniques to improve the consistency and accuracy of the LLM outputs, such as prompt engineering, model fine-tuning, and ensembling. Explore ways to gracefully handle LLM failures and provide meaningful fallbacks. Establish clear performance metrics and testing frameworks to validate LLM reliability.",
      "acceptanceCriteria": "- LLM-powered features demonstrate 95% accuracy and reliability in end-to-end testing\\n- Documented processes for prompt engineering and model fine-tuning\\n- Graceful error handling and fallback mechanisms implemented",
      "estimatedEffort": "large",
      "priority": "high",
      "tags": ["llm", "reliability", "performance"],
      "reasoning": "Improving the LLM integration is critical to the overall system's functionality and user experience."
    }
  ],
  "summary": {
    "totalInitiatives": 4,
    "estimatedTimeline": "6-9 months for initial delivery",
    "criticalPath": ["Improve Reliability of LLM Integration", "Implement RAG System", "Enhance Agent Capabilities"]
  }
}

The key initiatives focus on addressing the identified pain points and gaps in the current system.`;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('INITIATIVES');
      expect(parsed.detectedIntent).toBe('initiative_generation_complete');
      expect(parsed.intentConfidence).toBe(0.95);
      expect(Array.isArray(parsed.initiatives)).toBe(true);
      expect(parsed.initiatives.length).toBe(1);
      expect(parsed.initiatives[0].name).toBe(
        'Improve Reliability of LLM Integration',
      );
      expect(parsed.summary.totalInitiatives).toBe(4);
      expect(Array.isArray(parsed.summary.criticalPath)).toBe(true);
    });

    it('should extract JSON from response with complex initiatives structure', () => {
      const input = `Based on the information provided about the current state of the project, here are 4 well-structured initiatives that can help achieve the project goals:\n\n{\n  "type": "INITIATIVES",\n  "response": "Based on the project analysis, I've created a comprehensive roadmap with strategic initiatives to help move the project forward.",\n  "detectedIntent": "initiative_generation_complete",\n  "intentConfidence": 0.95,\n  "initiatives": [\n    {\n      "name": "Improve LLM Integration Reliability",\n      "description": "Enhance the integration with large language models (LLMs) to provide more reliable and consistent results.",\n      "details": "Conduct a thorough review of the current LLM integration, identify pain points, and implement improvements to address issues such as inconsistent outputs, latency, and error handling. This may involve experimenting with different LLM models, fine-tuning the models, or developing custom prompting strategies. Implement monitoring and alerting to proactively detect and address LLM-related issues.",\n      "acceptanceCriteria": "- Measurable improvement in LLM output reliability and consistency\\n- Reduction in LLM-related errors and performance issues\\n- Comprehensive monitoring and alerting system for LLM integration",\n      "estimatedEffort": "medium",\n      "priority": "high",\n      "tags": ["llm", "integration", "reliability"],\n      "reasoning": "Improving the LLM integration is a critical step to providing a robust and trustworthy system for users.",\n      "influences": [\n        {\n          "artifactId": "llm-integration-issues",\n          "reasoning": "The identified pain points with the current LLM integration informed this initiative.",\n          "reasonType": "requirement"\n        }\n      ]\n    },\n    {\n      "name": "Implement RAG (Red-Amber-Green) System",\n      "description": "Develop a comprehensive RAG (Red-Amber-Green) system to provide visibility into the health and status of the overall system.",\n      "details": "Integrate the existing graph and vector services to create a unified RAG system that can analyze and visualize the state of the system. This will include defining the various metrics and thresholds for the RAG indicators, as well as integrating the system with the agent service to proactively surface potential issues. The RAG system should be accessible through the UI and provide actionable insights to users.",\n      "acceptanceCriteria": "- Fully functional RAG system with defined metrics and thresholds\\n- Integration with graph and vector services to provide comprehensive system analysis\\n- Seamless integration with the agent service to surface potential issues\\n- Clear and intuitive visualization of the RAG indicators in the UI",\n      "estimatedEffort": "large",\n      "priority": "high",\n      "tags": ["rag", "monitoring", "observability"],\n      "reasoning": "The RAG system is a critical component to provide visibility and proactive monitoring of the overall system health, which is essential for maintaining a stable and reliable product.",\n      "influences": [\n        {\n          "artifactId": "rag-system-requirements",\n          "reasoning": "The defined requirements for the RAG system informed the scope and approach for this initiative.",\n          "reasonType": "requirement"\n        },\n        {\n          "artifactId": "agent-service-integration",\n          "reasoning": "The existing agent service integration influenced the approach to leveraging it within the RAG system.",\n          "reasonType": "context"\n        }\n      ]\n    },\n    {\n      "name": "Enhance Onboarding and Initiative Refinement UX",\n      "description": "Improve the user experience for the onboarding and initiative refinement processes.",\n      "details": "Conduct a comprehensive review of the existing onboarding and initiative refinement workflows, gathering user feedback and identifying areas for improvement. This may include enhancing the UI design, improving the information architecture, and streamlining the interaction flows. Leverage the existing websocket-based real-time updates to provide a more responsive and engaging experience. Integrate the RAG system to surface relevant system health information during these critical user journeys.",\n      "acceptanceCriteria": "- Measurable improvement in user satisfaction and task completion rates for onboarding and initiative refinement\\n- Refined UI design that aligns with the overall product branding and visual identity\\n- Seamless integration of the RAG system to provide contextual system health information\\n- Responsive and real-time updates during the user interactions",\n      "estimatedEffort": "medium",\n      "priority": "high",\n      "tags": ["ux", "onboarding", "initiative-refinement"],\n      "reasoning": "Enhancing the user experience for the core onboarding and initiative refinement processes is essential to drive user adoption and engagement with the product.",\n      "influences": [\n        {\n          "artifactId": "user-feedback-onboarding",\n          "reasoning": "User feedback on the existing onboarding process informed the scope of this initiative.",\n          "reasonType": "requirement"\n        },\n        {\n          "artifactId": "initiative-refinement-workflow",\n          "reasoning": "The current implementation of the initiative refinement workflow influenced the approach to improving the user experience.",\n          "reasonType": "context"\n        }\n      ]\n    },\n    {\n      "name": "Integrate Agents for Proactive Insights",\n      "description": "Leverage the agent service to provide proactive insights and recommendations to users.",\n      "details": "Expand the capabilities of the existing agent service to monitor the system and user interactions more proactively. This may involve developing new agent types or enhancing the existing ones to analyze data from multiple sources (e.g., graph service, vector service, user activity) and surface actionable insights. The agents should be integrated into key user journeys, such as onboarding and initiative refinement, to provide contextual recommendations and suggestions. Implement feedback loops to continuously improve the agent's performance based on user interactions.",\n      "acceptanceCriteria": "- New agent types developed and integrated into the system\\n- Agents successfully monitoring the system and user interactions to surface proactive insights\\n- Seamless integration of agents within the onboarding and initiative refinement workflows\\n- Measurable improvement in user satisfaction and task completion rates due to agent-provided insights",\n      "estimatedEffort": "large",\n      "priority": "high",\n      "tags": ["agents", "proactive-insights", "user-assistance"],\n      "reasoning": "Integrating the agent service to provide proactive insights and recommendations will greatly enhance the user experience and help users navigate the system more effectively.",\n      "influences": [\n        {\n          "artifactId": "agent-service-requirements",\n          "reasoning": "The existing requirements and capabilities of the agent service informed the approach to expanding its functionality.",\n          "reasonType": "requirement"\n        },\n        {\n          "artifactId": "user-feedback-insights",\n          "reasoning": "User feedback on the need for more proactive insights and recommendations influenced the scope of this initiative.",\n          "reasonType": "requirement"\n        }\n      ]\n    }\n  ],\n  "summary": {\n    "totalInitiatives": 4,\n    "estimatedTimeline": "6-9 months for initial delivery",\n    "criticalPath": ["Improve LLM Integration Reliability", "Implement RAG System", "Integrate Agents for Proactive Insights"]\n  }\n}`;

      const result = JsonExtractionUtil.extractJSONFromResponse(input);
      const parsed = JSON.parse(result);

      // Verify the correct structure is extracted
      expect(parsed.type).toBe('INITIATIVES');
      expect(parsed.detectedIntent).toBe('initiative_generation_complete');
      expect(parsed.intentConfidence).toBe(0.95);
      expect(Array.isArray(parsed.initiatives)).toBe(true);
      expect(parsed.initiatives.length).toBe(4);
      expect(parsed.initiatives[0].name).toBe(
        'Improve LLM Integration Reliability',
      );
      expect(parsed.summary.totalInitiatives).toBe(4);
      expect(Array.isArray(parsed.summary.criticalPath)).toBe(true);
      expect(parsed.summary.criticalPath.length).toBe(3);
    });
  });
});

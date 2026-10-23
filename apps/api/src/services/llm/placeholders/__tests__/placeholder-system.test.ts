import { PlaceholderDefinition } from '../base/placeholder-definition';
import { PlaceholderRegistry } from '../base/placeholder-registry';
import {
  PlaceholderContextBuilder,
  PlaceholderContextUtils,
} from '../base/placeholder-context';
import { PlaceholderResolver } from '../resolver.service';
import type { PlaceholderContext } from '../base/placeholder-types';
import { createMockPlaceholderContext } from '../../../../utils/testUtils';
import { WorkflowAboutType } from '../../../../types';

describe('Placeholder System - Phase 1', () => {
  let resolver: PlaceholderResolver;
  let registry: PlaceholderRegistry;
  let testContext: PlaceholderContext;

  beforeEach(() => {
    resolver = new PlaceholderResolver();
    registry = new PlaceholderRegistry('test');
    testContext = createMockPlaceholderContext();
  });

  describe('PlaceholderDefinition', () => {
    it('should create a simple placeholder definition', () => {
      const placeholder = PlaceholderDefinition.create(
        'test.key',
        'Test placeholder',
        () => 'test value',
      );

      expect(placeholder.key).toBe('test.key');
      expect(placeholder.description).toBe('Test placeholder');
      expect(placeholder.isContentBlock).toBe(false);
      expect(placeholder.getTemplateVariable()).toBe('${test.key}');
    });

    it('should generate template variable with insert() method', () => {
      const placeholder = PlaceholderDefinition.create(
        'test.key',
        'Test placeholder',
        () => 'test value',
      );

      // Without options
      expect(placeholder.insert()).toBe('${test.key}');

      // With options
      expect(placeholder.insert({ maxLength: 100 })).toBe(
        '${test.key}::{"maxLength":100}',
      );

      // With complex options
      const complexOptions = {
        maxLength: 50,
        format: 'summary',
        includeMetadata: true,
      };
      expect(placeholder.insert(complexOptions)).toBe(
        '${test.key}::{"maxLength":50,"format":"summary","includeMetadata":true}',
      );
    });

    it('should create a content block placeholder definition', () => {
      const placeholder = PlaceholderDefinition.createContentBlock(
        'content.block',
        'Test content block',
        () => 'content block value',
        'any',
      );

      expect(placeholder.key).toBe('content.block');
      expect(placeholder.isContentBlock).toBe(true);
      expect(placeholder.requiredContextType).toBe('any');
    });

    it('should resolve placeholder values', async () => {
      const placeholder = PlaceholderDefinition.create(
        'dynamic.value',
        'Dynamic test value',
        (ctx) => `Hello ${ctx.flowContext.core.user.id}`,
      );

      const result = await placeholder.resolve(testContext);
      expect(result).toBe('Hello test-user');
    });

    it('should resolve placeholder values with options', async () => {
      const placeholder = PlaceholderDefinition.create(
        'options.value',
        'Options test value',
        (ctx, options) => {
          const baseMessage = `Hello ${ctx.flowContext.core.user.id}`;
          if (options?.maxLength) {
            return baseMessage.substring(0, options.maxLength as number);
          }
          if (options?.format === 'upper') {
            return baseMessage.toUpperCase();
          }
          return baseMessage;
        },
      );

      // Test without options
      const result1 = await placeholder.resolve(testContext);
      expect(result1).toBe('Hello test-user');

      // Test with maxLength option
      const result2 = await placeholder.resolve(testContext, { maxLength: 8 });
      expect(result2).toBe('Hello te');

      // Test with format option
      const result3 = await placeholder.resolve(testContext, {
        format: 'upper',
      });
      expect(result3).toBe('HELLO TEST-USER');
    });

    it('should handle async resolvers', async () => {
      const placeholder = PlaceholderDefinition.create(
        'async.value',
        'Async test value',
        async (ctx) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return `Async: ${ctx.flowContext.core.projectId}`;
        },
      );

      const result = await placeholder.resolve(testContext);
      expect(result).toBe('Async: test-project');
    });

    it('should validate required constructor parameters', () => {
      expect(() => {
        new PlaceholderDefinition('', 'description', () => 'value');
      }).toThrow('Placeholder key must be a non-empty string');

      expect(() => {
        new PlaceholderDefinition('key', '', () => 'value');
      }).toThrow('Placeholder description must be a non-empty string');

      expect(() => {
        new PlaceholderDefinition(
          'key',
          'description',
          'not a function' as any,
        );
      }).toThrow('Placeholder resolver must be a function');
    });

    it('should check context compatibility', () => {
      const anyPlaceholder = PlaceholderDefinition.create(
        'any.context',
        'Any context',
        () => 'value',
      );

      const initiativePlaceholder = new PlaceholderDefinition(
        'initiative.context',
        'Initiative context',
        () => 'value',
        false,
        'initiative',
      );

      expect(anyPlaceholder.isCompatibleWith(testContext)).toBe(true);
      expect(initiativePlaceholder.isCompatibleWith(testContext)).toBe(false);

      // Add initiativeId to make it compatible
      const initiativeContext = {
        ...testContext,
        flowContext: {
          ...testContext.flowContext,
          initiativeId: 'test-initiative',
        },
      };
      expect(initiativePlaceholder.isCompatibleWith(initiativeContext)).toBe(
        true,
      );
    });
  });

  describe('PlaceholderRegistry', () => {
    it('should register and retrieve placeholders', () => {
      const placeholder = PlaceholderDefinition.create(
        'test',
        'Test',
        () => 'value',
      );

      registry.register(placeholder);

      expect(registry.has('test')).toBe(true);
      expect(registry.get('test')).toBe(placeholder);
      expect(registry.getKeys()).toEqual(['test']);
    });

    it('should prevent duplicate registration', () => {
      const placeholder1 = PlaceholderDefinition.create(
        'test',
        'Test 1',
        () => 'value1',
      );
      const placeholder2 = PlaceholderDefinition.create(
        'test',
        'Test 2',
        () => 'value2',
      );

      registry.register(placeholder1);

      expect(() => {
        registry.register(placeholder2);
      }).toThrow("Placeholder 'test' is already registered");
    });

    it('should find used placeholders in templates', () => {
      const placeholder1 = PlaceholderDefinition.create(
        'user.name',
        'User name',
        () => 'John',
      );
      const placeholder2 = PlaceholderDefinition.create(
        'user.email',
        'User email',
        () => 'john@example.com',
      );

      registry.register(placeholder1);
      registry.register(placeholder2);

      const template =
        'Hello ${user.name}, your email is ${user.email}. Missing: ${missing.placeholder}';
      const result = registry.findUsedPlaceholders(template);

      expect(result.found).toHaveLength(2);
      expect(result.missing).toEqual(['missing.placeholder']);
      expect(result.all).toEqual([
        'user.name',
        'user.email',
        'missing.placeholder',
      ]);
    });

    it('should validate templates', () => {
      const placeholder = PlaceholderDefinition.create(
        'valid',
        'Valid',
        () => 'value',
      );
      registry.register(placeholder);

      const validTemplate = 'This uses ${valid} placeholder';
      const invalidTemplate = 'This uses ${invalid} placeholder';

      const validResult = registry.validateTemplate(validTemplate);
      const invalidResult = registry.validateTemplate(invalidTemplate);

      expect(validResult.isValid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors).toHaveLength(1);
      expect(invalidResult.missingPlaceholders).toEqual(['invalid']);
    });

    it('should provide documentation', () => {
      const simple = PlaceholderDefinition.create(
        'simple',
        'Simple placeholder',
        () => 'value',
      );
      const content = PlaceholderDefinition.createContentBlock(
        'content',
        'Content block',
        () => 'block',
      );

      registry.register(simple);
      registry.register(content);

      const docs = registry.getDocumentation();

      expect(docs.name).toBe('test');
      expect(docs.totalCount).toBe(2);
      expect(docs.contentBlocks).toBe(1);
      expect(docs.simplePlaceholders).toBe(1);
      expect(docs.placeholders).toHaveLength(2);
    });

    it('should extend registries', () => {
      const base = PlaceholderDefinition.create(
        'base',
        'Base placeholder',
        () => 'base',
      );
      registry.register(base);

      const extended = registry.extend('extended');
      const extra = PlaceholderDefinition.create(
        'extra',
        'Extra placeholder',
        () => 'extra',
      );
      extended.register(extra);

      expect(registry.has('base')).toBe(true);
      expect(registry.has('extra')).toBe(false);

      expect(extended.has('base')).toBe(true);
      expect(extended.has('extra')).toBe(true);
    });
  });

  describe('PlaceholderContextBuilder', () => {
    it('should build context with required fields', () => {
      const mockFlowContext = {
        core: {
          workflowId: 'workflow' as any,
          projectId: 'project' as any,
          organizationId: 'org' as any,
          conversationId: 'conversation' as any,
          workflowAboutId: 'project' as any,
          workflowAboutType: 'project' as WorkflowAboutType,
          user: { id: 'user' as any, role: 'member' },
          session: { startTime: new Date(), interactionCount: 1 },
        },
        flowId: 'test-flow',
        flowPath: {
          pathTaken: [] as string[],
          previousNode: undefined,
        },
      };

      const mockServices = {
        initiativeService: {} as any,
        artifactService: {} as any,
        taskService: {} as any,
        designDocService: {} as any,
      };

      const context = PlaceholderContextBuilder.create()
        .withFlowContext(mockFlowContext)
        .withServices(mockServices)
        .build();

      expect(context.flowContext).toBe(mockFlowContext);
      expect(context.flowContext.core.projectId).toBe('project');
      expect(context.services).toBe(mockServices);
    });

    it('should validate required fields', () => {
      expect(() => {
        PlaceholderContextBuilder.create().build();
      }).toThrow('FlowContext is required');
    });
  });

  describe('PlaceholderContextUtils', () => {
    it('should check for initiative context', () => {
      expect(PlaceholderContextUtils.hasInitiativeContext(testContext)).toBe(
        false,
      );

      const initiativeContext = {
        ...testContext,
        flowContext: {
          ...testContext.flowContext,
          initiativeId: 'test-initiative',
        },
      };
      expect(
        PlaceholderContextUtils.hasInitiativeContext(initiativeContext),
      ).toBe(true);
    });

    it('should extract user message content', () => {
      const contextWithMessage = {
        ...testContext,
        userMessage: {
          data: { message: 'Hello world' },
          timestamp: new Date(),
        } as any,
      };

      const content =
        PlaceholderContextUtils.getUserMessageContent(contextWithMessage);
      expect(content).toBe('Hello world');

      const contentNoMessage =
        PlaceholderContextUtils.getUserMessageContent(testContext);
      expect(contentNoMessage).toBe('');
    });

    it('should safely get node context values', () => {
      const contextWithNode = {
        ...testContext,
        nodeBuildContext: {
          currentLevel: 'description',
          technicalAnalysis: 'Some analysis',
        },
      };

      expect(
        PlaceholderContextUtils.getNodeContextValue(
          contextWithNode,
          'currentLevel',
          '',
        ),
      ).toBe('description');
      expect(
        PlaceholderContextUtils.getNodeContextValue(
          contextWithNode,
          'userFeedback',
          '',
        ),
      ).toBe('');
      expect(
        PlaceholderContextUtils.getNodeContextValue(
          contextWithNode,
          'userFeedback',
          'default',
        ),
      ).toBe('default');
    });
  });

  describe('PlaceholderResolver', () => {
    beforeEach(() => {
      const placeholder1 = PlaceholderDefinition.create(
        'simple',
        'Simple value',
        () => 'resolved',
      );

      const placeholder2 = PlaceholderDefinition.create(
        'context.based',
        'Context based value',
        (ctx) => `User: ${ctx.flowContext.core.user.id}`,
      );

      const optionsPlaceholder = PlaceholderDefinition.create(
        'options.test',
        'Options test placeholder',
        (ctx, options) => {
          const base = 'Test Message';
          if (options?.maxLength) {
            return base.substring(0, options.maxLength as number);
          }
          if (options?.transform === 'upper') {
            return base.toUpperCase();
          }
          return base;
        },
      );

      registry.register(placeholder1);
      registry.register(placeholder2);
      registry.register(optionsPlaceholder);
    });

    it('should resolve simple template', async () => {
      const template = 'Hello ${simple} world!';
      const result = await resolver.resolve(template, registry, testContext);

      expect(result).toBe('Hello resolved world!');
    });

    it('should resolve multiple placeholders', async () => {
      const template = 'Value: ${simple}, ${context.based}';
      const result = await resolver.resolve(template, registry, testContext);

      expect(result).toBe('Value: resolved, User: test-user');
    });

    it('should resolve placeholders with options', async () => {
      // Test placeholder without options
      const template1 = 'Result: ${options.test}';
      const result1 = await resolver.resolve(template1, registry, testContext);
      expect(result1).toBe('Result: Test Message');

      // Test placeholder with maxLength option
      const template2 = 'Result: ${options.test}::{"maxLength":4}';
      const result2 = await resolver.resolve(template2, registry, testContext);
      expect(result2).toBe('Result: Test');

      // Test placeholder with transform option
      const template3 = 'Result: ${options.test}::{"transform":"upper"}';
      const result3 = await resolver.resolve(template3, registry, testContext);
      expect(result3).toBe('Result: TEST MESSAGE');

      // Test multiple placeholders with different options
      const template4 =
        'Short: ${options.test}::{"maxLength":4}, Full: ${options.test}, Upper: ${options.test}::{"transform":"upper"}';
      const result4 = await resolver.resolve(template4, registry, testContext);
      expect(result4).toBe(
        'Short: Test, Full: Test Message, Upper: TEST MESSAGE',
      );
    });

    it('should handle malformed options gracefully', async () => {
      // Test with malformed JSON - should fallback to no options
      const template = 'Result: ${options.test}::{"malformed":json}';
      const result = await resolver.resolve(template, registry, testContext);
      expect(result).toBe('Result: Test Message'); // Should use base behavior
    });

    it('should cache placeholders with different options separately', async () => {
      let callCount = 0;
      const countingPlaceholder = PlaceholderDefinition.create(
        'counting',
        'Counting placeholder',
        (ctx, options) => {
          callCount++;
          const base = `call-${callCount}`;
          return options?.suffix ? `${base}-${options.suffix}` : base;
        },
      );

      registry.register(countingPlaceholder);

      // First call without options
      const result1 = await resolver.resolve(
        '${counting}',
        registry,
        testContext,
        {
          enableCaching: true,
        },
      );
      expect(result1).toBe('call-1');

      // Second call without options should use cache
      const result2 = await resolver.resolve(
        '${counting}',
        registry,
        testContext,
        {
          enableCaching: true,
        },
      );
      expect(result2).toBe('call-1');
      expect(callCount).toBe(1);

      // Call with options should not use cache (different cache key)
      const result3 = await resolver.resolve(
        '${counting}::{"suffix":"test"}',
        registry,
        testContext,
        {
          enableCaching: true,
        },
      );
      expect(result3).toBe('call-2-test');
      expect(callCount).toBe(2);

      // Same options should use cache
      const result4 = await resolver.resolve(
        '${counting}::{"suffix":"test"}',
        registry,
        testContext,
        {
          enableCaching: true,
        },
      );
      expect(result4).toBe('call-2-test');
      expect(callCount).toBe(2); // Should not increment
    });

    it('should handle missing placeholders based on options', async () => {
      const template = 'Known: ${simple}, Unknown: ${missing}';

      // Should throw by default
      await expect(
        resolver.resolve(template, registry, testContext),
      ).rejects.toThrow('Unknown placeholders: missing');

      // Should use default value when configured
      const result = await resolver.resolve(template, registry, testContext, {
        throwOnMissing: false,
        defaultValue: '[MISSING]',
      });

      expect(result).toBe('Known: resolved, Unknown: [MISSING]');
    });

    it('should validate templates', () => {
      const validTemplate = 'This uses ${simple}';
      const invalidTemplate = 'This uses ${missing}';

      const validResult = resolver.validateTemplate(validTemplate, registry);
      const invalidResult = resolver.validateTemplate(
        invalidTemplate,
        registry,
      );

      expect(validResult.isValid).toBe(true);
      expect(invalidResult.isValid).toBe(false);
    });

    it('should preview templates', () => {
      const template = 'Uses ${simple} and ${context.based} and ${missing}';
      const preview = resolver.preview(template, registry);

      expect(preview.placeholders).toHaveLength(2);
      expect(preview.missing).toEqual(['missing']);
      expect(preview.validation.isValid).toBe(false);
    });

    it('should handle caching', async () => {
      let callCount = 0;
      const cacheable = PlaceholderDefinition.create(
        'cacheable',
        'Cacheable value',
        () => {
          callCount++;
          return `call-${callCount}`;
        },
      );

      registry.register(cacheable);

      const template = '${cacheable}';

      // First call
      const result1 = await resolver.resolve(template, registry, testContext, {
        enableCaching: true,
      });
      expect(result1).toBe('call-1');

      // Second call should use cache
      const result2 = await resolver.resolve(template, registry, testContext, {
        enableCaching: true,
      });
      expect(result2).toBe('call-1'); // Same value from cache
      expect(callCount).toBe(1); // Only called once
    });
  });

  describe('Integration', () => {
    it('should handle complex real-world scenario', async () => {
      // Create realistic placeholders
      const workflowId = PlaceholderDefinition.create(
        'workflowId',
        'Current workflow ID',
        (ctx) => ctx.flowContext.core.workflowId,
      );

      const userGreeting = PlaceholderDefinition.create(
        'user.greeting',
        'User greeting',
        (ctx) => `Hello, ${ctx.flowContext.core.user.role}!`,
      );

      const currentMessage = PlaceholderDefinition.create(
        'currentMessage',
        'Current user message',
        (ctx) => PlaceholderContextUtils.getUserMessageContent(ctx),
      );

      const contextBlock = PlaceholderDefinition.createContentBlock(
        'contextBlock',
        'Context information block',
        (ctx) =>
          `
CONTEXT:
- Workflow: ${ctx.flowContext.core.workflowId}
- Project: ${ctx.flowContext.core.projectId}
- Organization: ${ctx.flowContext.core.organizationId}
        `.trim(),
      );

      registry.registerAll([
        workflowId,
        userGreeting,
        currentMessage,
        contextBlock,
      ]);

      const template = `
\${user.greeting}

Current workflow: \${workflowId}
Message: "\${currentMessage}"

\${contextBlock}
      `.trim();

      const contextWithMessage = {
        ...testContext,
        userMessage: {
          data: { message: 'I need help with my project' },
          timestamp: new Date(),
        } as any,
      };

      const result = await resolver.resolve(
        template,
        registry,
        contextWithMessage,
      );

      expect(result).toContain('Hello, member!');
      expect(result).toContain('Current workflow: test-workflow');
      expect(result).toContain('Message: "I need help with my project"');
      expect(result).toContain('CONTEXT:');
      expect(result).toContain('- Workflow: test-workflow');
      expect(result).toContain('- Project: test-project');
      expect(result).toContain('- Organization: test-org');
    });

    it('should handle complex real-world scenario with options', async () => {
      // Create placeholders that support options
      const messageFormatter = PlaceholderDefinition.create(
        'message.formatted',
        'Formatted message with options',
        (ctx, options) => {
          const baseMessage =
            PlaceholderContextUtils.getUserMessageContent(ctx);

          if (options?.maxLength && options?.format === 'quote') {
            const truncated = baseMessage.substring(
              0,
              options.maxLength as number,
            );
            const result =
              baseMessage.length > (options.maxLength as number)
                ? `${truncated}...`
                : truncated;
            return `"${result}"`;
          }

          if (options?.maxLength) {
            const truncated = baseMessage.substring(
              0,
              options.maxLength as number,
            );
            return baseMessage.length > (options.maxLength as number)
              ? `${truncated}...`
              : truncated;
          }

          if (options?.format === 'quote') {
            return `"${baseMessage}"`;
          }

          return baseMessage;
        },
      );

      const contextInfo = PlaceholderDefinition.create(
        'context.info',
        'Context information with formatting options',
        (ctx, options) => {
          const info = `Workflow: ${ctx.flowContext.core.workflowId}, Project: ${ctx.flowContext.core.projectId}`;

          if (options?.style === 'compact') {
            return info;
          }

          return `Context Information:\n- ${info.replace(', ', '\n- ')}`;
        },
      );

      registry.registerAll([messageFormatter, contextInfo]);

      const template = `
Message: \${message.formatted}::{"format":"quote","maxLength":20}

\${context.info}::{"style":"compact"}

Full message: \${message.formatted}
      `.trim();

      const contextWithLongMessage = {
        ...testContext,
        userMessage: {
          data: {
            message:
              'This is a very long message that should be truncated when using maxLength option',
          },
          timestamp: new Date(),
        } as any,
      };

      const result = await resolver.resolve(
        template,
        registry,
        contextWithLongMessage,
      );

      expect(result).toContain('Message: "This is a very long ..."'); // Truncated and quoted
      expect(result).toContain(
        'Workflow: test-workflow, Project: test-project',
      ); // Compact style
      expect(result).toContain(
        'Full message: This is a very long message that should be truncated when using maxLength option',
      ); // Full message without options
    });
  });
});

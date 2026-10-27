import { describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { resolveMcpToolNames } from '../mcp-server-config';
import { repositoryFeatureEnrichmentHandler as handler } from './repository-feature-enrichment.handler';
import { request } from './repository-feature-enrichment.test-fixture';

const run = {
  agentic_session_id: '77777777-7777-4777-8777-777777777777',
  launchServiceId: request.serviceId,
  services: [{ id: request.serviceId }],
} as AgenticSession;
const deps = { logger: { info: vi.fn() } } as unknown as PromptTypeHandlerDeps;

describe('Feature intent conversation handler', () => {
  it('continues ordinary replies in the same handler and provider session', async () => {
    const started = await handler.prepare(run, request, deps);
    const restored = JSON.parse(
      JSON.stringify({ ...run, sessionContext: started.sessionContext }),
    ) as AgenticSession;
    for (let reply = 0; reply < 6; reply++) {
      const prepared = await handler.prepare(
        restored,
        { userMessage: `Clarification ${reply}` },
        deps,
      );
      expect(prepared.payload).toMatchObject({
        materializedFeatureIds: request.materializedFeatureIds,
        userMessage: `Clarification ${reply}`,
      });
      expect(handler.resolveProviderExecution(prepared.payload)).toEqual({
        provider: request.provider,
        model: request.resolvedFrontierModel,
      });
      expect(handler.addUserMessage(prepared.payload)).toContain(`Clarification ${reply}`);
      expect(handler.buildPrompt(prepared.payload)).toContain('The import workflow is finished');
    }
    expect(handler.providerSessionLifetime).toBe('run');
    expect(handler).not.toHaveProperty('providerSessionStart', 'fresh');
    expect(handler.retainsConversationAfterWorkflow).toBe(true);
    expect(handler).not.toHaveProperty('getCompletionAction');
    expect(handler).not.toHaveProperty('validateCompletion');
  });

  it('opens ordinary Feature edit proposals while keeping repository access read-only', () => {
    const tools = resolveMcpToolNames({
      useCase: handler.mcpToolUseCase,
      additionalTools: handler.additionalAllowedTools,
    });
    expect(tools).toEqual(
      expect.arrayContaining([
        'edit_work_item',
        'update_proposal',
        'get_proposal',
        'get_authoring_guidance',
        'get_context',
      ]),
    );
    expect(handler.readOnlyFilesystem).toBe(true);
  });

  it('does not invent context when the saved handoff is missing or the Service differs', async () => {
    await expect(handler.prepare(run, { userMessage: 'Continue' }, deps)).rejects.toThrow(
      'handoff is missing',
    );
    await expect(handler.prepare({ ...run, services: [] }, request, deps)).rejects.toThrow(
      'launch workspace',
    );
  });
});

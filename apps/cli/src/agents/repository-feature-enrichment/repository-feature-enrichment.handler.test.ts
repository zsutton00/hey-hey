import { describe, expect, it, vi } from 'vitest';
import { createTestRun } from '../../run/run.test-support';
import type { AssistantCompleteEvent } from '../../run/types';
import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { resolveMcpToolNames } from '../mcp-server-config';
import { repositoryFeatureEnrichmentHandler as handler } from './repository-feature-enrichment.handler';
import { request } from './repository-feature-enrichment.test-fixture';

const baseRun = createTestRun();
const run: AgenticSession = {
  ...baseRun.session,
  agentic_session_id: '77777777-7777-4777-8777-777777777777',
  launchServiceId: request.serviceId,
  services: baseRun.session.services.map((service) => ({ ...service, id: request.serviceId })),
};
const deps = { logger: { info: vi.fn() } } as unknown as PromptTypeHandlerDeps;

describe('Feature intent conversation handler', () => {
  it('carries the complete accepted runtime on the handoff and none on a reply', () => {
    expect(handler.resolveRuntime(request)).toEqual({
      provider: request.provider,
      model: request.resolvedFrontierModel,
      reasoningEffort: request.reasoningEffort,
      fastMode: request.fastMode,
    });
    expect(handler.resolveRuntime({ userMessage: 'My answer' })).toBeUndefined();
  });

  it('restores the saved handoff for ordinary replies', async () => {
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

  it('attaches a required Send reply field to each agent message without changing the response', () => {
    const output = handler.transformCompletionOutput({
      kind: 'assistant_complete',
      summary: '1. What is this Feature for?',
    } as AssistantCompleteEvent);

    expect(output.data).toMatchObject({
      response: '1. What is this Feature for?',
      detectedIntent: 'agent_response',
      intentConfidence: 1,
      uiElements: [
        {
          type: 'repository_feature_enrichment_reply',
          required: true,
          submitText: 'Send',
        },
      ],
    });
    expect(output.data).toHaveProperty('uiElements.length', 1);
  });

  describe('completion output', () => {
    const complete = (summary: string) => ({ summary }) as AssistantCompleteEvent;
    const elements = (
      summary: string,
      diagnostics?: Parameters<typeof handler.transformCompletionOutput>[2],
    ) => handler.transformCompletionOutput(complete(summary), undefined, diagnostics).data;

    it('gives each question its own field and removes the block from the visible text', () => {
      const data = elements(
        'I read the import pipeline.\n\n<enrichment_questions>{"questions":["Should a failed stage stop the pipeline?","Who owns retries?","Is the audit trail required?"]}</enrichment_questions>',
      );
      expect(data).toMatchObject({
        response: 'I read the import pipeline.',
        uiElements: [
          {
            type: 'question_group',
            payload: {
              questions: [
                'Should a failed stage stop the pipeline?',
                'Who owns retries?',
                'Is the audit trail required?',
              ],
              conversationReply: expect.any(Object),
            },
          },
        ],
      });
    });

    it('keeps the single reply field when the agent asks no structured questions', () => {
      const data = elements('Here is my summary of the pending proposals.');
      expect(data).toMatchObject({
        response: 'Here is my summary of the pending proposals.',
        uiElements: [{ type: 'repository_feature_enrichment_reply' }],
      });
    });

    it.each([
      ['malformed JSON', '<enrichment_questions>{"questions":[</enrichment_questions>'],
      [
        'too many questions',
        '<enrichment_questions>{"questions":["a","b","c","d"]}</enrichment_questions>',
      ],
      [
        'a repeated question',
        '<enrichment_questions>{"questions":["a","a"]}</enrichment_questions>',
      ],
      ['an empty question', '<enrichment_questions>{"questions":["a",""]}</enrichment_questions>'],
    ])('falls back to the reply field and logs the cause for %s', (_name, block) => {
      const logger = { warn: vi.fn() };
      const summary = `Which should win?\n${block}`;
      const data = elements(summary, { runId: 'run-1', logger } as never);
      expect(data).toMatchObject({
        response: summary,
        uiElements: [{ type: 'repository_feature_enrichment_reply' }],
      });
      expect(logger.warn).toHaveBeenCalledWith(
        'repository_feature_enrichment.questions_unreadable',
        expect.objectContaining({ runId: 'run-1', cause: expect.any(String) }),
      );
    });
  });
});

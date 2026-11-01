/** @vitest-environment node */

import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import captured from '../agents/project-assistant/fixtures/narrow-context';
import { ProjectAssistantHandler } from '../agents/project-assistant/project-assistant.handler';
import type { ContextGatheringDeps } from '../agents/project-assistant/context-gathering';
import type { AgentStartupPromptInputResult } from '../agents/prompt-type-handler';
import { createPromptTypeHandlerTestDeps } from '../agents/prompt-type-handler.test-support';
import { makeCreateReportProxy } from '../agents/submission-tools/create-report-proxy.test-support';
import { renderEntityPromptTemplate } from '../commands/entity-prompt-template-renderer';
import type { JevInput, JevResult } from '../jev/client';
import type { AgenticSession } from '../session/index';
import {
  LocalPromptType,
  RunEntityReferenceEntityTypeEnum as RunEntityType,
} from '../shared/agent-bridge-contract/generated/api';
import { EntityPromptTemplateSyntaxVersion } from '../shared/api/generated';
import { TasksApi, type TaskResponseDto } from '../shared/api/generated';
import { createFirstTurnPromptRunState, resolvePrompt } from './resolve-prompt';
import { projectProviderSessionStartupInput } from './provider-session-startup-input';

const PARENT_ID = '9a4f82a4-080f-41a4-a3aa-b6d57f38ccf5';
const TEMPLATE =
  '# Entity\n{{entity.name}}\n## Related\n{{context.relatedEntities}}\n## Hierarchy\n{{context.featureHierarchy}}\n## Proposals\n{{context.proposals}}\n## Sessions\n{{context.agentSessions}}';
const provenance = {
  templateKey: 'task',
  ownershipSource: { scope: 'CANONICAL' },
  revisionId: 'revision-7',
  revisionNumber: 7,
} as const;
const entity = {
  id: captured.entityId,
  name: captured.displayName,
  type: 'STANDARD',
  organizationId: 'org-1',
  projectId: 'proj-1',
  status: 'ACTIVE',
  source: 'user',
  sections: [],
} as unknown as TaskResponseDto;

const startupResult = (): AgentStartupPromptInputResult => {
  const template = {
    templateKey: 'task',
    selector: {},
    syntaxVersion: EntityPromptTemplateSyntaxVersion.V1,
    content: TEMPLATE,
    provenance,
  } as unknown as NonNullable<AgentStartupPromptInputResult['template']>;
  const focalEntity = { entityType: RunEntityType.Task, entityId: captured.entityId };
  return {
    startupInput: {
      task: { id: captured.entityId, taskType: 'STANDARD', description: '' },
      focalEntity,
      adjacentScopeTasks: [],
      evidenceItems: [],
    },
    renderedInput: renderEntityPromptTemplate(TEMPLATE, template.syntaxVersion, {
      entity,
      context: captured,
    }),
    loadedEntityContext: { kind: 'entity', focalEntity, entity, context: captured },
    template,
    provenance,
  };
};

/** Network-boundary Jev: ranks candidates high, middling and low in turn, or fails outright. */
const jev = (mode: 'ranked' | 'fail') =>
  vi.fn((input: JevInput): Promise<JevResult> => {
    if (mode === 'fail') {
      return Promise.resolve({
        ok: false,
        failure: { code: 'PROVIDER_ERROR', message: 'jev down' },
      });
    }

    let index = 0;
    const answers: Extract<JevResult, { ok: true }>['answers'] = {};
    for (const [id, question] of Object.entries(input.questions)) {
      const relevance = [0.95, 0.6, 0.05][index++ % 3] ?? 0;
      answers[id] =
        question.type === 'noul'
          ? { type: 'noul', noul: 0 }
          : {
              type: 'choice',
              choice: 'implements',
              confidence: 1,
              probabilities: {
                implements: relevance,
                informs: 0,
                same_feature_unrelated: 1 - relevance,
                other: 0,
              },
            };
    }
    return Promise.resolve({
      ok: true,
      answers,
      model: input.model,
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
    });
  });

const gatheringWith = (evaluate: ReturnType<typeof jev>) =>
  ({
    jev: { client: { evaluate }, model: 'jev-test' },
    traceLogDir: path.join(os.tmpdir(), 'jev-trace-test'),
  }) as unknown as ContextGatheringDeps;

const mockParentRead = () =>
  vi
    .spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
    .mockResolvedValue({
      data: {
        success: true,
        message: 'ok',
        data: {
          id: PARENT_ID,
          name: 'Project Assistant',
          type: 'FEATURE',
          sections: [
            {
              id: 's1',
              key: 'description',
              order: 0,
              materializedMarkdown: 'Parent description.',
              materializedProposalId: 'p',
            },
          ],
        },
      },
    } as never);

const run = (): AgenticSession =>
  ({
    entity: { entityType: RunEntityType.Task, entityId: captured.entityId },
    agentic_session_id: 'run-1',
    services: [],
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    conversationId: 'conv-1',
    status: 'idle',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    events: [],
  }) as unknown as AgenticSession;

const prepareAndProject = async (options: {
  handler: ProjectAssistantHandler;
  startup: AgentStartupPromptInputResult;
}) => {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger),
  } as unknown as ReturnType<typeof createPromptTypeHandlerTestDeps>['logger'];
  const startupPromptInput = {
    resolve: vi.fn().mockResolvedValue(options.startup),
  } as unknown as ReturnType<typeof createPromptTypeHandlerTestDeps>['startupPromptInput'];
  const deps = createPromptTypeHandlerTestDeps({
    logger,
    startupPromptInput,
    fetchImpl: () => Promise.resolve(Response.json({ data: [] })),
  });
  const result = await resolvePrompt({
    handler: options.handler,
    run: run(),
    runState: createFirstTurnPromptRunState(),
    input: {
      promptType: LocalPromptType.ProjectAssistant,
      references: { resolved: [], unresolved: [] },
      triggerContext: null,
      payload: {
        userMessage: 'Wire the narrowing into Project Assistant',
        projectAssistantHandoff: {
          consumerHandlerId: 'free_form',
          policy: {
            allowEdgeUpdates: false,
            notifyDiscrepancies: false,
            workItemProposalMode: 'none',
          },
        },
      },
    } as never,
    handlerDeps: deps,
    turnId: 'turn-1',
    abortSignal: () => new AbortController().signal,
    recentUserReplies: [],
    triggerParentMessageId: null,
  });
  const provider = projectProviderSessionStartupInput({
    decision: 'mint',
    startupPromptInput: result.startupPromptInput ?? null,
    prompt: result.resolvedPrompt ?? '',
    promptSegments: result.providerSessionStartupSegments ?? null,
  } as never);
  const delivered =
    provider.input.kind === 'startup'
      ? provider.input.segments.dynamicContext
      : provider.input.prompt;
  return { result, delivered, logger, startupPromptInput };
};

describe('Project Assistant starting context reaches the provider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers the narrowed block, keeps the canonical Context, and reads the parent once', async () => {
    const read = mockParentRead();
    const evaluate = jev('ranked');
    const handler = new ProjectAssistantHandler(
      makeCreateReportProxy(),
      null,
      undefined,
      gatheringWith(evaluate),
    );
    vi.spyOn(
      await import('../agents/project-assistant/context-gathering'),
      'gatherProjectContext',
    ).mockResolvedValue('## Gathered context\n\nfound by search');
    const startup = startupResult();

    const { result, delivered, logger } = await prepareAndProject({ handler, startup });

    expect(evaluate).toHaveBeenCalled();
    const narrowed = result.startupPromptInput?.renderedInput ?? '';
    expect(narrowed.length).toBeLessThan(startup.renderedInput.length);
    expect(delivered).toContain(narrowed);
    for (const heading of [
      '# Entity',
      '## Related',
      '## Hierarchy',
      '## Proposals',
      '## Sessions',
    ]) {
      expect(delivered).toContain(heading);
    }
    expect(delivered).toContain(captured.displayName);
    expect(delivered).not.toContain(startup.renderedInput);
    expect(result.startupPromptInput?.loadedEntityContext).toBe(startup.loadedEntityContext);
    expect(result.startupPromptInput?.provenance).toEqual(provenance);
    expect(result.startupPromptTemplate?.provenance).toEqual(provenance);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.resolvedPrompt).toContain('found by search');
    expect(logger.info).toHaveBeenCalledWith(
      'local.run.prompt.startup_context_replaced',
      expect.objectContaining({
        runId: 'run-1',
        outcome: 'narrowed',
        beforeBytes: Buffer.byteLength(startup.renderedInput),
        afterBytes: expect.any(Number),
      }),
    );
  });

  it('judges the parent as a candidate when gathering is off', async () => {
    mockParentRead();
    const evaluate = jev('ranked');
    const handler = new ProjectAssistantHandler(makeCreateReportProxy(), null, {
      jevClient: { evaluate },
      entityContextLoader: { load: vi.fn() },
      attemptLogDir: path.join(os.tmpdir(), 'jev-attempt-log-test'),
    });

    const { result } = await prepareAndProject({ handler, startup: startupResult() });

    const judged = evaluate.mock.calls.map(([input]) => JSON.stringify(input.questions)).join('');
    expect(judged).toContain(PARENT_ID);
    expect(result.resolvedPrompt).toContain('Nearest parent feature');
    expect(result.resolvedPrompt?.match(/## Nearest parent feature/g)).toHaveLength(1);
  });

  it('restores the original context and full parent when the judgment fails', async () => {
    const read = mockParentRead();
    const handler = new ProjectAssistantHandler(
      makeCreateReportProxy(),
      null,
      undefined,
      gatheringWith(jev('fail')),
    );
    const gather = vi.spyOn(
      await import('../agents/project-assistant/context-gathering'),
      'gatherProjectContext',
    );
    const startup = startupResult();

    const { result, delivered, logger } = await prepareAndProject({ handler, startup });

    expect(delivered).toContain(startup.renderedInput);
    expect(result.startupPromptInput?.renderedInput).toBe(startup.renderedInput);
    expect(gather).not.toHaveBeenCalled();
    expect(result.resolvedPrompt).toContain('], in full.');
    expect(read).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'project_assistant.prepare.starting_context_narrowing_failed',
      expect.objectContaining({ runId: 'run-1', outcome: 'fallback_to_original_context' }),
    );
  });

  it('makes no Jev request and changes nothing when Jev is off', async () => {
    mockParentRead();
    const evaluate = jev('ranked');
    const handler = new ProjectAssistantHandler(
      makeCreateReportProxy(),
      null,
      undefined,
      gatheringWith(evaluate),
      () => Promise.resolve(false),
    );
    const startup = startupResult();

    const { result, delivered } = await prepareAndProject({ handler, startup });

    expect(evaluate).not.toHaveBeenCalled();
    expect(delivered).toContain(startup.renderedInput);
    expect(result.startupPromptInput).toBe(startup);
  });
});

import { describe, expect, it, vi } from 'vitest';

import type { AgenticSession } from '../../session/types';
import { NOOP_LOGGER } from '../../server/logger';
import {
  EntityType,
  type LocalEntityConversationEntityEntityTypeEnum,
  type LocalEntityConversationPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import type { AgentSessionDto, FullEntityContextDto } from '../../shared/api/generated/api';
import type { PromptTypeHandlerContext } from '../prompt-type-handler';
import { WorkflowAboutReader, type WorkflowAbout } from '../submission-tools/search-messages-proxy';
import { SubmissionToolAuth } from '../submission-tools/submission-tool-auth';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../auth/oauth-client.test-support';
import {
  ENTITY_CONVERSATION_HELP_TOOLS,
  EntityConversationHandler,
  GOAL_ENTITY_CONVERSATION_ALLOWED_TOOLS,
} from './entity-conversation.handler';

const workflowAboutReader = vi.spyOn(WorkflowAboutReader.prototype, 'read');

const makeDeps = (
  workflowAbout: WorkflowAbout = { workflowAboutId: 'entity-1', workflowAboutType: 'task' },
) => {
  workflowAboutReader.mockReset().mockResolvedValue(workflowAbout);
  return {
    handler: {
      auth: new SubmissionToolAuth(createProviderTestOAuthClient()),
      apiBaseUrl: 'https://api.test/v1',
      fetchImpl: vi.fn() as typeof fetch,
      logger: NOOP_LOGGER,
    },
    workflowAboutReader,
  };
};

const buildEntityConversationHandler = (deps: ReturnType<typeof makeDeps>) =>
  new EntityConversationHandler(deps.handler);

const makePayload = (
  entityType: LocalEntityConversationEntityEntityTypeEnum,
): LocalEntityConversationPromptPayload => ({
  entity: {
    entityId: 'entity-1',
    entityType,
    title: 'Entity',
    description: 'Entity description.',
  },
  userMessage: 'Please update this.',
});

const makeRun = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    entity: {
      entityId: 'entity-1',
      entityType: EntityType.Task,
    },
    conversationId: 'conversation-1',
    contextMetadata: {
      projectId: 'project-1',
      organizationId: 'organization-1',
    },
    sessionContext: {},
    ...overrides,
  }) as AgenticSession;

const makePromptDeps = (
  info = vi.fn(),
  overrides: {
    fetchImpl?: typeof fetch;
    getAccessToken?: () => Promise<string>;
  } = {},
) =>
  ({
    apiBaseUrl: 'https://api.test/v1',
    fetchImpl: overrides.fetchImpl ?? vi.fn(),
    auth: {
      getAccessToken: overrides.getAccessToken ?? vi.fn().mockResolvedValue('access-token'),
    },
    taskMonitorDecisionStore: { bind: vi.fn() },
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      info,
      warn: vi.fn(),
    },
  }) as never;

const resolveAdditionalAllowedTools = (
  handler: ReturnType<typeof buildEntityConversationHandler>,
  session: AgenticSession,
  payload: LocalEntityConversationPromptPayload | undefined = makePayload(EntityType.Task),
) =>
  handler.resolveAdditionalAllowedTools?.({
    session,
    input: {} as never,
    payload: payload as never,
  });

describe('buildEntityConversationHandler', () => {
  it('offers the Service-access request alongside changed-file reporting', () => {
    const handler = buildEntityConversationHandler(makeDeps());

    expect(handler.submissionTools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['report_changed_files', 'request_agent_session_service_scope']),
    );
  });

  it('allows design-doc authoring and global Help tools for entity conversations by default', () => {
    const handler = buildEntityConversationHandler(makeDeps());

    expect(handler.additionalAllowedTools).toEqual([
      'propose_future_revision',
      'create_design_doc',
      'edit_design_doc',
      ...ENTITY_CONVERSATION_HELP_TOOLS,
    ]);
    expect(
      handler.resolveAdditionalAllowedTools?.({
        session: {} as never,
        input: {} as never,
        payload: makePayload(EntityType.Task),
      }),
    ).toEqual([
      'propose_future_revision',
      'create_design_doc',
      'edit_design_doc',
      ...ENTITY_CONVERSATION_HELP_TOOLS,
    ]);
    expect(ENTITY_CONVERSATION_HELP_TOOLS).toEqual(['search_help', 'get_help_node']);
  });

  it('keeps a PLAN-typed TASK on the ordinary entity-conversation tool surface', () => {
    const handler = buildEntityConversationHandler(makeDeps());
    const planPayload = makePayload(EntityType.Task);
    planPayload.entity.taskType = 'PLAN';

    expect(resolveAdditionalAllowedTools(handler, makeRun(), planPayload)).toEqual([
      'propose_future_revision',
      'create_design_doc',
      'edit_design_doc',
      ...ENTITY_CONVERSATION_HELP_TOOLS,
    ]);
  });

  it('does not grant plan-specific tools from a PLAN-typed TASK payload', () => {
    const handler = buildEntityConversationHandler(makeDeps());
    const taskRun = makeRun({
      entity: { entityId: 'entity-1', entityType: EntityType.Task },
    });
    const planPayload = makePayload(EntityType.Task);
    planPayload.entity.taskType = 'PLAN';

    expect(resolveAdditionalAllowedTools(handler, taskRun, planPayload)).toEqual([
      'propose_future_revision',
      'create_design_doc',
      'edit_design_doc',
      ...ENTITY_CONVERSATION_HELP_TOOLS,
    ]);
  });

  it('adds goal-tracking tools for a TASK Run with a prepared GOAL subtype', () => {
    const handler = buildEntityConversationHandler(makeDeps());
    const taskRun = makeRun({
      entity: { entityId: 'entity-1', entityType: EntityType.Task },
    });
    const goalPayload = makePayload(EntityType.Task);
    goalPayload.entity.taskType = 'GOAL';

    expect(resolveAdditionalAllowedTools(handler, taskRun, goalPayload)).toEqual([
      'propose_future_revision',
      'create_design_doc',
      'edit_design_doc',
      ...ENTITY_CONVERSATION_HELP_TOOLS,
      ...GOAL_ENTITY_CONVERSATION_ALLOWED_TOOLS,
    ]);
    expect(GOAL_ENTITY_CONVERSATION_ALLOWED_TOOLS).toEqual(['attach_to_goal', 'detach_from_goal']);
  });

  it('does not grant goal-tracking tools for a TASK Run with a non-GOAL subtype', () => {
    const handler = buildEntityConversationHandler(makeDeps());
    const taskRun = makeRun({
      entity: { entityId: 'entity-1', entityType: EntityType.Task },
    });
    const standardPayload = makePayload(EntityType.Task);
    standardPayload.entity.taskType = 'STANDARD';

    expect(resolveAdditionalAllowedTools(handler, taskRun, standardPayload)).toEqual([
      'propose_future_revision',
      'create_design_doc',
      'edit_design_doc',
      ...ENTITY_CONVERSATION_HELP_TOOLS,
    ]);
    expect(resolveAdditionalAllowedTools(handler, taskRun, standardPayload)).not.toEqual(
      expect.arrayContaining([...GOAL_ENTITY_CONVERSATION_ALLOWED_TOOLS]),
    );
  });

  it('does not grant goal-tracking tools from a GOAL payload when the Run entity is not a TASK', () => {
    const handler = buildEntityConversationHandler(makeDeps());
    const goalPayload = makePayload(EntityType.Task);
    goalPayload.entity.taskType = 'GOAL';
    const nonTaskRun = makeRun({
      entity: { entityId: 'entity-1', entityType: EntityType.AgentSession },
    });

    expect(resolveAdditionalAllowedTools(handler, nonTaskRun, goalPayload)).toEqual([
      'propose_future_revision',
      'create_design_doc',
      'edit_design_doc',
      ...ENTITY_CONVERSATION_HELP_TOOLS,
    ]);
  });

  it('keeps goal-tracking tools on a payload-less reply from the durable task scope', async () => {
    const handler = buildEntityConversationHandler(
      makeDeps({ workflowAboutId: 'entity-1', workflowAboutType: 'task' }),
    );
    const taskRun = makeRun({
      entity: { entityId: 'entity-1', entityType: EntityType.Task },
    });
    const goalPayload = makePayload(EntityType.Task);
    goalPayload.entity.taskType = 'GOAL';
    const prepared = await handler.prepare?.(taskRun, goalPayload, makePromptDeps());
    expect(prepared?.sessionContext).toBeDefined();
    const resumedRun = makeRun({
      entity: { entityId: 'entity-1', entityType: EntityType.Task },
      sessionContext: prepared!.sessionContext!,
    });

    expect(resolveAdditionalAllowedTools(handler, resumedRun, undefined)).toEqual([
      'propose_future_revision',
      'create_design_doc',
      'edit_design_doc',
      ...ENTITY_CONVERSATION_HELP_TOOLS,
      ...GOAL_ENTITY_CONVERSATION_ALLOWED_TOOLS,
    ]);
  });

  it('safely handles a payload-less reply without stale task subtype context', () => {
    const handler = buildEntityConversationHandler(makeDeps());
    const featureRun = makeRun({
      entity: { entityId: 'entity-1', entityType: EntityType.Task },
    });

    expect(resolveAdditionalAllowedTools(handler, featureRun, undefined)).toEqual([
      'propose_future_revision',
      'create_design_doc',
      'edit_design_doc',
      ...ENTITY_CONVERSATION_HELP_TOOLS,
    ]);
  });

  it('prepares an initial payload from the persisted Run entity and preserves non-identity enrichment', async () => {
    const handler = buildEntityConversationHandler(makeDeps());

    const result = await handler.prepare?.(
      makeRun(),
      makePayload(EntityType.Task),
      makePromptDeps(),
    );

    expect(result).toEqual({
      payload: {
        userMessage: 'Please update this.',
        entity: {
          entityId: 'entity-1',
          entityType: EntityType.Task,
          title: 'Entity',
          description: 'Entity description.',
        },
      },
    });
  });

  it('uses the centrally supplied Agent Session transcript without loading focal context', async () => {
    const deps = makeDeps({
      workflowAboutId: 'entity-1',
      workflowAboutType: 'agent-session',
    });
    const loadedEntityContext = {
      kind: 'agent_session' as const,
      focalEntity: { entityId: 'entity-1', entityType: EntityType.AgentSession },
      agentSession: {} as AgentSessionDto,
      entity: {} as AgentSessionDto,
      context: {} as FullEntityContextDto,
      conversationId: 'source-conversation',
      transcript: [{ role: 'user' as const, turn: 1, content: 'Earlier question.' }],
    };
    const handler = buildEntityConversationHandler(deps);

    const result = await handler.prepare?.(
      makeRun({ entity: { entityId: 'entity-1', entityType: EntityType.AgentSession } }),
      makePayload(EntityType.AgentSession),
      makePromptDeps(),
    );

    expect(result).not.toHaveProperty('loadedEntityContext');
    expect(
      handler.buildPrompt(result!.payload, {
        loadedEntityContext,
        recentUserReplies: [],
        triggerParentMessageId: null,
      } satisfies PromptTypeHandlerContext),
    ).toContain('### Turn 1 — User\nEarlier question.');
  });

  it('preserves GOAL task subtype context through preparation and logs the resolved entity', async () => {
    const handler = buildEntityConversationHandler(
      makeDeps({ workflowAboutId: 'entity-1', workflowAboutType: 'task' }),
    );
    const info = vi.fn();
    const promptDeps = makePromptDeps(info);
    const payload = makePayload(EntityType.Task);
    payload.entity.taskType = 'GOAL';
    payload.entity.dueDate = '2026-09-30';

    const result = await handler.prepare?.(
      makeRun({ entity: { entityId: 'entity-1', entityType: EntityType.Task } }),
      payload,
      promptDeps,
    );

    expect(result?.payload.entity).toMatchObject({
      entityId: 'entity-1',
      entityType: EntityType.Task,
      taskType: 'GOAL',
      dueDate: '2026-09-30',
    });
    expect(result?.sessionContext).toEqual({
      'entityConversation.taskScope': {
        entityId: 'entity-1',
        taskType: 'GOAL',
      },
    });
    expect(handler.buildPrompt(result!.payload)).toContain('The input entity is a goal.');
    expect(info).toHaveBeenCalledWith('entity_conversation.prepare.run_entity_verified', {
      runId: 'run-1',
      entityId: 'entity-1',
      entityType: EntityType.Task,
      entityTitle: 'Entity',
      taskType: 'GOAL',
      usedPayloadTitle: true,
    });
  });

  it.each([
    ['diagram', 'DIAGRAM'],
    ['workflow', 'DIAGRAM'],
    ['diagram_element', 'DIAGRAM_ELEMENT'],
    ['workflow_step', 'DIAGRAM_ELEMENT'],
  ])(
    'resolves durable %s subjects to TASK while preserving subtype %s',
    async (workflowAboutType, taskType) => {
      const handler = buildEntityConversationHandler(
        makeDeps({ workflowAboutId: 'entity-1', workflowAboutType }),
      );
      const payload = makePayload(EntityType.Task);
      payload.entity.taskType = taskType;

      const result = await handler.prepare?.(
        makeRun({
          entity: {
            entityId: 'entity-1',
            entityType: EntityType.Task,
          },
        }),
        payload,
        makePromptDeps(),
      );

      expect(result?.payload.entity).toMatchObject({
        entityId: 'entity-1',
        entityType: EntityType.Task,
        taskType,
      });
      expect(result?.sessionContext).toEqual({
        'entityConversation.taskScope': { entityId: 'entity-1', taskType },
      });
    },
  );

  it('replaces a caller-supplied task subtype with the loaded canonical type', async () => {
    const handler = buildEntityConversationHandler(makeDeps());
    const payload = makePayload(EntityType.Task);
    payload.entity.taskType = 'GOAL';

    const result = await handler.prepare?.(makeRun(), payload, makePromptDeps(), {
      loadedEntityContext: {
        kind: 'entity',
        entity: { type: 'DIAGRAM' },
      },
    } as never);

    expect(result?.payload.entity.taskType).toBe('DIAGRAM');
    expect(result?.sessionContext).toEqual({
      'entityConversation.taskScope': {
        entityId: 'entity-1',
        taskType: 'DIAGRAM',
      },
    });
  });

  it('prepares a follow-up without launch payload identity from the persisted Run entity', async () => {
    const handler = buildEntityConversationHandler(makeDeps());

    const result = await handler.prepare?.(
      makeRun(),
      { userMessage: 'try again' } as LocalEntityConversationPromptPayload,
      makePromptDeps(),
    );

    expect(result).toEqual({
      payload: {
        userMessage: 'try again',
        entity: {
          entityId: 'entity-1',
          entityType: EntityType.Task,
        },
      },
    });
  });

  it('does not reconstruct a task subtype or focal context when a follow-up payload has no enrichment', async () => {
    const handler = buildEntityConversationHandler(
      makeDeps({ workflowAboutId: 'entity-1', workflowAboutType: 'task' }),
    );
    const fetchImpl = vi.fn() as typeof fetch;

    const result = await handler.prepare?.(
      makeRun({ entity: { entityId: 'entity-1', entityType: EntityType.Task } }),
      { userMessage: 'try again' } as LocalEntityConversationPromptPayload,
      makePromptDeps(vi.fn(), { fetchImpl }),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result?.payload.entity).toEqual({
      entityId: 'entity-1',
      entityType: EntityType.Task,
    });
  });

  it('uses the centrally loaded task subtype when preparing an unenriched task payload', async () => {
    const handler = buildEntityConversationHandler(
      makeDeps({ workflowAboutId: 'entity-1', workflowAboutType: 'task' }),
    );
    const loadedEntityContext: PromptTypeHandlerContext['loadedEntityContext'] = {
      kind: 'entity',
      focalEntity: { entityId: 'entity-1', entityType: EntityType.Task },
      entity: { type: 'GOAL' } as never,
      context: {} as never,
    };

    const result = await handler.prepare?.(
      makeRun({ entity: { entityId: 'entity-1', entityType: EntityType.Task } }),
      { userMessage: 'try again' } as LocalEntityConversationPromptPayload,
      makePromptDeps(),
      {
        loadedEntityContext,
        recentUserReplies: [],
        triggerParentMessageId: null,
      },
    );

    expect(result?.payload.entity.taskType).toBe('GOAL');
    expect(result?.sessionContext).toEqual({
      'entityConversation.taskScope': {
        entityId: 'entity-1',
        taskType: 'GOAL',
      },
    });
    expect(handler.buildPrompt(result!.payload)).toContain('The input entity is a goal.');
  });

  it('fails when payload identity conflicts with the persisted Run entity', async () => {
    const handler = buildEntityConversationHandler(makeDeps());
    const payload = makePayload(EntityType.Task);
    payload.entity.entityId = 'other-plan';

    await expect(handler.prepare?.(makeRun(), payload, makePromptDeps())).rejects.toThrow(
      /payload scope conflicts with the persisted Run entity/,
    );
  });

  it('fails when payload entity type conflicts with the persisted Run entity', async () => {
    const handler = buildEntityConversationHandler(makeDeps());

    await expect(
      handler.prepare?.(makeRun(), makePayload(EntityType.DesignDoc), makePromptDeps()),
    ).rejects.toThrow(/payload scope conflicts with the persisted Run entity/);
  });

  it('uses persisted Run identity after restart without reading the legacy session scope cache', async () => {
    const handler = buildEntityConversationHandler(makeDeps());

    const result = await handler.prepare?.(
      makeRun({
        sessionContext: {
          'entityConversation.entityScope': {
            entityId: 'stale-task',
            entityType: EntityType.Task,
            title: 'Stale task',
          },
        },
      }),
      { userMessage: 'continue' } as LocalEntityConversationPromptPayload,
      makePromptDeps(),
    );

    expect(result).toEqual({
      payload: {
        userMessage: 'continue',
        entity: {
          entityId: 'entity-1',
          entityType: EntityType.Task,
        },
      },
    });
  });

  it('checks the conversation subject for consistency without using it to select identity', async () => {
    const deps = makeDeps({ workflowAboutId: 'entity-1', workflowAboutType: 'task' });
    const handler = buildEntityConversationHandler(deps);

    await handler.prepare?.(
      makeRun(),
      { userMessage: 'continue' } as LocalEntityConversationPromptPayload,
      makePromptDeps(),
    );

    expect(deps.workflowAboutReader).toHaveBeenCalledWith({
      projectId: 'project-1',
      conversationId: 'conversation-1',
    });
  });

  it('fails before reading the conversation when the persisted Run entity is missing', async () => {
    const deps = makeDeps();
    const handler = buildEntityConversationHandler(deps);

    await expect(
      handler.prepare?.(makeRun({ entity: null }), makePayload(EntityType.Task), makePromptDeps()),
    ).rejects.toThrow(/persisted Run entity/);
    expect(deps.workflowAboutReader).not.toHaveBeenCalled();
  });

  it('fails when project context is missing before checking the conversation subject', async () => {
    const deps = makeDeps();
    const handler = buildEntityConversationHandler(deps);

    await expect(
      handler.prepare?.(
        makeRun({ contextMetadata: { organizationId: 'organization-1' } as never }),
        makePayload(EntityType.Task),
        makePromptDeps(),
      ),
    ).rejects.toThrow(/projectId and conversationId/);
    expect(deps.workflowAboutReader).not.toHaveBeenCalled();
  });

  it('fails when conversation context is missing before checking the conversation subject', async () => {
    const deps = makeDeps();
    const handler = buildEntityConversationHandler(deps);

    await expect(
      handler.prepare?.(
        makeRun({ conversationId: '' }),
        makePayload(EntityType.Task),
        makePromptDeps(),
      ),
    ).rejects.toThrow(/projectId and conversationId/);
    expect(deps.workflowAboutReader).not.toHaveBeenCalled();
  });

  it('fails when the conversation subject is missing', async () => {
    const handler = buildEntityConversationHandler(
      makeDeps({ workflowAboutId: null, workflowAboutType: null }),
    );

    await expect(
      handler.prepare?.(makeRun(), makePayload(EntityType.Task), makePromptDeps()),
    ).rejects.toThrow(/workflowAboutId and workflowAboutType/);
  });

  it('fails when the conversation subject type is unsupported', async () => {
    const handler = buildEntityConversationHandler(
      makeDeps({ workflowAboutId: 'entity-1', workflowAboutType: 'user' }),
    );

    await expect(
      handler.prepare?.(makeRun(), makePayload(EntityType.Task), makePromptDeps()),
    ).rejects.toThrow(/does not support workflowAboutType "user"/);
  });

  it('fails when the conversation subject conflicts with the persisted Run entity', async () => {
    const handler = buildEntityConversationHandler(
      makeDeps({ workflowAboutId: 'other-task', workflowAboutType: 'task' }),
    );

    await expect(
      handler.prepare?.(makeRun(), makePayload(EntityType.Task), makePromptDeps()),
    ).rejects.toThrow(/conversation subject conflicts with the persisted Run entity/);
  });
});

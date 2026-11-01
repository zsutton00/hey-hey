import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EntityContextApi,
  ProposalsApi,
  SessionRole,
  WorkItemTypesApi,
  TasksApi,
} from '../../shared/api/generated/api';
import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandler } from '../prompt-type-handler';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import { createTestRunStore } from '../../run/run.test-support';
import { readActiveWorkItemTypeDefinitions } from '../prompts/work-item-type-registry';
import { SessionRoleGuidance } from './session-role-guidance';
vi.mock('../prompts/work-item-type-registry', () => ({
  readActiveWorkItemTypeDefinitions: vi.fn(),
}));
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mention = (n: number, type = 'task') => `@[${type}:${id(n)}|Selected item]`;
const session = (): AgenticSession =>
  ({
    agentic_session_id: id(100),
    entity: { entityId: id(1), entityType: 'TASK' },
    provider_session_id: 'provider-one',
    contextMetadata: { organizationId: 'org', projectId: 'project' },
    memos: [],
  }) as unknown as AgenticSession;
const handler = (role: SessionRole): PromptTypeHandler<object> =>
  ({ sessionRole: role, buildPrompt: () => '' }) as unknown as PromptTypeHandler<object>;
const envelope = (data: object) => ({ data: { success: true, data } }) as any;
let contextRead: ReturnType<typeof vi.spyOn>;
let adviceRead: ReturnType<typeof vi.spyOn>;
let proposalRead: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(readActiveWorkItemTypeDefinitions).mockResolvedValue(
    ['STANDARD', 'FEATURE', 'mockup', 'DIAGRAM', 'custom'].map((key) => ({
      key,
      name: key,
    })) as any,
  );
  contextRead = vi
    .spyOn(EntityContextApi.prototype, 'getEntityContext')
    .mockImplementation(async ({ entityId }) =>
      envelope({
        entityId,
        entityType: 'TASK',
        taskType: entityId === id(1) ? 'STANDARD' : entityId === id(3) ? 'FEATURE' : 'mockup',
        displayName: 'Selected item',
        createdAt: 'now',
        content: { sections: {}, status: 'BACKLOG' },
        featureHierarchy:
          entityId === id(1)
            ? [{ id: id(3), relationshipType: 'structural', relationship: 'ancestor', distance: 1 }]
            : [],
      }),
    );
  adviceRead = vi
    .spyOn(WorkItemTypesApi.prototype, 'getWorkItemTypeGuidanceBatch')
    .mockImplementation(async ({ workItemTypeGuidanceBatchRequestDto: request }) =>
      envelope({
        results: request.typeKeys.map((typeKey) => ({
          typeKey,
          name: typeKey,
          sessionRole: request.sessionRole,
          ...(typeKey === 'STANDARD'
            ? {}
            : { guidance: `${typeKey} ${request.sessionRole} advice` }),
        })),
      }),
    );
  proposalRead = vi.spyOn(ProposalsApi.prototype, 'getProposal');
});
afterEach(() => vi.restoreAllMocks());
const owner = () => new SessionRoleGuidance(createPromptTypeHandlerTestDeps());
describe('effective role advice and provider continuity', () => {
  it.each(Object.values(SessionRole))(
    'selects advice for executing %s role and preserves omissions',
    async (role) => {
      const result = await owner().prepare({
        session: session(),
        handler: handler(role),
        payload: { userMessage: mention(2) },
        fresh: true,
      });
      expect(result.text).toContain(`mockup ${role} advice`);
      expect(result.text).toContain(`FEATURE ${role} advice`);
      expect(result.text).not.toContain('STANDARD advice');
      expect(result.deliveryKeys).toContain(`${role}:STANDARD`);
    },
  );
  it('excludes fallback with an empty frame, and ignores combined plan discussion and report-like text', async () => {
    const result = await owner().prepare({
      session: session(),
      handler: handler('implementation'),
      payload: {
        frame: { nodes: [] },
        _approvedPlan: mention(4),
        planningDiscussion: mention(5),
        _approvedPlanMarkdown: mention(2),
      },
      fresh: true,
    });
    expect(result.resolutions.map((r) => r.id)).toEqual([id(1), id(2)]);
    expect(contextRead).not.toHaveBeenCalledWith(expect.objectContaining({ entityId: id(3) }));
  });
  it('deduplicates after handoff, survives process restoration, and redelivers accumulated advice on remint', async () => {
    const store = createTestRunStore();
    const current = session();
    vi.spyOn(store, 'updateRunSessionContext').mockImplementation(async (_runId, context) => {
      current.sessionContext = { ...current.sessionContext, ...context };
      return current;
    });
    const firstOwner = new SessionRoleGuidance(createPromptTypeHandlerTestDeps(), store);
    const first = await firstOwner.prepare({
      session: current,
      handler: handler('implementation'),
      payload: { userMessage: mention(2) },
      fresh: true,
    });
    expect(
      (
        await firstOwner.prepare({
          session: current,
          handler: handler('implementation'),
          payload: {},
          fresh: true,
        })
      ).text,
    ).toContain('mockup');
    await firstOwner.acknowledge(current, 'provider-one', first);
    const restored = new SessionRoleGuidance(createPromptTypeHandlerTestDeps(), store);
    expect(
      (
        await restored.prepare({
          session: current,
          handler: handler('implementation'),
          payload: {},
          fresh: false,
        })
      ).text,
    ).toBe('');
    expect(
      (
        await restored.prepare({
          session: current,
          handler: handler('research'),
          payload: {},
          fresh: false,
        })
      ).text,
    ).toContain('mockup research advice');
    expect(
      (
        await restored.prepare({
          session: current,
          handler: handler('implementation'),
          payload: {},
          fresh: true,
        })
      ).text,
    ).toContain('mockup');
  });
  it('delivers later discoveries once per type and preserves independent valid references', async () => {
    const current = session();
    const guidance = owner();
    const first = await guidance.prepare({
      session: current,
      handler: handler('implementation'),
      payload: {},
      fresh: true,
    });
    await guidance.acknowledge(current, 'provider-one', first);
    contextRead.mockImplementation(async ({ entityId }: any) => {
      if (entityId === id(4)) throw Error('not found');
      return envelope({
        entityId,
        entityType: 'TASK',
        taskType: entityId === id(2) ? 'mockup' : entityId === id(5) ? 'DIAGRAM' : 'STANDARD',
        displayName: 'Item',
        content: { sections: {}, status: entityId === id(5) ? 'ARCHIVED' : 'BACKLOG' },
      });
    });
    const later = await guidance.prepare({
      session: current,
      handler: handler('implementation'),
      payload: { userMessage: [mention(2), mention(4), mention(5)].join(' ') },
      fresh: false,
    });
    expect(later.text).toContain('mockup implementation advice');
    expect(later.resolutions.find((r) => r.id === id(4))?.status).toBe('unresolved');
    expect(later.resolutions.find((r) => r.id === id(5))?.status).toBe('archived');
    expect(later.deliveryKeys).not.toContain('implementation:DIAGRAM');
  });
  it('retains proposal identity and exact future state, uses CREATE type without reading placeholder or proposal prose', async () => {
    proposalRead.mockImplementation(async ({ proposalId }: any) =>
      envelope({
        id: proposalId,
        action: proposalId === id(6) ? 'CREATE' : 'VERSIONED_UPDATE',
        status: 'PENDING',
        targetEntityId: proposalId === id(6) ? 'placeholder' : id(2),
        targetEntityType: 'TASK',
        title: 'Future design',
        reviewedFuture: proposalId === id(6) ? null : { id: id(8) },
        updates: { type: 'custom', description: mention(9) },
      }),
    );
    const result = await owner().prepare({
      session: session(),
      handler: handler('implementation'),
      payload: {
        frame: { nodes: [] },
        userMessage: `${mention(6, 'proposal')} ${mention(7, 'proposal')}`,
      },
      fresh: true,
    });
    expect(result.resolutions.find((r) => r.id === id(6))).toMatchObject({
      typeKey: 'custom',
      proposal: { approvalState: 'PENDING', action: 'CREATE', targetId: 'placeholder' },
    });
    expect(result.resolutions.find((r) => r.id === id(7))).toMatchObject({
      typeKey: 'mockup',
      proposal: { id: id(7), futureId: id(8), approvalState: 'PENDING' },
    });
    expect(contextRead).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'placeholder' }),
    );
    expect(result.resolutions.some((r) => r.id === id(9))).toBe(false);
  });
  it('isolates failed advice keys, retries them after acknowledgement, and batches at most ten', async () => {
    const normal = adviceRead.getMockImplementation()!;
    adviceRead.mockImplementation(async (request: any) => {
      if (request.workItemTypeGuidanceBatchRequestDto.typeKeys.includes('mockup'))
        throw Error('unavailable');
      return normal(request);
    });
    const current = session();
    const guidance = owner();
    const first = await guidance.prepare({
      session: current,
      handler: handler('implementation'),
      payload: { userMessage: mention(2) },
      fresh: true,
    });
    expect(first.failedTypeKeys).toEqual(['mockup']);
    expect(first.deliveryKeys).toContain('implementation:FEATURE');
    expect(first.deliveryKeys).not.toContain('implementation:mockup');
    await guidance.acknowledge(current, 'provider-one', first);
    adviceRead.mockImplementation(normal);
    expect(
      (
        await guidance.prepare({
          session: current,
          handler: handler('implementation'),
          payload: {},
          fresh: false,
        })
      ).text,
    ).toContain('mockup');
  });
  it('uses batches of ten distinct supported keys', async () => {
    const keys = Array.from({ length: 12 }, (_, index) => `custom_${index}`);
    vi.mocked(readActiveWorkItemTypeDefinitions).mockResolvedValue(
      keys.map((key) => ({ key, name: key })) as any,
    );
    contextRead.mockImplementation(async ({ entityId }: any) =>
      envelope({
        entityId,
        entityType: 'TASK',
        taskType: keys[Number(entityId.slice(-12)) - 20],
        displayName: 'Custom item',
        content: { sections: {}, status: 'BACKLOG' },
      }),
    );
    const current = session();
    current.entity = null;
    const result = await owner().prepare({
      session: current,
      handler: handler('review'),
      payload: { userMessage: keys.map((_, index) => mention(20 + index)).join(' ') },
      fresh: true,
    });
    expect(result.deliveryKeys).toHaveLength(12);
    expect(
      adviceRead.mock.calls.map(
        ([request]: any) => request.workItemTypeGuidanceBatchRequestDto.typeKeys.length,
      ),
    ).toEqual([10, 2]);
  });
  it('keeps non-work-item kinds without inventing advice and does not coerce unresolved TASK types', async () => {
    contextRead.mockImplementation(async ({ entityId }: any) =>
      envelope({
        entityId,
        entityType: entityId === id(2) ? 'SERVICE' : 'TASK',
        displayName: 'Selected item',
        content: { sections: {}, status: 'BACKLOG' },
      }),
    );
    const result = await owner().prepare({
      session: session(),
      handler: handler('implementation'),
      payload: { frame: { nodes: [] }, userMessage: mention(2, 'service') },
      fresh: true,
    });
    expect(result.resolutions.find((r) => r.id === id(2))).toMatchObject({
      kind: 'SERVICE',
      status: 'resolved',
    });
    expect(result.resolutions.find((r) => r.id === id(1))).toMatchObject({ status: 'unresolved' });
    expect(adviceRead).not.toHaveBeenCalled();
  });
  it('retains selections and distinguishes a shared read failure from omitted advice', async () => {
    const deps = createPromptTypeHandlerTestDeps();
    const token = vi
      .spyOn(deps.auth, 'getAccessToken')
      .mockRejectedValue(Error('access unavailable'));
    const guidance = new SessionRoleGuidance(deps);
    const current = session();
    const failed = await guidance.prepare({
      session: current,
      handler: handler('implementation'),
      payload: { userMessage: mention(2) },
      fresh: true,
    });
    expect(failed.resolutions.every((r) => r.status === 'unresolved')).toBe(true);
    expect(failed.deliveryKeys).toEqual([]);
    token.mockResolvedValue('token');
    expect(
      (
        await guidance.prepare({
          session: current,
          handler: handler('implementation'),
          payload: {},
          fresh: false,
        })
      ).text,
    ).toContain('mockup');
  });
  it('excludes archived work items when Context omits lifecycle status', async () => {
    contextRead.mockImplementation(async ({ entityId }: any) =>
      envelope({
        entityId,
        entityType: 'TASK',
        taskType: entityId === id(2) ? 'FEATURE' : 'STANDARD',
        displayName: 'Item',
        content: { sections: {}, ...(entityId === id(2) ? {} : { status: 'ACTIVE' }) },
      }),
    );
    const statusRead = vi
      .spyOn(TasksApi.prototype, 'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet')
      .mockResolvedValue(envelope({ id: id(2), type: 'FEATURE', status: 'ARCHIVED' }));
    const result = await owner().prepare({
      session: session(),
      handler: handler('implementation'),
      payload: { frame: { nodes: [] }, userMessage: mention(2, 'old_feature_alias') },
      fresh: true,
    });
    expect(statusRead).toHaveBeenCalledOnce();
    expect(result.resolutions.find((r) => r.id === id(2))?.status).toBe('archived');
    expect(result.deliveryKeys).not.toContain('implementation:FEATURE');
  });
  it.each(['PENDING', 'APPROVED'])(
    'resolves an ordinary %s proposal without treating approval as delivery',
    async (approvalState) => {
      proposalRead.mockResolvedValue(
        envelope({
          id: id(6),
          action: 'UPDATE',
          status: approvalState,
          targetEntityId: id(2),
          targetEntityType: 'TASK',
          reviewedFuture: null,
          updates: { description: mention(9) },
        }),
      );
      const result = await owner().prepare({
        session: session(),
        handler: handler('implementation'),
        payload: {
          frame: { nodes: [] },
          userMessage: `${mention(6, 'proposal')} ${mention(2, 'mockup')}`,
        },
        fresh: true,
      });
      expect(result.resolutions.find((r) => r.id === id(6))).toMatchObject({
        typeKey: 'mockup',
        proposal: { id: id(6), approvalState, targetId: id(2) },
      });
      expect(result.deliveryKeys.filter((key) => key === 'implementation:mockup')).toHaveLength(1);
      expect(result.resolutions.some((r) => r.id === id(9))).toBe(false);
    },
  );
  it('activates later frame and approved-plan mentions through the same selector', async () => {
    const guidance = owner();
    const current = session();
    const first = await guidance.prepare({
      session: current,
      handler: handler('implementation'),
      payload: { frame: { nodes: [] } },
      fresh: true,
    });
    await guidance.acknowledge(current, 'provider-one', first);
    const later = await guidance.prepare({
      session: current,
      handler: handler('implementation'),
      payload: {
        frame: { nodes: [{ id: id(2), type: 'TASK' }] },
        _approvedPlanMarkdown: mention(2),
      },
      fresh: false,
    });
    expect(later.text).toContain('mockup implementation advice');
    expect(later.resolutions.find((r) => r.id === id(2))?.sources).toEqual([
      'research-frame',
      'approved-plan',
    ]);
    await guidance.acknowledge(current, 'provider-one', later);
    expect(
      (
        await guidance.prepare({
          session: current,
          handler: handler('implementation'),
          payload: { userMessage: mention(2) },
          fresh: false,
        })
      ).text,
    ).toBe('');
  });
  it('logs distinct effective types and all source categories at info level without source content', async () => {
    const deps = createPromptTypeHandlerTestDeps();
    const info = vi.spyOn(deps.logger, 'info');
    await new SessionRoleGuidance(deps).prepare({
      session: session(),
      handler: handler('implementation'),
      payload: {
        frame: { nodes: [{ id: id(2), type: 'TASK' }] },
        _approvedPlanMarkdown: `private plan ${mention(2)}`,
        userMessage: `private user message ${mention(2)}`,
      },
      fresh: true,
    });
    expect(info).toHaveBeenCalledExactlyOnceWith(
      'session_role_guidance.types_selected',
      expect.objectContaining({
        runId: id(100),
        providerSessionId: 'provider-one',
        role: 'implementation',
        sourcesInspected: {
          focalAvailable: true,
          researchFrameAvailable: true,
          taskParentFallbackEnabled: false,
          approvedPlanAvailable: true,
          userMessageCount: 1,
          referenceCount: 2,
        },
        types: [
          { typeKey: 'STANDARD', sources: ['focal'] },
          { typeKey: 'mockup', sources: ['research-frame', 'approved-plan', 'user-message'] },
        ],
        archivedReferenceCount: 0,
        unresolvedReferenceCount: 0,
        failedTypeKeys: [],
      }),
    );
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain('private plan');
    expect(logged).not.toContain('private user message');
    expect(logged).not.toContain('mockup implementation advice');
  });
  it('logs an empty selection explicitly', async () => {
    const deps = createPromptTypeHandlerTestDeps();
    const info = vi.spyOn(deps.logger, 'info');
    const current = session();
    current.entity = null;
    await new SessionRoleGuidance(deps).prepare({
      session: current,
      handler: handler('research'),
      payload: {},
      fresh: true,
    });
    expect(info).toHaveBeenCalledExactlyOnceWith(
      'session_role_guidance.types_selected',
      expect.objectContaining({
        types: [],
        unresolvedReferenceCount: 0,
        sourcesInspected: expect.objectContaining({
          referenceCount: 0,
          approvedPlanAvailable: false,
          userMessageCount: 0,
        }),
      }),
    );
  });
  it('logs unresolved selections after a shared read failure', async () => {
    const deps = createPromptTypeHandlerTestDeps();
    const info = vi.spyOn(deps.logger, 'info');
    vi.spyOn(deps.auth, 'getAccessToken').mockRejectedValue(Error('unavailable'));
    await new SessionRoleGuidance(deps).prepare({
      session: session(),
      handler: handler('implementation'),
      payload: { frame: { nodes: [] }, userMessage: mention(2) },
      fresh: true,
    });
    expect(info).toHaveBeenCalledExactlyOnceWith(
      'session_role_guidance.types_selected',
      expect.objectContaining({ types: [], unresolvedReferenceCount: 2 }),
    );
  });
});

import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { TaskSectionSchemaValidatorRegistry } from '../../tasks/task-section-schema-validator.registry';
import { of, throwError, defer } from 'rxjs';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import { TaskService } from '../../tasks/task.service';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import { createWarmWorkItemTypeRegistry } from '../../../../test/setup/work-item-type-registry.fixture';
import { Logger } from '@nestjs/common';
import { buildProductionLogEnvelope } from '../../../common/logger/production-log-envelope';
import { workItemChangeSetValidationRequestSchema } from '../work-item-change-set.schema';
import {
  Prisma,
  WorkItemChangeSetCheckpointStatus,
  WorkItemChangeSetMaterializationStatus,
} from '@prisma/client';
import { WorkItemChangeSetMaterializerService } from '../work-item-change-set-materializer.service';
import { deriveChangedFields } from '../entity-context-resolver';
import type { OrganizationId, ProjectId } from 'src/types';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';

describe('WorkItemChangeSetMaterializerService', () => {
  describe('scalar and section postcondition evidence', () => {
    const params = {
      proposalId: 'proposal-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
    };
    const mappings = {
      workItems: { 'temporary:goal': 'goal-id' },
      relationships: {},
    };
    const ref = { refType: 'temporary', tempId: 'goal' } as const;

    it.each([
      '2026-10-20T00:00:00Z',
      '2026-10-20T00:00:00.000Z',
      '2026-10-19T17:00:00-07:00',
      null,
      undefined,
    ])(
      'recognizes a persisted GOAL date %s without rewriting it',
      async (dueDate) => {
        const { service, prisma } = createService();
        prisma.db.task.findFirst.mockResolvedValue({
          name: 'Goal',
          type: 'GOAL',
          parentTaskId: null,
          serviceRelations: [],
          dueDate: dueDate ? new Date(dueDate) : null,
        });
        const issues: unknown[] = [];
        for (const op of ['workItem.create', 'workItem.update']) {
          expect(
            await (service as any).verifyOperationPostcondition(
              params,
              { op, ref, name: 'Goal', type: 'GOAL', dueDate },
              mappings,
              issues,
              0,
            ),
          ).toBe(true);
        }
        expect(issues).toEqual([]);
      },
    );

    it('persists a genuine date mismatch with field, values and stable correlation', async () => {
      const { service, prisma } = createService();
      prisma.db.task.findFirst.mockResolvedValue({
        name: 'Goal',
        type: 'GOAL',
        parentTaskId: null,
        serviceRelations: [],
        dueDate: new Date('2026-10-21T00:00:00Z'),
      });
      jest.spyOn(service as any, 'applyOperation').mockResolvedValue(undefined);
      const failed = jest
        .spyOn(service as any, 'markCheckpointFailed')
        .mockResolvedValue(undefined);
      const completed = jest
        .spyOn(service as any, 'markCheckpointCompleted')
        .mockResolvedValue(undefined);
      let caught: any;
      try {
        await (service as any).applyCheckpoint(
          params,
          { id: 'materialization-1' },
          { id: 'checkpoint-1', operationIndex: 0 },
          {
            op: 'workItem.create',
            ref,
            name: 'Goal',
            type: 'GOAL',
            dueDate: '2026-10-20T00:00:00Z',
          },
          mappings,
          'claim-1',
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();
      const diagnostic = caught.getResponse().diagnostic;
      expect(diagnostic.issues).toEqual([
        expect.objectContaining({
          field: 'operations[0].dueDate',
          code: 'POSTCONDITION_MISMATCH',
          reason: expect.stringContaining(
            'expected 2026-10-20T00:00:00Z; actual 2026-10-21T00:00:00.000Z',
          ),
        }),
      ]);
      expect(failed.mock.calls[0]![4]).toEqual(
        expect.objectContaining({
          diagnostic: expect.objectContaining({
            correlationId: diagnostic.correlationId,
            issues: diagnostic.issues,
          }),
        }),
      );
      expect(completed).not.toHaveBeenCalled();
    });

    it('reports missing records and redacts section content', async () => {
      const { service, prisma } = createService();
      prisma.db.task.findFirst.mockResolvedValue(null);
      const issues: any[] = [];
      expect(
        await (service as any).verifyOperationPostcondition(
          params,
          { op: 'workItem.create', ref, name: 'Goal' },
          mappings,
          issues,
          2,
        ),
      ).toBe(false);
      expect(issues[0].field).toBe('operations[2].ref');
      prisma.db.taskSection = {
        findFirst: jest
          .fn()
          .mockResolvedValue({ materializedMarkdown: 'private actual' }),
      };
      jest
        .spyOn(service as any, 'materializedSectionContent')
        .mockResolvedValue('private expected');
      issues.length = 0;
      expect(
        await (service as any).verifyOperationPostcondition(
          params,
          {
            op: 'section.replace',
            ref,
            key: 'description',
            content: 'private expected',
          },
          mappings,
          issues,
          1,
        ),
      ).toBe(false);
      expect(issues[0]).toEqual(
        expect.objectContaining({
          field: 'sections.description.content',
          reason:
            'Persisted value differs: expected [redacted text, 16 characters]; actual [redacted text, 14 characters].',
        }),
      );
      expect(JSON.stringify(issues)).not.toContain('private');
    });
  });

  it('removes one checkpoint cycle from section-only edits while preserving mutation and retry', async () => {
    const compare = async (legacy: boolean) => {
      const { service, prisma } = createService();
      const request = service.taskProposalChangeSet({
        id: 'proposal-1',
        action: 'UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: 'task-1',
        updates: {
          sections: [{ key: 'description', content: 'New description' }],
        },
      } as any)!;
      expect(request.operations.map((operation) => operation.op)).toEqual([
        'section.replace',
      ]);
      const operations = legacy
        ? [
            { op: 'workItem.update' as const, ref: request.root },
            ...request.operations,
          ]
        : request.operations;
      let committed = false;
      const verify = jest
        .spyOn(service as any, 'verifyOperationPostcondition')
        .mockImplementation(
          async (_params, operation: any) =>
            operation.op === 'workItem.update' || committed,
        );
      const mutate = jest
        .spyOn(service as any, 'applyOperation')
        .mockImplementation(async () => {
          committed = true;
        });
      jest
        .spyOn(service as any, 'assertClaimOwned')
        .mockResolvedValue(undefined);
      const timing = jest.spyOn((service as any).logger, 'debug');
      const apply = (operation: any, index: number) =>
        (service as any).applyCheckpoint(
          {
            proposalId: 'proposal-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
          },
          { id: 'materialization-1' },
          { id: `checkpoint-${index}`, operationIndex: index },
          operation,
          { workItems: { 'existing:task-1': 'task-1' }, relationships: {} },
          'claim-1',
        );
      for (const [index, operation] of operations.entries())
        await apply(operation, index);
      const counts = {
        renewals:
          prisma.db.workItemChangeSetMaterialization.updateMany.mock.calls
            .length,
        checkpointTransactions: prisma.db.$transaction.mock.calls.length,
        postconditionChecks: verify.mock.calls.length,
        mutations: mutate.mock.calls.length,
      };
      expect(committed).toBe(true);
      // Retry after the section write committed re-enters the guarded write,
      // whose reconciliation receipt acknowledges it without writing again.
      await apply(request.operations[0], operations.length - 1);
      expect(mutate).toHaveBeenCalledTimes(counts.mutations + 1);
      expect(timing).toHaveBeenCalledWith(
        'Generic checkpoint timing',
        expect.objectContaining({
          operationKind: 'section.replace',
          outcome: 'completed',
          alreadySatisfied: true,
          phaseMs: expect.objectContaining({
            'proposal.change_set.checkpoint.precheck': expect.any(Number),
            'proposal.change_set.checkpoint.completed': expect.any(Number),
          }),
        }),
      );
      return counts;
    };
    expect(await compare(true)).toEqual({
      renewals: 2,
      checkpointTransactions: 4,
      postconditionChecks: 4,
      mutations: 2,
    });
    expect(await compare(false)).toEqual({
      renewals: 1,
      checkpointTransactions: 2,
      postconditionChecks: 2,
      mutations: 1,
    });
  });

  it('preserves explicit scalar clears and the checkpoint for an empty update', () => {
    const { service } = createService();
    const build = (updates: unknown) =>
      service.taskProposalChangeSet({
        id: 'proposal-1',
        action: 'UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: 'task-1',
        updates,
      } as any)!;
    expect(
      build({
        dueDate: null,
        sections: [{ key: 'description', content: 'Body' }],
      }).operations,
    ).toEqual([
      {
        op: 'workItem.update',
        ref: { refType: 'existing', id: 'task-1' },
        dueDate: null,
      },
      {
        op: 'section.replace',
        ref: { refType: 'existing', id: 'task-1' },
        key: 'description',
        content: 'Body',
      },
    ]);
    expect(build({}).operations).toHaveLength(1);
  });
  it.each(['mixed', 'transport'])(
    'persists and logs a field-addressable relationship %s failure with stable correlation',
    async (mode) => {
      const { service, prisma, agentEdgeClient } = createService();
      const errorLog = jest.spyOn((service as any).logger, 'error');
      const sourceId = '123e4567-e89b-42d3-a456-426614174100';
      const targetId = '123e4567-e89b-42d3-a456-426614174101';
      const entries = [42, 43].map((index) => ({
        index,
        checkpoint: { id: `checkpoint-${index}` },
        operation: {
          op: 'relationship.create',
          ref: { refType: 'temporary', tempId: `x${index}` },
          source: { refType: 'existing', id: sourceId },
          target: { refType: 'existing', id: targetId },
          edgeType: 'RELATED_TO',
          category: 'meta',
        },
      }));
      const mappings = {
        workItems: {
          [`existing:${sourceId}`]: sourceId,
          [`existing:${targetId}`]: targetId,
        },
        relationships: {
          'temporary:x42': '123e4567-e89b-42d3-a456-426614174102',
          'temporary:x43': '123e4567-e89b-42d3-a456-426614174103',
        },
      };
      const reason = 'Graph relationship write timed out';
      if (mode === 'transport') {
        agentEdgeClient.createBatch.mockRejectedValue(new Error(reason));
      } else {
        agentEdgeClient.createBatch.mockImplementation(
          async (_org, _project, dtos) => [
            { index: 0, success: false, error: reason },
            { index: 1, success: true, edge: dtos[1] },
          ],
        );
      }
      await expect(
        (service as any).applyRelationshipCreateBatch(
          {
            proposalId: 'proposal-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
          },
          { id: 'materialization-1' },
          entries,
          mappings,
          'claim-1',
        ),
      ).rejects.toThrow(reason);
      const failed =
        prisma.db.workItemChangeSetMaterializationCheckpoint.update.mock.calls.find(
          ([input]) =>
            input.data.status === WorkItemChangeSetCheckpointStatus.FAILED,
        )![0];
      const persisted = JSON.parse(failed.data.lastError);
      expect(persisted.diagnostic.issues).toEqual([
        {
          field: 'operations[42]',
          code: 'CHECKPOINT_APPLICATION_FAILED',
          reason,
          layer: 'structural',
        },
      ]);
      expect(errorLog).toHaveBeenCalledWith(
        'Generic change-set checkpoint failed',
        expect.objectContaining({
          operationIndex: 42,
          fieldPath: 'operations[42]',
          reason,
          diagnosticCorrelationId: persisted.diagnostic.correlationId,
        }),
      );
      if (mode === 'mixed') {
        expect(
          prisma.db.workItemChangeSetMaterializationCheckpoint.update,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'checkpoint-43' },
            data: expect.objectContaining({
              status: WorkItemChangeSetCheckpointStatus.COMPLETED,
            }),
          }),
        );
      }
    },
  );

  it('records bounded evidence for each failed relationship batch entry', async () => {
    const { service, prisma, agentEdgeClient } = createService();
    const errorLog = jest.spyOn((service as any).logger, 'error');
    const sourceId = '123e4567-e89b-42d3-a456-426614174100';
    const targetId = '123e4567-e89b-42d3-a456-426614174101';
    const entries = [50, 51, 52, 53].map((index) => ({
      index,
      checkpoint: { id: `checkpoint-${index}` },
      operation: {
        op: 'relationship.create',
        ref: { refType: 'temporary', tempId: `x${index}` },
        source: { refType: 'existing', id: sourceId },
        target: { refType: 'existing', id: targetId },
        edgeType: 'RELATED_TO',
        category: 'meta',
        metadata: { privateNote: 'do not log' },
      },
    }));
    const mappings = {
      workItems: {
        [`existing:${sourceId}`]: sourceId,
        [`existing:${targetId}`]: targetId,
      },
      relationships: Object.fromEntries(
        [50, 51, 52, 53].map((index) => [
          `temporary:x${index}`,
          `123e4567-e89b-42d3-a456-4266141742${index}`,
        ]),
      ),
    };
    agentEdgeClient.createBatch.mockImplementation(
      async (_org, _project, dtos) => [
        { index: 0, success: false },
        { index: 1, success: true, edge: null },
        {
          index: 2,
          success: true,
          edge: { ...dtos[2], type: 'DEPENDS_ON', metadata: { other: 1 } },
        },
        { index: 3, success: true, edge: dtos[3] },
      ],
    );

    await expect(
      (service as any).applyRelationshipCreateBatch(
        {
          proposalId: 'proposal-1',
          organizationId: 'organization-1',
          projectId: 'project-1',
        },
        { id: 'materialization-1' },
        entries,
        mappings,
        'claim-1',
      ),
    ).rejects.toThrow(
      'Operation 50 was reported unsuccessful by Graph without an error.',
    );

    const evidence = errorLog.mock.calls
      .filter(([message]) => message === 'Relationship batch entry failed')
      .map(([, attributes]) => attributes);
    expect(evidence).toEqual([
      expect.objectContaining({
        operationIndex: 50,
        operationKind: 'relationship.create',
        success: false,
        edgeReturned: false,
        graphError: null,
        mismatchedFields: [],
      }),
      expect.objectContaining({
        operationIndex: 51,
        success: true,
        edgeReturned: false,
        mismatchedFields: [],
      }),
      expect.objectContaining({
        operationIndex: 52,
        success: true,
        edgeReturned: true,
        mismatchedFields: ['type', 'metadata'],
      }),
    ]);
    expect(JSON.stringify(evidence)).not.toContain('do not log');
    expect(
      prisma.db.workItemChangeSetMaterializationCheckpoint.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'checkpoint-53' },
        data: expect.objectContaining({
          status: WorkItemChangeSetCheckpointStatus.COMPLETED,
        }),
      }),
    );
  });

  it('keeps a published approval successful when deferred-link handoff fails', async () => {
    const { service, prisma } = createService();
    prisma.db.$transaction = jest
      .fn()
      .mockRejectedValue(new Error('pending store unavailable'));
    await expect(
      (service as any).handoffDeferredEntityEdgesAfterChangeSetPublication(
        'materialization-1',
        {
          id: 'diagram-proposal',
          edges: [],
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('reaches deferred-link recovery when the intent was already published', async () => {
    const { service } = createService();
    jest.spyOn(service as any, 'prepareIntent').mockResolvedValue({
      id: 'materialization-1',
      status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
      targetProjection: { projection: { valid: true } },
    });
    jest.spyOn(service as any, 'requirePublishedResult').mockResolvedValue({
      proposal: { id: 'proposal-1', targetEntityId: 'diagram-id' },
      rootWorkItemId: 'diagram-id',
    });
    const handoff = jest
      .spyOn(
        service as any,
        'handoffDeferredEntityEdgesAfterChangeSetPublication',
      )
      .mockResolvedValue(undefined);

    await service.materializeApprovedChangeSet({
      proposalId: 'proposal-1',
      organizationId: 'organization-1' as any,
      projectId: 'project-1' as any,
    });

    expect(handoff).toHaveBeenCalledWith(
      'materialization-1',
      expect.objectContaining({ id: 'proposal-1' }),
    );
  });

  it('hands off Diagram root and element links once after publication, including approved targets', async () => {
    const { service, prisma } = createService();
    const pending = {
      storeDeferredEntityEdgeAfterChangeSetPublication: jest
        .fn()
        .mockResolvedValue(undefined),
      resolveChangeSetDeferredEntityEdgesTargetingApprovedProposal: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    (service as any).pendingEdgeService = pending;
    const request = {
      root: { refType: 'temporary', tempId: 'diagram' },
      operations: [],
    };
    const intent = {
      id: 'materialization-1',
      operationSet: request,
      workItemIdMappings: {
        'temporary:diagram': 'diagram-id',
        'temporary:element': 'element-id',
      },
      relationshipIdMappings: {},
      validationRevision: 'revision-1',
    };
    const proposal = {
      id: 'diagram-proposal',
      organizationId: 'organization-1',
      projectId: 'project-1',
      targetEntityId: 'diagram-id',
      targetEntityType: 'TASK',
      edges: [
        {
          targetEntityId: 'approved-proposal',
          targetEntityType: 'PROPOSAL',
          edgeType: 'RELATED_TO',
          sourceRef: { refType: 'temporary', tempId: 'element' },
        },
        {
          targetEntityId: 'pending-proposal',
          targetEntityType: 'PROPOSAL',
          edgeType: 'DEPENDS_ON',
        },
        {
          endpointMode: 'PROPOSAL',
          targetEntityId: 'durable-proposal',
          targetEntityType: 'PROPOSAL',
          edgeType: 'RELATED_TO',
        },
      ],
    };
    let completed = false;
    const tx = {
      workItemChangeSetMaterialization: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
      },
      workItemChangeSetMaterializationCheckpoint: {
        findFirst: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve(completed ? { status: 'COMPLETED' } : null),
          ),
        create: jest.fn().mockImplementation(() => {
          completed = true;
          return Promise.resolve({});
        }),
      },
      proposal: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({
            status: where.id === 'approved-proposal' ? 'APPROVED' : 'DRAFT',
          }),
        ),
        findMany: jest.fn().mockResolvedValue([
          {
            ...proposal,
            id: 'approved-proposal',
            targetEntityId: 'mockup-id',
          },
        ]),
      },
    };
    prisma.db.$transaction = jest.fn(async (callback: (tx: any) => unknown) =>
      callback(tx),
    );

    await (service as any).handoffDeferredEntityEdgesAfterChangeSetPublication(
      intent.id,
      proposal,
    );
    await (service as any).handoffDeferredEntityEdgesAfterChangeSetPublication(
      intent.id,
      proposal,
    );

    expect(
      pending.storeDeferredEntityEdgeAfterChangeSetPublication,
    ).toHaveBeenCalledTimes(2);
    expect(
      pending.storeDeferredEntityEdgeAfterChangeSetPublication,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        sourceEntityId: 'element-id',
        targetProposalId: 'approved-proposal',
      }),
    );
    expect(
      pending.storeDeferredEntityEdgeAfterChangeSetPublication,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        sourceEntityId: 'diagram-id',
        targetProposalId: 'pending-proposal',
      }),
    );
    expect(
      pending.resolveChangeSetDeferredEntityEdgesTargetingApprovedProposal,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'approved-proposal' }),
      'mockup-id',
    );
    expect(
      pending.resolveChangeSetDeferredEntityEdgesTargetingApprovedProposal,
    ).toHaveBeenCalledWith(proposal, 'diagram-id');
    expect(
      tx.workItemChangeSetMaterializationCheckpoint.create,
    ).toHaveBeenCalledTimes(1);
  });

  it('snapshots only readable section-written items with the fields their readers use', async () => {
    const { service, prisma } = createService();
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'root',
        type: 'FEATURE',
        projectId: 'project',
        sections: [{ key: 'description', materializedMarkdown: 'Before' }],
      },
    ]);
    Object.assign(prisma.db, { task: { findMany } });
    const sectionWrite = (id: string) => ({
      op: 'section.replace',
      ref: { refType: 'existing', id },
      key: 'description',
      content: 'After',
    });

    const result = await (service as any).capturePriorSectionSnapshots(
      prisma.db,
      'organization',
      {
        root: { refType: 'existing', id: 'root' },
        operations: [
          sectionWrite('root'),
          sectionWrite('orphan'),
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'new' },
            key: 'description',
            content: 'Created',
          },
          { op: 'workItem.update', ref: { refType: 'existing', id: 'child' } },
        ],
      },
      {
        workItems: {
          'existing:root': 'root',
          'existing:orphan': 'orphan',
          'existing:child': 'child',
          'temporary:new': 'new-id',
        },
        relationships: {},
      },
      new Set(['orphan']),
    );

    expect(result).toEqual({
      root: {
        type: 'FEATURE',
        projectId: 'project',
        sections: [{ key: 'description', materializedMarkdown: 'Before' }],
      },
    });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ['root'] }, organizationId: 'organization' },
      select: {
        id: true,
        type: true,
        projectId: true,
        sections: { select: { key: true, materializedMarkdown: true } },
      },
    });
  });

  it('still rejects a physically missing record during snapshot preparation', async () => {
    const { service, prisma } = createService();
    Object.assign(prisma.db, {
      task: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await expect(
      (service as any).capturePriorSectionSnapshots(
        prisma.db,
        'organization',
        {
          root: { refType: 'existing', id: 'missing' },
          operations: [
            {
              op: 'section.clear',
              ref: { refType: 'existing', id: 'missing' },
              key: 'description',
            },
          ],
        },
        { workItems: { 'existing:missing': 'missing' }, relationships: {} },
        new Set(),
      ),
    ).rejects.toThrow('disappeared while preparing materialization');
  });

  describe('single-proposal prepare', () => {
    const rootId = '123e4567-e89b-42d3-a456-426614174200';
    const childIds = [1, 2, 3].map(
      (index) => `123e4567-e89b-42d3-a456-42661417421${index}`,
    );
    const params = {
      proposalId: 'proposal-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
    };

    const setUp = () => {
      const context = createService();
      const { service, prisma, projector, taskService, agentEdgeClient } =
        context;
      const request = service.taskProposalChangeSet({
        id: 'proposal-1',
        action: 'UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: rootId,
        updates: { sections: [{ key: 'description', content: 'After' }] },
      } as any)!;
      const childNode = (id: string) => ({
        ...projectionFor(id).projectedRoot,
        identity: { refType: 'existing' as const, id },
      });
      const projection = {
        ...projectionFor(rootId),
        children: childIds.map(childNode),
      };
      let transactionOpen = false;
      const graphCallsInsideTransaction: string[] = [];
      prisma.db.$transaction = jest.fn(async (callback: any) => {
        transactionOpen = true;
        try {
          return await callback(prisma.db);
        } finally {
          transactionOpen = false;
        }
      }) as any;
      projector.projectSnapshots.mockImplementation(async () => {
        if (transactionOpen) graphCallsInsideTransaction.push('project');
        return {
          unavailableWorkItemIds: new Set(),
          workItemKeys: [`existing:${rootId}`],
          relationshipKeys: [],
          prior: projection,
          target: projection,
        };
      });
      agentEdgeClient.findIncident.mockImplementation(async () => {
        if (transactionOpen) graphCallsInsideTransaction.push('findIncident');
        return [];
      });
      const findOne = jest.fn();
      Object.assign(taskService, { findOne });
      const taskFindMany = jest.fn().mockResolvedValue([
        {
          id: rootId,
          type: 'STANDARD',
          projectId: 'project-1',
          sections: [{ key: 'description', materializedMarkdown: 'Before' }],
        },
      ]);
      const findUnique = jest.fn().mockResolvedValue(null);
      const create = jest.fn(async ({ data, include }: any) => ({
        ...data,
        id: 'materialization-1',
        status: WorkItemChangeSetMaterializationStatus.PREPARED,
        checkpoints: include ? data.checkpoints.create : undefined,
      }));
      Object.assign(prisma.db, {
        proposal: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'proposal-1', updates: request }),
        },
        task: { findMany: taskFindMany },
      });
      Object.assign(prisma.db.workItemChangeSetMaterialization, {
        findUnique,
        create,
      });
      return {
        ...context,
        request,
        findOne,
        taskFindMany,
        findUnique,
        create,
        graphCallsInsideTransaction,
      };
    };

    it('reads, projects and stores a new intent without opening a transaction', async () => {
      const {
        service,
        prisma,
        projector,
        create,
        graphCallsInsideTransaction,
      } = setUp();

      const prepared = await (service as any).prepareIntent(params);

      expect(prisma.db.$transaction).not.toHaveBeenCalled();
      expect(graphCallsInsideTransaction).toEqual([]);
      expect(projector.projectSnapshots).toHaveBeenCalledTimes(1);
      expect(projector.projectSnapshots.mock.calls[0]![0]).not.toHaveProperty(
        'db',
      );
      expect(create).toHaveBeenCalledTimes(1);
      expect(prepared.id).toBe('materialization-1');
    });

    it('stores the supplied projection without projecting inside the transaction', async () => {
      const { service, prisma, projector, request, create } = setUp();
      const prepared = await service.projectPreparation({
        organizationId: params.organizationId as OrganizationId,
        projectId: params.projectId as ProjectId,
        request,
      });
      projector.projectSnapshots.mockClear();

      await prisma.db.$transaction((tx: AnyTransactionClient) =>
        service.enqueuePreparedIntent(tx, {
          ...(params as typeof params & {
            organizationId: OrganizationId;
            projectId: ProjectId;
          }),
          prepared,
        }),
      );

      expect(projector.projectSnapshots).not.toHaveBeenCalled();
      const data = create.mock.calls[0]![0].data;
      expect(data.validationRevision).toBe(prepared.validationRevision);
      expect(data.operationSet).toEqual(prepared.operationSet);
      expect(data.targetProjection.projection).toEqual(
        prepared.snapshots.target,
      );
      expect(data.priorProjection.projection).toEqual(prepared.snapshots.prior);
      expect(data.affectedWorkItemIds).toEqual([rootId]);
    });

    it('rejects resuming an existing intent whose revision differs from the supplied projection', async () => {
      const { service, prisma, projector, request, findUnique, create } =
        setUp();
      const prepared = await service.projectPreparation({
        organizationId: params.organizationId as OrganizationId,
        projectId: params.projectId as ProjectId,
        request,
      });
      projector.projectSnapshots.mockClear();
      findUnique.mockResolvedValue({
        id: 'materialization-1',
        validationRevision: 'stale-revision',
        status: WorkItemChangeSetMaterializationStatus.PREPARED,
        checkpoints: [],
      });

      await expect(
        prisma.db.$transaction((tx: AnyTransactionClient) =>
          service.enqueuePreparedIntent(tx, {
            ...(params as typeof params & {
              organizationId: OrganizationId;
              projectId: ProjectId;
            }),
            prepared,
          }),
        ),
      ).rejects.toThrow(
        'Stored work-item change-set validation revision does not match the proposal updates.',
      );
      expect(projector.projectSnapshots).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it('snapshots only the section-written root for a description edit on an item with children', async () => {
      const { service, findOne, taskFindMany, agentEdgeClient, create } =
        setUp();

      await (service as any).prepareIntent(params);

      expect(findOne).not.toHaveBeenCalled();
      expect(agentEdgeClient.findIncident).not.toHaveBeenCalled();
      expect(taskFindMany).toHaveBeenCalledTimes(1);
      expect(taskFindMany.mock.calls[0]![0].where.id.in).toEqual([rootId]);
      const stored = create.mock.calls[0]![0].data;
      expect(stored.priorProjection.workItems).toEqual({
        [rootId]: {
          type: 'STANDARD',
          projectId: 'project-1',
          sections: [{ key: 'description', materializedMarkdown: 'Before' }],
        },
      });
      // Children no validation read stay outside the claim footprint.
      expect(stored.affectedWorkItemIds).toEqual([rootId]);
      expect(stored.affectedRelationshipIds).toEqual([]);
    });

    it('resumes the winning row when a concurrent prepare stored the intent first', async () => {
      const { service, prisma, request, findUnique, create } = setUp();
      const revision = service.validationRevision(request);
      const winner = {
        ...preparedIntent({
          operationSet: { root: request.root as any, operations: [] },
          validationRevision: revision,
        }),
        id: 'winner',
        operationSet: request,
      };
      findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['proposal_id'] },
        }),
      );

      await expect((service as any).prepareIntent(params)).resolves.toBe(
        winner,
      );
      expect(findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.db.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a concurrent winner that fails the stored revision check', async () => {
      const { service, findUnique, create } = setUp();
      findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(
        preparedIntent({
          operationSet: {
            root: { refType: 'existing', id: rootId },
            operations: [],
          },
          validationRevision: 'stale-revision',
        }),
      );
      create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect((service as any).prepareIntent(params)).rejects.toThrow(
        'Stored work-item change-set validation revision does not match the proposal updates.',
      );
    });

    it('propagates insert failures other than a proposal uniqueness conflict', async () => {
      const { service, findUnique, create } = setUp();
      const failure = new Error('connection reset');
      create.mockRejectedValue(failure);

      await expect((service as any).prepareIntent(params)).rejects.toBe(
        failure,
      );
      expect(findUnique).toHaveBeenCalledTimes(1);
    });
  });

  it.each(['DIAGRAM_REFERENCE', 'AGENT', 'PERSON'])(
    'preserves %s through review parsing, section materialization and recovery verification',
    async (role) => {
      const { service, taskService, prisma } = createService();
      const id = '10000000-0000-4000-8000-000000000003';
      const content = {
        role,
        ...(role === 'DIAGRAM_REFERENCE'
          ? {
              canonicalReference: {
                entityType: 'TASK',
                entityId: '10000000-0000-4000-8000-000000000004',
              },
            }
          : {}),
      };
      const request = workItemChangeSetValidationRequestSchema.parse({
        root: { refType: 'existing', id },
        operations: [
          {
            op: 'section.replace',
            ref: { refType: 'existing', id },
            key: 'diagramElementMetadata',
            content,
          },
        ],
      });
      const recovered = workItemChangeSetValidationRequestSchema.parse(
        JSON.parse(JSON.stringify(request)),
      );
      const operation = recovered.operations[0];
      const params = {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      };
      const mappings = {
        workItems: { [`existing:${id}`]: id },
        relationships: {},
      };
      await (service as any).applyOperation(
        params,
        'materialization-1',
        operation,
        mappings,
        0,
        'claim-1',
      );
      expect(taskService.updateInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        params.organizationId,
        null,
        id,
        {
          sections: [
            { key: 'diagramElementMetadata', content: JSON.stringify(content) },
          ],
        },
        undefined,
        'materialization-1',
      );
      prisma.db.taskSection.findFirst.mockResolvedValue({
        materializedMarkdown: JSON.stringify(content),
      } as never);
      await expect(
        (service as any).verifyOperationPostcondition(
          params,
          operation,
          mappings,
        ),
      ).resolves.toBe(true);
    },
  );

  it.each(['workItem.create', 'workItem.update'] as const)(
    '%s retains Service IDs through parsing and a JSON round trip, assigning duplicates once',
    async (op) => {
      const { service, taskService } = createService();
      const serviceIds = [
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000001',
      ];
      const request = workItemChangeSetValidationRequestSchema.parse({
        root: { refType: 'temporary', tempId: 'root' },
        operations: [
          {
            op,
            ref: { refType: 'temporary', tempId: 'root' },
            name: 'Reviewed step',
            ...(op === 'workItem.create' ? { type: 'STANDARD' } : {}),
            serviceIds,
          },
        ],
      });
      const stored = JSON.parse(JSON.stringify(request));
      expect(stored.operations[0].serviceIds).toEqual(serviceIds);
      expect(service.validationRevision(stored)).toBe(
        service.validationRevision(request),
      );
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      try {
        await (service as any).applyOperation(
          {
            proposalId: 'proposal-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
          },
          'materialization-1',
          stored.operations[0],
          { workItems: { 'temporary:root': 'task-1' }, relationships: {} },
          0,
          'claim-1',
        );
        expect(
          taskService.replaceServiceAssignmentsInTransaction,
        ).toHaveBeenCalledWith(
          expect.anything(),
          'task-1',
          serviceIds.slice(0, 2),
        );
        expect(warn).toHaveBeenCalledWith(
          'Ignoring duplicate Service IDs during work-item assignment',
          expect.objectContaining({
            proposalId: 'proposal-1',
            duplicateCount: 1,
          }),
        );
        expect(
          (service as any).serviceAssignmentsMatch(
            serviceIds.slice(0, 2).map((serviceId) => ({ serviceId })),
            stored.operations[0].serviceIds,
          ),
        ).toBe(true);
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('logs structured checkpoint failure diagnostics and rethrows the original exception', async () => {
    const { service } = createService();
    jest
      .spyOn(service as any, 'verifyOperationPostcondition')
      .mockResolvedValue(false);
    const originalError = new TypeError('serviceIds is not iterable');
    jest
      .spyOn(service as any, 'applyOperation')
      .mockRejectedValue(originalError);
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      await expect(
        (service as any).applyCheckpoint(
          {
            proposalId: 'proposal-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
          },
          { id: 'materialization-1' },
          { id: 'checkpoint-1', operationIndex: 0 },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'root' },
            name: 'Reviewed step',
            serviceIds: {},
          },
          { workItems: { 'temporary:root': 'task-1' }, relationships: {} },
          'claim-1',
        ),
      ).rejects.toBe(originalError);
      const records = logged.mock.calls.map(([message, attributes]) =>
        buildProductionLogEnvelope({
          level: 'error',
          message,
          attributes,
        }),
      );
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operationIndex: 0,
            operationKind: 'workItem.create',
            proposalId: 'proposal-1',
            materializationId: 'materialization-1',
            fieldPath: 'operations[0]',
            failureCode: 'CHECKPOINT_APPLICATION_FAILED',
            reason: 'serviceIds is not iterable',
            diagnosticCorrelationId: expect.any(String),
          }),
        ]),
      );
    } finally {
      logged.mockRestore();
    }
  });

  it('logs every Service ID and position across persistence without losing long arrays', () => {
    const { service } = createService();
    const serviceIds = Array.from(
      { length: 20 },
      (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const operation = {
      op: 'workItem.create',
      ref: { refType: 'temporary', tempId: 'root' },
      name: 'Reviewed step',
      serviceIds,
    };
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    try {
      for (const boundary of ['before_persistence', 'after_reload']) {
        (service as any).logOperationInput(
          'proposal-1',
          'materialization-1',
          0,
          operation,
          boundary,
        );
        const records = debug.mock.calls.map(([message, attributes]) =>
          buildProductionLogEnvelope({ level: 'debug', message, attributes }),
        );
        expect(
          records
            .filter(
              (record) =>
                record.boundary === boundary && record.serviceId !== undefined,
            )
            .map((record) => record.serviceId),
        ).toEqual(serviceIds);
      }
    } finally {
      debug.mockRestore();
    }
  });

  it('returns only after the prepared intent is completely published', async () => {
    const { service, prisma } = createService();
    const prepared = {
      id: 'materialization-1',
      rootWorkItemId: 'task-1',
      status: WorkItemChangeSetMaterializationStatus.PREPARED,
      targetProjection: { projection: { valid: true } },
    };
    const completed = {
      ...prepared,
      status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
      validationRevision: 'revision-1',
      checkpoints: [
        {
          status: WorkItemChangeSetCheckpointStatus.COMPLETED,
          validationRevision: 'revision-1',
        },
      ],
      proposal: {
        id: 'proposal-1',
        status: 'APPROVED',
        targetEntityId: 'task-1',
      },
    };
    jest.spyOn(service as any, 'prepareIntent').mockResolvedValue(prepared);
    const claimed = { ...prepared, claimToken: 'claim-1' };
    const claim = jest
      .spyOn(service as any, 'claimPreparedIntent')
      .mockResolvedValue(claimed);
    jest.spyOn(service as any, 'assertRecoverableIntent').mockImplementation();
    jest
      .spyOn(service as any, 'applyPreparedIntent')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'publishPreparedIntent')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'releaseFences').mockResolvedValue(undefined);
    prisma.db.workItemChangeSetMaterialization.findUniqueOrThrow = jest
      .fn()
      .mockResolvedValue(completed);

    await expect(
      service.materializeApprovedChangeSet({
        proposalId: 'proposal-1',
        organizationId: 'organization-1' as any,
        projectId: 'project-1' as any,
      }),
    ).resolves.toEqual({
      proposal: {
        ...completed.proposal,
        workItemChangeSetMaterialization: {
          id: completed.id,
          rootWorkItemId: completed.rootWorkItemId,
          status: completed.status,
          targetProjection: completed.targetProjection,
          validationRevision: completed.validationRevision,
          checkpoints: completed.checkpoints,
        },
      },
      rootWorkItemId: 'task-1',
      status: WorkItemChangeSetMaterializationStatus.PUBLISHED,
      enacted: true,
    });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'proposal-1' }),
      'materialization-1',
    );
    expect(claim.mock.invocationCallOrder[0]!).toBeLessThan(
      prisma.db.workItemChangeSetMaterialization.findUniqueOrThrow.mock
        .invocationCallOrder[0]!,
    );
  });

  it('records a selected failure and rethrows its concrete error', async () => {
    const { service } = createService();
    const prepared = {
      id: 'materialization-1',
      rootWorkItemId: 'task-1',
      status: WorkItemChangeSetMaterializationStatus.PREPARED,
      targetProjection: { projection: { valid: true } },
    };
    const claimed = { ...prepared, claimToken: 'claim-1' };
    jest.spyOn(service as any, 'prepareIntent').mockResolvedValue(prepared);
    jest
      .spyOn(service as any, 'claimPreparedIntent')
      .mockResolvedValue(claimed);
    jest.spyOn(service as any, 'assertRecoverableIntent').mockImplementation();
    jest
      .spyOn(service as any, 'applyPreparedIntent')
      .mockRejectedValue(new Error('Graph write timed out after commit'));
    const recordFailure = jest
      .spyOn(service as any, 'markIntentRecoverableFailure')
      .mockResolvedValue(undefined);

    await expect(
      service.materializeApprovedChangeSet({
        proposalId: 'proposal-1',
        organizationId: 'organization-1' as any,
        projectId: 'project-1' as any,
      }),
    ).rejects.toThrow('Graph write timed out after commit');
    expect(recordFailure).toHaveBeenCalledWith(
      'materialization-1',
      'claim-1',
      expect.objectContaining({
        message: 'Graph write timed out after commit',
      }),
      expect.objectContaining({
        message: 'Graph write timed out after commit',
        diagnostic: expect.objectContaining({
          correlationId: expect.any(String),
        }),
      }),
    );
  });

  it('does not make a published intent retryable when fence release fails', async () => {
    const { service, prisma } = createService();
    prisma.db.workItemChangeSetMaterialization.updateMany = jest
      .fn()
      .mockResolvedValue({ count: 0 });

    await (service as any).markIntentRecoverableFailure(
      'materialization-1',
      'claim-1',
      new Error('Fence release failed after publication'),
    );

    expect(
      prisma.db.workItemChangeSetMaterialization.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        id: 'materialization-1',
        claimToken: 'claim-1',
        status: WorkItemChangeSetMaterializationStatus.APPLYING,
      },
      data: expect.objectContaining({
        status: WorkItemChangeSetMaterializationStatus.PREPARED,
        lastError: expect.stringContaining(
          'Fence release failed after publication',
        ),
        claimToken: null,
        claimExpiresAt: null,
      }),
    });
  });

  it('translates ordinary task CREATE, UPDATE, and DELETE proposals into durable operations', () => {
    const { service } = createService();
    const parentId = '123e4567-e89b-42d3-a456-426614174200';
    const targetId = '123e4567-e89b-42d3-a456-426614174201';

    const create = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174202',
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: '00000000-0000-0000-0000-000000000000',
      updates: {
        name: 'Created task',
        parentTaskId: parentId,
        initiativeId: '123e4567-e89b-42d3-a456-426614174203',
        sections: [{ key: 'description', content: 'Body' }],
      },
    } as any);
    expect(create).toEqual({
      root: { refType: 'temporary', tempId: 'root' },
      operations: [
        {
          op: 'workItem.create',
          ref: { refType: 'temporary', tempId: 'root' },
          name: 'Created task',
          parent: { refType: 'existing', id: parentId },
        },
        {
          op: 'section.replace',
          ref: { refType: 'temporary', tempId: 'root' },
          key: 'description',
          content: 'Body',
        },
      ],
    });

    const update = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174204',
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: targetId,
      updates: { parentTaskId: null, dueDate: null },
    } as any);
    expect(update).toEqual({
      root: { refType: 'existing', id: targetId },
      operations: [
        {
          op: 'workItem.update',
          ref: { refType: 'existing', id: targetId },
          parent: null,
          dueDate: null,
        },
      ],
    });

    const deletion = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174205',
      action: 'DELETE',
      targetEntityType: 'TASK',
      targetEntityId: targetId,
      updates: {},
    } as any);
    expect(deletion).toEqual({
      root: { refType: 'existing', id: targetId },
      operations: [
        {
          op: 'workItem.delete',
          ref: { refType: 'existing', id: targetId },
        },
      ],
    });
  });

  it('preserves an admitted legacy LOOP predicate during canonical change-set normalization', () => {
    const { service } = createService();

    const changeSet = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174221',
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: '00000000-0000-0000-0000-000000000000',
      updates: {
        name: 'Retry workflow',
        type: 'workflow',
        workflowSteps: [{ tempId: 'retry', name: 'Retry' }],
        workflowLinks: [
          {
            sourceStepTempId: 'retry',
            type: 'LOOP',
            predicate: 'retryCount < 3',
          },
        ],
      },
    } as any);

    expect(changeSet?.operations).toContainEqual({
      op: 'relationship.create',
      ref: { refType: 'temporary', tempId: 'workflowLink:0' },
      source: { refType: 'temporary', tempId: 'workflowStep:retry' },
      target: { refType: 'temporary', tempId: 'workflowStep:retry' },
      edgeType: 'LOOP',
      category: 'flow',
      predicate: 'retryCount < 3',
      reasoning: null,
    });
  });

  it('keeps launch config in the task payload while leaving topology operations generic', () => {
    const { service } = createService();
    const config = {
      kind: 'INITIAL_WORKTREE',
      version: 'v1',
      initialWorktreeBranch: 'feature/launch-default',
    };

    const merged = (service as any).mergeCreateTaskProposalPayload(
      { name: 'Configured task', type: 'STANDARD' },
      { action: 'CREATE', updates: { config } },
    );

    expect(merged.config).toEqual(config);
    expect(
      service.taskProposalChangeSet({
        id: '123e4567-e89b-42d3-a456-426614174218',
        action: 'CREATE',
        targetEntityType: 'TASK',
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        updates: { name: 'Configured task', type: 'STANDARD', config },
      } as any),
    ).toEqual({
      root: { refType: 'temporary', tempId: 'root' },
      operations: [
        {
          op: 'workItem.create',
          ref: { refType: 'temporary', tempId: 'root' },
          name: 'Configured task',
          type: 'STANDARD',
        },
      ],
    });
  });

  it('leaves structured FEATURE requirement payloads on the ordinary task enactor path', () => {
    const { service } = createService();
    const taskId = '123e4567-e89b-42d3-a456-426614174206';

    expect(
      service.taskProposalChangeSet({
        id: '123e4567-e89b-42d3-a456-426614174207',
        action: 'CREATE',
        targetEntityType: 'TASK',
        targetEntityId: '00000000-0000-0000-0000-000000000000',
        updates: {
          name: 'Grouped feature',
          type: 'FEATURE',
          tag: 'product',
          initialRequirements: [
            { requirement: 'The system does X', group: 'Access control' },
          ],
        },
      } as any),
    ).toBeNull();

    expect(
      service.taskProposalChangeSet({
        id: '123e4567-e89b-42d3-a456-426614174208',
        action: 'UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: taskId,
        updates: {
          requirementOps: [{ op: 'update', targetId: 'abcd1234', group: null }],
        },
      } as any),
    ).toBeNull();
  });

  it('includes declared task edges in edge-only and mixed durable task change sets', () => {
    const { service } = createService();
    const sourceId = '123e4567-e89b-42d3-a456-426614174210';
    const targetId = '123e4567-e89b-42d3-a456-426614174211';

    const edgeOnlyUpdate = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174212',
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: sourceId,
      updates: {},
      edges: [
        {
          endpointMode: 'PROPOSAL',
          targetEntityType: 'PROPOSAL',
          targetEntityId: '123e4567-e89b-42d3-a456-426614174214',
          edgeType: 'EVOLVES',
        },
        {
          targetEntityId: targetId,
          targetEntityType: 'TASK',
          edgeType: 'DEPENDS_ON',
          description: 'The source requires the target.',
        },
      ],
    } as any);
    expect(edgeOnlyUpdate).toEqual({
      root: { refType: 'existing', id: sourceId },
      operations: [
        {
          op: 'workItem.update',
          ref: { refType: 'existing', id: sourceId },
        },
        {
          op: 'relationship.create',
          ref: { refType: 'temporary', tempId: 'proposal-edge-0' },
          source: { refType: 'existing', id: sourceId },
          target: { refType: 'existing', id: targetId },
          edgeType: 'DEPENDS_ON',
          category: 'meta',
          reasoning: 'The source requires the target.',
        },
      ],
    });

    const mixedCreate = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174213',
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: '00000000-0000-0000-0000-000000000000',
      updates: { name: 'Created with its relationship' },
      edges: [
        {
          targetEntityId: targetId,
          targetEntityType: 'TASK',
          edgeType: 'RELATED_TO',
        },
      ],
    } as any);
    expect(mixedCreate?.operations).toEqual([
      expect.objectContaining({
        op: 'workItem.create',
        ref: { refType: 'temporary', tempId: 'root' },
      }),
      {
        op: 'relationship.create',
        ref: { refType: 'temporary', tempId: 'proposal-edge-0' },
        source: { refType: 'temporary', tempId: 'root' },
        target: { refType: 'existing', id: targetId },
        edgeType: 'RELATED_TO',
        category: 'meta',
        reasoning: 'Declared via proposal edge (RELATED_TO)',
      },
    ]);
  });

  it('keeps declarations with special proposal-edge semantics on the legacy enactment path', () => {
    const { service } = createService();
    const targetId = '123e4567-e89b-42d3-a456-426614174214';

    expect(
      service.taskProposalChangeSet({
        id: '123e4567-e89b-42d3-a456-426614174215',
        action: 'UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: targetId,
        updates: {},
        edges: [
          {
            targetEntityId: '123e4567-e89b-42d3-a456-426614174216',
            targetEntityType: 'PROPOSAL',
            edgeType: 'RELATED_TO',
          },
        ],
      } as any),
    ).toBeNull();

    expect(
      service.taskProposalChangeSet({
        id: '123e4567-e89b-42d3-a456-426614174217',
        action: 'UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: targetId,
        updates: {},
        edges: [
          {
            targetEntityId: '123e4567-e89b-42d3-a456-426614174218',
            targetEntityType: 'TASK',
            edgeType: 'SUPERSEDES',
          },
        ],
      } as any),
    ).toBeNull();
  });

  it.each(['SUPERSEDES', 'TRACKS', 'BLOCKS'])(
    'retains permission write facts when %s requires ordinary edge enactment',
    async (edgeType) => {
      const { service } = createService();
      const proposal = {
        id: '123e4567-e89b-42d3-a456-426614174215',
        action: 'UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: '123e4567-e89b-42d3-a456-426614174214',
        updates: {
          status: 'ACTIVE',
          sections: [{ key: 'requirements', content: { records: [] } }],
        },
        edges: [
          {
            targetEntityId: '123e4567-e89b-42d3-a456-426614174218',
            targetEntityType: 'TASK',
            edgeType,
          },
        ],
      };
      expect(service.taskProposalChangeSet(proposal as never)).toBeNull();
      expect(await deriveChangedFields({} as never, proposal)).toEqual([
        'status',
        'sections.requirements',
      ]);
    },
  );

  it('requires approved relationship reasoning in operation postconditions', () => {
    const { service } = createService();
    const mappings = {
      workItems: {
        'existing:source-1': 'source-1',
        'existing:target-1': 'target-1',
      },
      relationships: { 'temporary:edge-1': 'edge-1' },
    };
    const edge = {
      sourceNodeId: 'source-1',
      sourceEntityType: 'TASK',
      targetNodeId: 'target-1',
      targetEntityType: 'TASK',
      type: 'RELATED_TO',
      category: 'meta',
      reasoning: 'Different reasoning',
      metadata: null,
    };
    const operation = {
      op: 'relationship.create',
      ref: { refType: 'temporary', tempId: 'edge-1' },
      source: { refType: 'existing', id: 'source-1' },
      target: { refType: 'existing', id: 'target-1' },
      edgeType: 'RELATED_TO',
      category: 'meta',
      reasoning: 'Approved reasoning',
    };

    expect(
      (service as any).relationshipMatchesCreate(edge, operation, mappings),
    ).toBe(false);
  });

  it('creates approved DEPENDS_ON relationships directly in Graph', async () => {
    const { service, taskService } = createService();
    const agentEdgeClient = (service as any).agentEdgeClient;
    agentEdgeClient.create.mockResolvedValue({
      id: 'edge-1',
      sourceNodeId: 'task-later',
      sourceEntityType: 'TASK',
      targetNodeId: 'task-earlier',
      targetEntityType: 'TASK',
      type: 'DEPENDS_ON',
      reasoning: 'Approved schedule',
    });

    await (service as any).applyOperation(
      {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      'materialization-1',
      {
        op: 'relationship.create',
        ref: { refType: 'temporary', tempId: 'edge-1' },
        source: { refType: 'existing', id: 'task-later' },
        target: { refType: 'existing', id: 'task-earlier' },
        edgeType: 'DEPENDS_ON',
      },
      {
        workItems: {
          'existing:task-later': 'task-later',
          'existing:task-earlier': 'task-earlier',
        },
        relationships: { 'temporary:edge-1': 'edge-1' },
      },
      0,
      'claim-1',
    );

    expect(agentEdgeClient.create).toHaveBeenCalledWith(
      'organization-1',
      'project-1',
      expect.objectContaining({
        id: 'edge-1',
        sourceNodeId: 'task-later',
        targetNodeId: 'task-earlier',
        type: 'DEPENDS_ON',
      }),
      undefined,
      'materialization-1',
    );
  });

  it('runs task update post-commit effects after applying a durable update', async () => {
    const { service, taskService } = createService();
    const postCommit = {
      statusChange: { previousStatus: 'BACKLOG', newStatus: 'ACTIVE' },
      updateOriginalArtifact: false,
    };
    taskService.updateInTransaction.mockResolvedValue({ postCommit });

    await (service as any).applyOperation(
      {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      'materialization-1',
      {
        op: 'workItem.update',
        ref: { refType: 'existing', id: 'task-1' },
      },
      { workItems: { 'existing:task-1': 'task-1' }, relationships: {} },
      0,
      'claim-1',
    );

    expect(taskService.runUpdatePostCommit).toHaveBeenCalledWith(
      'organization-1',
      'task-1',
      postCommit,
    );
  });

  it('passes launch config from a graph change-set proposal to the shared task service', async () => {
    const { service, taskService, prisma } = createService();
    const config = {
      kind: 'INITIAL_WORKTREE',
      version: 'v1',
      initialWorktreeBranch: 'feature/launch-default',
    };
    prisma.db.proposal.findUnique.mockResolvedValue({
      action: 'CREATE',
      targetEntityType: 'TASK',
      updates: { name: 'Configured task', type: 'STANDARD', config },
    });
    taskService.createInTransaction.mockResolvedValue({ id: 'task-1' });

    await (service as any).applyOperation(
      {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      'materialization-1',
      {
        op: 'workItem.create',
        ref: { refType: 'temporary', tempId: 'root' },
        name: 'Configured task',
        type: 'STANDARD',
      },
      { workItems: { 'temporary:root': 'task-1' }, relationships: {} },
      0,
      'claim-1',
    );

    expect(taskService.createInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'organization-1',
      null,
      expect.objectContaining({ config }),
      'project-1',
      'task-1',
      'materialization-1',
    );
  });

  it('adapts task CREATE defaults to the registry-backed task projection', () => {
    const { service } = createService({
      getSectionDefinitions: jest.fn().mockReturnValue([
        { key: 'description', kind: 'markdown', schemaRef: undefined },
        { key: 'layout', kind: 'json', schemaRef: 'layout-schema' },
        { key: 'preview', kind: 'html/css', schemaRef: undefined },
      ]),
    });

    const create = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174206',
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: '00000000-0000-0000-0000-000000000000',
      projectId: '123e4567-e89b-42d3-a456-426614174207',
      updates: { name: 'Created task' },
    } as any);

    expect(create?.operations).toEqual([
      expect.objectContaining({ op: 'workItem.create' }),
      {
        op: 'section.replace',
        ref: { refType: 'temporary', tempId: 'root' },
        key: 'description',
        content: '',
      },
    ]);
  });

  it('carries schema-canonicalized MODE files into the durable create operations', () => {
    const { service } = createService({
      getSectionDefinitions: jest.fn().mockReturnValue([
        { key: 'description', kind: 'markdown', schemaRef: undefined },
        {
          key: 'files',
          kind: 'json',
          schemaRef: '#/components/schemas/ProjectModeFiles',
        },
      ]),
    });

    const files = {
      schemaVersion: 'project-mode-files.v1',
      files: {
        'references/checklist.md': 'Check the list.',
        'MODE.md': 'Read this first.',
      },
    };

    const create = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174221',
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: '00000000-0000-0000-0000-000000000000',
      projectId: '123e4567-e89b-42d3-a456-426614174222',
      updates: {
        name: 'Review mode',
        type: 'MODE',
        sections: [
          { key: 'description', content: 'Choose this mode.' },
          { key: 'files', content: files },
        ],
      },
    } as any);

    expect(create?.operations).toEqual([
      expect.objectContaining({ op: 'workItem.create', type: 'MODE' }),
      {
        op: 'section.replace',
        ref: { refType: 'temporary', tempId: 'root' },
        key: 'description',
        content: 'Choose this mode.',
      },
      {
        op: 'section.replace',
        ref: { refType: 'temporary', tempId: 'root' },
        key: 'files',
        content: JSON.stringify({
          schemaVersion: 'project-mode-files.v1',
          files: {
            'MODE.md': 'Read this first.',
            'references/checklist.md': 'Check the list.',
          },
        }),
      },
    ]);
  });

  it('keeps a layout-preference edit on the generic section path', () => {
    const { service } = createService();
    const targetId = '123e4567-e89b-42d3-a456-426614174219';
    const preference = {
      schemaVersion: 'work-item-graph-layout-preference.v1',
      rows: 2,
      columns: 3,
    };

    const changeSet = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174220',
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: targetId,
      updates: {
        sections: [{ key: 'graphLayoutPreference', content: preference }],
      },
    } as any);

    expect(changeSet?.operations).toEqual([
      {
        op: 'section.replace',
        ref: { refType: 'existing', id: targetId },
        key: 'graphLayoutPreference',
        content: preference,
      },
    ]);
    expect(changeSet?.operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'layout.replace' }),
      ]),
    );
  });

  it('materializes a first layout preference without issuing a layout operation', async () => {
    const { service, taskService } = createService();
    const preference = {
      schemaVersion: 'work-item-graph-layout-preference.v1',
      rows: 2,
      columns: 3,
    };

    await (service as any).applyOperation(
      {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      'materialization-1',
      {
        op: 'section.replace',
        ref: { refType: 'existing', id: 'workflow-1' },
        key: 'graphLayoutPreference',
        content: preference,
      },
      {
        workItems: { 'existing:workflow-1': 'workflow-1' },
        relationships: {},
      },
      0,
      'claim-1',
    );

    expect(taskService.updateInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'organization-1',
      null,
      'workflow-1',
      {
        sections: [
          {
            key: 'graphLayoutPreference',
            content: JSON.stringify(preference),
          },
        ],
      },
      undefined,
      'materialization-1',
    );
    expect(taskService.applySectionUpdatesInTransaction).not.toHaveBeenCalled();
  });

  it('preserves an HTML/CSS payload when adapting a task proposal change set', () => {
    const { service } = createService({
      getSectionDefinitions: jest
        .fn()
        .mockReturnValue([
          { key: 'preview', kind: 'html/css', schemaRef: undefined },
        ]),
    });
    const content = {
      css: '',
      html: '<main data-hh-id="hero">Preview</main>',
      sizeKey: 'desktop',
      annotations: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          note: 'Keep this visible.',
          author: {
            type: 'human',
            userId: '10000000-0000-4000-8000-000000000002',
          },
          category: 'context',
          lifecycle: 'open',
          authoredProposalId: '20000000-0000-4000-8000-000000000001',
          authoredSizeKey: 'desktop',
          target: { type: 'element', nodeId: 'hero' },
        },
      ],
    };

    const create = service.taskProposalChangeSet({
      id: '123e4567-e89b-42d3-a456-426614174206',
      action: 'CREATE',
      targetEntityType: 'TASK',
      targetEntityId: '00000000-0000-0000-0000-000000000000',
      projectId: '123e4567-e89b-42d3-a456-426614174207',
      updates: {
        name: 'Created task',
        type: 'HTML_CSS_TYPE',
        sections: [{ key: 'preview', content }],
      },
    } as any);

    expect(create?.operations).toEqual([
      expect.objectContaining({ op: 'workItem.create' }),
      {
        op: 'section.replace',
        ref: { refType: 'temporary', tempId: 'root' },
        key: 'preview',
        content,
      },
    ]);
  });

  it('materializes an HTML/CSS annotation sidecar through the generic section path', async () => {
    const { service, taskService } = createService();
    const content = {
      html: '<main data-hh-id="hero">Preview</main>',
      css: '',
      sizeKey: 'desktop',
      annotations: [
        {
          id: '10000000-0000-4000-8000-000000000001',
          note: 'Keep this visible.',
          author: {
            type: 'human',
            userId: '10000000-0000-4000-8000-000000000002',
          },
          category: 'context',
          lifecycle: 'resolved',
          authoredProposalId: '20000000-0000-4000-8000-000000000001',
          authoredSizeKey: 'desktop',
          target: { type: 'position', x: 0.3, y: 0.4, sizeKey: 'desktop' },
        },
      ],
    };

    await (service as any).applyOperation(
      {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      'materialization-1',
      {
        op: 'section.replace',
        ref: { refType: 'existing', id: 'mockup-1' },
        key: 'preview',
        content,
      },
      {
        workItems: { 'existing:mockup-1': 'mockup-1' },
        relationships: {},
      },
      0,
      'claim-1',
    );

    expect(taskService.updateInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'organization-1',
      null,
      'mockup-1',
      { sections: [{ key: 'preview', content: JSON.stringify(content) }] },
      undefined,
      'materialization-1',
    );
  });

  it('materializes the complete structured mockup document through the generic section path', async () => {
    const { service, taskService } = createService();
    const document = {
      schemaVersion: 'work-item-structured-mockup.v3',
      revision: 1,
      sizeKey: 'panel',
      annotations: [],
      content: [
        {
          type: 'row',
          props: {
            id: 'actions',
            width: { mode: 'fill' },
            height: { mode: 'content' },
            gap: 8,
            padding: 0,
            justify: 'spread',
            align: 'stretch',
          },
          children: [],
        },
      ],
    };

    await (service as any).applyOperation(
      {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      'materialization-1',
      {
        op: 'section.replace',
        ref: { refType: 'existing', id: 'mockup-1' },
        key: 'mockup',
        content: document,
      },
      {
        workItems: { 'existing:mockup-1': 'mockup-1' },
        relationships: {},
      },
      0,
      'claim-1',
    );

    expect(taskService.updateInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'organization-1',
      null,
      'mockup-1',
      { sections: [{ key: 'mockup', content: JSON.stringify(document) }] },
      undefined,
      'materialization-1',
    );
  });

  it('rejects progress from a worker that has lost its claim', async () => {
    const service = new WorkItemChangeSetMaterializerService(
      {
        db: {
          workItemChangeSetMaterialization: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      jest.fn(),
      reconciliationStub(),
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      (service as any).markIntentAttempt('materialization-1', 'stale-claim'),
    ).rejects.toThrow('claim is no longer owned');
  });

  it('serializes boundary claims with a transaction-scoped advisory lock', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ lockAcquired: '' }]);
    const tx = {
      proposalReconciliationReplacement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: queryRaw,
      workItemChangeSetMaterialization: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new WorkItemChangeSetMaterializerService(
      {
        db: {
          $transaction: jest.fn(
            async (callback: (transaction: typeof tx) => unknown) =>
              callback(tx),
          ),
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      jest.fn(),
      reconciliationStub(),
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      (service as any).claimPreparedIntent(
        {
          proposalId: 'proposal-1',
          organizationId: 'organization-1',
          projectId: 'project-1',
        },
        'materialization-1',
      ),
    ).resolves.toBeNull();

    const query = queryRaw.mock.calls[0][0];
    expect(query.strings.join('?')).toBe(
      'SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text AS "lockAcquired"',
    );
    expect(query.values).toEqual(['organization-1:project-1']);
  });

  it('publishes the complete target without emitting a second approval event', async () => {
    const targetProjection = projectionFor('task-1');
    const intent = {
      id: 'materialization-1',
      rootWorkItemId: 'task-1',
      status: WorkItemChangeSetMaterializationStatus.APPLYING,
      claimToken: 'claim-1',
      validationRevision: 'revision-1',
      operationSet: {
        root: { refType: 'existing', id: 'task-1' },
        operations: [],
      },
      workItemIdMappings: { 'existing:task-1': 'task-1' },
      relationshipIdMappings: {},
      priorProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: {},
      },
      targetProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: targetProjection,
      },
      affectedWorkItemIds: ['task-1'],
      affectedRelationshipIds: [],
      proposal: { status: 'APPROVED' },
      checkpoints: [
        {
          status: WorkItemChangeSetCheckpointStatus.COMPLETED,
          validationRevision: 'revision-1',
        },
      ],
    };
    const tx = {
      proposalReconciliationReplacement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      workItemChangeSetMaterialization: {
        findFirst: jest.fn().mockResolvedValue({ id: 'materialization-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
        update: jest.fn().mockResolvedValue({}),
      },
      proposal: {
        update: jest.fn().mockResolvedValue({
          id: 'proposal-1',
          organizationId: 'organization-1',
          projectId: 'project-1',
          targetEntityId: 'task-1',
          targetEntityType: 'TASK',
          action: 'UPDATE',
          requestorId: 'user-1',
          requestorContext: null,
          influences: null,
          generatedWithVersion: null,
          conversationId: null,
          messageId: null,
          createdAt: new Date('2026-07-13T00:00:00.000Z'),
        }),
      },
      task: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      db: {
        workItemChangeSetMaterialization: {
          findUnique: jest.fn().mockResolvedValue(intent),
        },
        $transaction: jest.fn(
          async (callback: (transaction: typeof tx) => unknown) => callback(tx),
        ),
      },
    };
    const eventPublisher = {
      publishInTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const projector = {
      rehydrateCurrentProjection: jest.fn().mockResolvedValue(targetProjection),
    };
    const service = new WorkItemChangeSetMaterializerService(
      prisma as any,
      projector as any,
      {} as any,
      {} as any,
      eventPublisher as any,
      jest.fn(),
      reconciliationStub(),
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'assertRecoverableIntent').mockImplementation();

    await (service as any).publishPreparedIntent(
      {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      'materialization-1',
      'claim-1',
    );

    expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    expect(projector.rehydrateCurrentProjection).not.toHaveBeenCalled();
    expect(tx.workItemChangeSetMaterialization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'materialization-1', claimToken: 'claim-1' },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['task-1'] },
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      data: { lastAppliedProposalId: 'proposal-1' },
    });
  });

  describe('change-set body mentions', () => {
    const descriptionDefinition = { key: 'description', label: 'Description' };

    function mentionHarness(params: {
      operationSet: unknown;
      workItemIdMappings: Record<string, string>;
      relationshipIdMappings?: Record<string, string>;
      priorWorkItems?: Record<string, unknown>;
      currentSections: Record<string, string>;
    }) {
      const intent = {
        id: 'materialization-1',
        rootWorkItemId: 'task-1',
        status: WorkItemChangeSetMaterializationStatus.APPLYING,
        claimToken: 'claim-1',
        validationRevision: 'revision-1',
        operationSet: params.operationSet,
        workItemIdMappings: params.workItemIdMappings,
        relationshipIdMappings: params.relationshipIdMappings ?? {},
        affectedWorkItemIds: Object.values(params.workItemIdMappings),
        priorProjection: {
          schemaVersion: 'work-item-change-set-projection.v1',
          projection: {},
          ...(params.priorWorkItems
            ? { workItems: params.priorWorkItems }
            : {}),
        },
        targetProjection: {
          schemaVersion: 'work-item-change-set-projection.v1',
          projection: projectionFor('task-1'),
        },
        proposal: { status: 'APPROVED' },
        checkpoints: [],
      };
      const tx = {
        workItemChangeSetMaterialization: {
          findFirst: jest.fn().mockResolvedValue({ id: 'materialization-1' }),
          findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
          update: jest.fn().mockResolvedValue({}),
        },
        proposal: {
          update: jest.fn().mockResolvedValue({
            id: 'proposal-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
            targetEntityId: 'task-1',
            targetEntityType: 'TASK',
            requestorId: 'user-1',
            conversationId: 'conversation-1',
          }),
        },
        task: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn(({ where }: { where: { id: string } }) =>
            Promise.resolve({
              type: 'STANDARD',
              projectId: 'project-1',
              sections: [
                {
                  key: 'description',
                  materializedMarkdown: params.currentSections[where.id] ?? '',
                },
              ],
            }),
          ),
        },
      };
      const prisma = {
        db: {
          workItemChangeSetMaterialization: {
            findUnique: jest.fn().mockResolvedValue(intent),
          },
          $transaction: jest.fn(
            async (callback: (transaction: typeof tx) => unknown) =>
              callback(tx),
          ),
        },
      };
      const eventPublisher = {
        publishInTransaction: jest.fn().mockResolvedValue(undefined),
      };
      const mentionProcessingService = {
        extractAndValidate: jest.fn((content: string) =>
          Promise.resolve(
            [...content.matchAll(/@\[task:([^|\]]+)\|/g)].map((match) => ({
              entityId: match[1],
              entityType: 'TASK',
            })),
          ),
        ),
      };
      const registry = {
        getSectionDefinitions: jest
          .fn()
          .mockReturnValue([descriptionDefinition]),
      };
      const service = new WorkItemChangeSetMaterializerService(
        prisma as any,
        {} as any,
        {} as any,
        { findIncident: jest.fn().mockResolvedValue([]) } as any,
        eventPublisher as any,
        jest.fn(),
        reconciliationStub(),
        registry as any,
        {} as any,
        mentionProcessingService as any,
      );
      jest
        .spyOn(service as any, 'assertRecoverableIntent')
        .mockImplementation();
      jest
        .spyOn(service as any, 'verifyOperationPostcondition')
        .mockResolvedValue(true);
      jest
        .spyOn(service as any, 'createdRelationshipMatches')
        .mockReturnValue(true);
      const publish = () =>
        (service as any).publishPreparedIntent(
          {
            proposalId: 'proposal-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
          },
          'materialization-1',
          'claim-1',
        );
      const publishedEvents = () =>
        eventPublisher.publishInTransaction.mock.calls.map(
          ([, event]: [unknown, any]) => ({
            type: event.type,
            sourceEntityId: event.payload.sourceEntityId,
            entityId: event.payload.entityId,
          }),
        );
      return {
        service,
        publish,
        publishedEvents,
        eventPublisher,
        mentionProcessingService,
      };
    }

    it('publishes mention events when an ordinary TASK UPDATE is approved through the generic change set', async () => {
      const { service: builder } = createService();
      const operationSet = builder.taskProposalChangeSet({
        id: 'proposal-1',
        action: 'UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: 'task-1',
        projectId: 'project-1',
        updates: {
          sections: [
            {
              key: 'description',
              content: 'Now relies on @[task:task-new|New dependency].',
            },
          ],
        },
        edges: null,
      } as any);
      expect(operationSet).not.toBeNull();

      const { publish, publishedEvents, eventPublisher } = mentionHarness({
        operationSet,
        workItemIdMappings: { 'existing:task-1': 'task-1' },
        priorWorkItems: {
          'task-1': {
            id: 'task-1',
            type: 'STANDARD',
            projectId: 'project-1',
            sections: [
              {
                key: 'description',
                materializedMarkdown:
                  'Relied on @[task:task-old|Old dependency].',
              },
            ],
          },
        },
        currentSections: {
          'task-1': 'Now relies on @[task:task-new|New dependency].',
        },
      });

      await publish();

      expect(publishedEvents()).toEqual([
        {
          type: 'mention.created',
          sourceEntityId: 'task-1',
          entityId: 'task-new',
        },
        {
          type: 'mention.removed',
          sourceEntityId: 'task-1',
          entityId: 'task-old',
        },
      ]);
      expect(
        eventPublisher.publishInTransaction.mock.calls[0][1].payload,
      ).toEqual(
        expect.objectContaining({
          organizationId: 'organization-1',
          projectId: 'project-1',
          sourceEntityType: 'TASK',
          conversationId: 'conversation-1',
          userId: 'user-1',
        }),
      );
    });

    it('treats created work items as having no prior mentions and dedups declared relationship targets', async () => {
      const { publish, publishedEvents } = mentionHarness({
        operationSet: {
          root: { refType: 'temporary', tempId: 'root' },
          operations: [
            {
              op: 'workItem.create',
              ref: { refType: 'temporary', tempId: 'root' },
              name: 'Created',
            },
            {
              op: 'section.replace',
              ref: { refType: 'temporary', tempId: 'root' },
              key: 'description',
              content: 'ignored',
            },
            {
              op: 'relationship.create',
              ref: { refType: 'temporary', tempId: 'edge-1' },
              source: { refType: 'temporary', tempId: 'root' },
              target: { refType: 'existing', id: 'task-declared' },
              edgeType: 'DEPENDS_ON',
            },
          ],
        },
        workItemIdMappings: { 'temporary:root': 'task-created' },
        relationshipIdMappings: { 'temporary:edge-1': 'edge-1' },
        currentSections: {
          'task-created':
            'See @[task:task-declared|Declared] and @[task:task-mentioned|Mentioned].',
        },
      });

      await publish();

      expect(publishedEvents()).toEqual([
        {
          type: 'mention.created',
          sourceEntityId: 'task-created',
          entityId: 'task-mentioned',
        },
      ]);
    });

    it('does not diff mentions for work items deleted by the change set', async () => {
      const { publish, eventPublisher, mentionProcessingService } =
        mentionHarness({
          operationSet: {
            root: { refType: 'existing', id: 'task-1' },
            operations: [
              {
                op: 'section.clear',
                ref: { refType: 'existing', id: 'task-1' },
                key: 'description',
              },
              {
                op: 'workItem.delete',
                ref: { refType: 'existing', id: 'task-1' },
              },
            ],
          },
          workItemIdMappings: { 'existing:task-1': 'task-1' },
          currentSections: { 'task-1': '@[task:task-old|Old]' },
        });

      await publish();

      expect(
        mentionProcessingService.extractAndValidate,
      ).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });
  });

  it('does not publish a prepared intent while its proposal is still draft', async () => {
    const targetProjection = projectionFor('task-1');
    const intent = {
      id: 'materialization-1',
      rootWorkItemId: 'task-1',
      status: WorkItemChangeSetMaterializationStatus.APPLYING,
      claimToken: 'claim-1',
      validationRevision: 'revision-1',
      operationSet: {
        root: { refType: 'existing', id: 'task-1' },
        operations: [],
      },
      workItemIdMappings: { 'existing:task-1': 'task-1' },
      relationshipIdMappings: {},
      priorProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: {},
      },
      targetProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: targetProjection,
      },
      affectedWorkItemIds: ['task-1'],
      affectedRelationshipIds: [],
      proposal: { status: 'DRAFT' },
      checkpoints: [
        {
          status: WorkItemChangeSetCheckpointStatus.COMPLETED,
          validationRevision: 'revision-1',
        },
      ],
    };
    const tx = {
      proposalReconciliationReplacement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      workItemChangeSetMaterialization: {
        findFirst: jest.fn().mockResolvedValue({ id: 'materialization-1' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
        update: jest.fn(),
      },
      proposal: { update: jest.fn() },
    };
    const prisma = {
      db: {
        workItemChangeSetMaterialization: {
          findUnique: jest.fn().mockResolvedValue(intent),
        },
        $transaction: jest.fn(
          async (callback: (transaction: typeof tx) => unknown) => callback(tx),
        ),
      },
    };
    const projector = {
      rehydrateCurrentProjection: jest.fn().mockResolvedValue(targetProjection),
    };
    const service = new WorkItemChangeSetMaterializerService(
      prisma as any,
      projector as any,
      {} as any,
      {} as any,
      {} as any,
      jest.fn(),
      reconciliationStub(),
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service as any, 'assertRecoverableIntent').mockImplementation();

    await expect(
      (service as any).publishPreparedIntent(
        {
          proposalId: 'proposal-1',
          organizationId: 'organization-1',
          projectId: 'project-1',
        },
        'materialization-1',
        'claim-1',
      ),
    ).rejects.toThrow('before its proposal is approved');

    expect(tx.workItemChangeSetMaterialization.update).not.toHaveBeenCalled();
    expect(tx.proposal.update).not.toHaveBeenCalled();
  });

  it('leaves an overlapping intent queued while another boundary claim is active', async () => {
    const { service } = createService();
    const selected = {
      id: 'materialization-1',
      affectedWorkItemIds: ['task-1'],
      affectedRelationshipIds: [],
      checkpoints: [],
    };
    const tx = {
      proposalReconciliationReplacement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ lockAcquired: '' }]),
      workItemChangeSetMaterialization: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'active-intent',
            affectedWorkItemIds: ['task-1'],
            affectedRelationshipIds: [],
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(selected),
        update: jest.fn(),
      },
    };
    (service as any).prisma.db.$transaction = jest.fn(
      async (callback: (transaction: typeof tx) => unknown) => callback(tx),
    );

    await expect(
      (service as any).claimPreparedIntent(
        {
          proposalId: 'proposal-1',
          organizationId: 'organization-1',
          projectId: 'project-1',
        },
        'materialization-1',
      ),
    ).resolves.toBeNull();
    expect(tx.workItemChangeSetMaterialization.update).not.toHaveBeenCalled();
  });

  it('claims a disjoint intent while another project materialization is active', async () => {
    const { service } = createService();
    const selected = {
      id: 'materialization-1',
      affectedWorkItemIds: ['task-2'],
      affectedRelationshipIds: ['relationship-2'],
      checkpoints: [],
    };
    const claimed = { ...selected, claimToken: 'claim-1' };
    const tx = {
      proposalReconciliationReplacement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ lockAcquired: '' }]),
      workItemChangeSetMaterialization: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'active-intent',
            affectedWorkItemIds: ['task-1'],
            affectedRelationshipIds: ['relationship-1'],
          },
        ]),
        findFirst: jest.fn().mockResolvedValue(selected),
        update: jest.fn().mockResolvedValue(claimed),
      },
    };
    (service as any).prisma.db.$transaction = jest.fn(
      async (callback: (transaction: typeof tx) => unknown) => callback(tx),
    );

    await expect(
      (service as any).claimPreparedIntent(
        {
          proposalId: 'proposal-1',
          organizationId: 'organization-1',
          projectId: 'project-1',
        },
        'materialization-1',
      ),
    ).resolves.toBe(claimed);
    expect(tx.workItemChangeSetMaterialization.update).toHaveBeenCalled();
  });

  it('returns approved queued state when an overlapping claim cannot be acquired', async () => {
    const { service, prisma } = createService();
    const prepared = {
      id: 'materialization-1',
      rootWorkItemId: 'task-1',
      status: WorkItemChangeSetMaterializationStatus.PREPARED,
      targetProjection: { projection: { valid: true } },
    };
    const proposal = {
      id: 'proposal-1',
      status: 'APPROVED',
      targetEntityId: 'task-1',
    };
    jest.spyOn(service as any, 'prepareIntent').mockResolvedValue(prepared);
    jest.spyOn(service as any, 'claimPreparedIntent').mockResolvedValue(null);
    prisma.db.workItemChangeSetMaterialization.findUniqueOrThrow = jest
      .fn()
      .mockResolvedValue({ ...prepared, proposal });

    await expect(
      service.materializeApprovedChangeSet({
        proposalId: 'proposal-1',
        organizationId: 'organization-1' as any,
        projectId: 'project-1' as any,
      }),
    ).resolves.toEqual({
      proposal: {
        ...proposal,
        workItemChangeSetMaterialization: prepared,
      },
      rootWorkItemId: 'task-1',
      status: WorkItemChangeSetMaterializationStatus.PREPARED,
      enacted: false,
    });
  });

  it('resumes a claimed intent without re-projecting staged writes', async () => {
    const { service } = createService();
    const claimed = {
      id: 'materialization-1',
      proposalId: 'proposal-1',
      claimToken: 'claim-1',
      status: WorkItemChangeSetMaterializationStatus.PREPARED,
      validationRevision: 'revision-1',
      operationSet: {
        root: { refType: 'existing', id: 'root-id' },
        operations: [],
      },
      workItemIdMappings: { 'existing:root-id': 'root-id' },
      relationshipIdMappings: {},
      priorProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: projectionFor('root-id', 'Prior title'),
      },
      targetProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: projectionFor('root-id'),
      },
      affectedWorkItemIds: ['root-id'],
      affectedRelationshipIds: [],
      checkpoints: [],
    };
    jest.spyOn(service as any, 'prepareIntent').mockResolvedValue(claimed);
    jest.spyOn(service as any, 'assertRecoverableIntent').mockImplementation();
    jest
      .spyOn(service as any, 'claimPreparedIntent')
      .mockResolvedValue(claimed);
    jest
      .spyOn(service as any, 'applyPreparedIntent')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'publishPreparedIntent')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'releaseFences').mockResolvedValue(undefined);

    jest.spyOn(service as any, 'requirePublishedResult').mockResolvedValue({
      proposal: { id: 'proposal-1' },
      rootWorkItemId: 'root-id',
    });

    await service.materializeApprovedChangeSet({
      proposalId: 'proposal-1',
      organizationId: 'organization-1' as any,
      projectId: 'project-1' as any,
    });

    expect(
      (service as any).projector.rehydrateCurrentProjection,
    ).not.toHaveBeenCalled();
    expect((service as any).applyPreparedIntent).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'proposal-1' }),
      claimed,
      'claim-1',
    );
  });

  it('reprojects a stored invalid prepared intent and resumes with stable durable state', async () => {
    const { service, prisma, projector } = createService();
    const operationSet = {
      root: { refType: 'existing' as const, id: 'root-id' },
      operations: [],
    };
    const validationRevision = service.validationRevision(operationSet);
    const completedCheckpoint = {
      id: 'checkpoint-1',
      status: WorkItemChangeSetCheckpointStatus.COMPLETED,
      validationRevision,
    };
    const existing = {
      id: 'materialization-1',
      proposalId: 'proposal-1',
      rootWorkItemId: 'root-id',
      status: WorkItemChangeSetMaterializationStatus.PREPARED,
      validationRevision,
      priorProjectionRevision: validationRevision,
      operationSet,
      workItemIdMappings: { 'existing:root-id': 'root-id' },
      relationshipIdMappings: { 'temporary:edge': 'relationship-1' },
      priorProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: projectionFor('root-id', 'Prior title'),
      },
      targetProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: {
          ...projectionFor('root-id'),
          valid: false,
          issues: [{ field: 'references.stale', code: 'dangling_reference' }],
        },
      },
      affectedWorkItemIds: ['root-id'],
      affectedRelationshipIds: ['relationship-1'],
      lastError: 'old diagnostic',
      checkpoints: [completedCheckpoint],
    };
    const refreshedProjection = projectionFor('root-id', 'Refreshed title');
    projector.projectSnapshots.mockResolvedValue({
      unavailableWorkItemIds: new Set(),
      workItemKeys: ['existing:root-id'],
      relationshipKeys: [],
      prior: projectionFor('root-id', 'Current prior'),
      target: refreshedProjection,
    });
    const tx = {
      proposalReconciliationReplacement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      proposal: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'proposal-1',
          updates: operationSet,
        }),
      },
      workItemChangeSetMaterialization: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...existing,
            ...data,
            checkpoints: [completedCheckpoint],
          }),
        ),
      },
    };
    Object.assign(prisma.db, { proposal: tx.proposal });
    Object.assign(
      prisma.db.workItemChangeSetMaterialization,
      tx.workItemChangeSetMaterialization,
    );
    const claim = jest
      .spyOn(service as any, 'claimPreparedIntent')
      .mockImplementation(async (_params, _id) => ({
        ...existing,
        targetProjection: {
          schemaVersion: 'work-item-change-set-projection.v1',
          projection: refreshedProjection,
        },
        lastError: null,
        checkpoints: [completedCheckpoint],
        claimToken: 'claim-1',
      }));
    jest.spyOn(service as any, 'assertRecoverableIntent').mockImplementation();
    const apply = jest
      .spyOn(service as any, 'applyPreparedIntent')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'publishPreparedIntent')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'releaseFences').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'requirePublishedResult').mockResolvedValue({
      proposal: { id: 'proposal-1' },
      rootWorkItemId: 'root-id',
    });

    await service.materializeApprovedChangeSet({
      proposalId: 'proposal-1',
      organizationId: 'organization-1' as any,
      projectId: 'project-1' as any,
    });

    expect(projector.projectSnapshots).toHaveBeenCalledWith({
      organizationId: 'organization-1',
      projectId: 'project-1',
      request: operationSet,
    });
    expect(tx.workItemChangeSetMaterialization.update).toHaveBeenCalledWith({
      where: { id: 'materialization-1' },
      data: {
        targetProjection: {
          schemaVersion: 'work-item-change-set-projection.v1',
          projection: refreshedProjection,
        },
        affectedWorkItemIds: ['root-id'],
        affectedRelationshipIds: [],
        lastError: null,
      },
      include: { checkpoints: true },
    });
    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'proposal-1' }),
      'materialization-1',
    );
    expect(apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        validationRevision,
        operationSet,
        workItemIdMappings: existing.workItemIdMappings,
        relationshipIdMappings: existing.relationshipIdMappings,
        checkpoints: [completedCheckpoint],
      }),
      'claim-1',
    );
  });

  it('refreshes the persisted diagnostic when invalid prepared reprojection still fails', async () => {
    const { service, prisma, projector } = createService();
    const operationSet = {
      root: { refType: 'existing' as const, id: 'root-id' },
      operations: [],
    };
    const validationRevision = service.validationRevision(operationSet);
    const invalidProjection = {
      ...projectionFor('root-id'),
      valid: false,
      issues: [
        {
          field: 'references.current-missing',
          code: 'dangling_reference',
          reason: 'Current missing reference',
          layer: 'referential',
        },
      ],
    };
    const existing = preparedIntent({
      operationSet,
      validationRevision,
      targetProjection: invalidProjection,
    });
    projector.projectSnapshots.mockResolvedValue({
      unavailableWorkItemIds: new Set(),
      workItemKeys: ['existing:root-id'],
      relationshipKeys: [],
      prior: projectionFor('root-id'),
      target: invalidProjection,
    });
    const update = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        ...existing,
        ...data,
        checkpoints: existing.checkpoints,
      }),
    );
    Object.assign(prisma.db, {
      proposal: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'proposal-1',
          updates: operationSet,
        }),
      },
    });
    Object.assign(prisma.db.workItemChangeSetMaterialization, {
      findUnique: jest.fn().mockResolvedValue(existing),
      update,
    });

    await expect(
      service.materializeApprovedChangeSet({
        proposalId: 'proposal-1',
        organizationId: 'organization-1' as any,
        projectId: 'project-1' as any,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'Cannot materialize an invalid work-item change set',
        projection: invalidProjection,
        diagnostic: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: 'dangling_reference',
              field: 'references.current-missing',
            }),
          ]),
        }),
      }),
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastError: expect.stringContaining('Current missing reference'),
        }),
      }),
    );
  });

  it('does not reproject an already-valid prepared intent during retry preparation', async () => {
    const { service, prisma, projector } = createService();
    const operationSet = {
      root: { refType: 'existing' as const, id: 'root-id' },
      operations: [],
    };
    const validationRevision = service.validationRevision(operationSet);
    const existing = preparedIntent({ operationSet, validationRevision });
    const tx = {
      proposalReconciliationReplacement: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      proposal: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'proposal-1',
          updates: operationSet,
        }),
      },
      workItemChangeSetMaterialization: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn(),
      },
    };
    Object.assign(prisma.db, { proposal: tx.proposal });
    Object.assign(
      prisma.db.workItemChangeSetMaterialization,
      tx.workItemChangeSetMaterialization,
    );

    await expect(
      (service as any).prepareIntent({
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      }),
    ).resolves.toBe(existing);
    expect(projector.projectSnapshots).not.toHaveBeenCalled();
    expect(tx.workItemChangeSetMaterialization.update).not.toHaveBeenCalled();
  });

  it('persists a complete versioned layout with temporary refs remapped', async () => {
    const { service, taskService } = createService();

    await (service as any).applySectionLikeOperation(
      { organizationId: 'organization-1', projectId: 'project-1' },
      'materialization-1',
      {
        op: 'layout.replace',
        root: { refType: 'temporary', tempId: 'root' },
        sectionKey: 'graphLayout',
        entries: [
          {
            node: { refType: 'temporary', tempId: 'node-a' },
            position: { x: 12, y: 34 },
          },
        ],
      },
      {
        workItems: {
          'temporary:root': 'root-id',
          'temporary:node-a': 'node-a-id',
        },
        relationships: {},
      },
      0,
      'claim-1',
    );

    expect(taskService.updateInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      'organization-1',
      null,
      'root-id',
      {
        sections: [
          {
            key: 'graphLayout',
            content: JSON.stringify({
              schemaVersion: 'work-item-graph-layout.v1',
              nodes: [
                {
                  node: {
                    kind: 'persistedWorkItem',
                    workItemId: 'node-a-id',
                  },
                  position: { x: 12, y: 34 },
                },
              ],
            }),
          },
        ],
      },
      undefined,
      'materialization-1',
    );
  });

  it.each(['section.clear', 'layout.clear'] as const)(
    'persists %s as an absent section value',
    async (op) => {
      const { service, taskService } = createService();
      const operation =
        op === 'section.clear'
          ? {
              op,
              ref: { refType: 'existing' as const, id: 'root-id' },
              key: 'description',
            }
          : {
              op,
              root: { refType: 'existing' as const, id: 'root-id' },
              sectionKey: 'graphLayout',
            };

      await (service as any).applySectionLikeOperation(
        { organizationId: 'organization-1', projectId: 'project-1' },
        'materialization-1',
        operation,
        {
          workItems: { 'existing:root-id': 'root-id' },
          relationships: {},
        },
        0,
        'claim-1',
      );

      expect(taskService.applySectionUpdatesInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        'organization-1',
        'root-id',
        [
          {
            key: op === 'section.clear' ? 'description' : 'graphLayout',
            content: null,
          },
        ],
        { materializationId: 'materialization-1' },
      );
    },
  );

  it.each(['section.clear', 'layout.clear'] as const)(
    'treats a null persisted value as a satisfied %s postcondition',
    async (op) => {
      const { service, prisma } = createService();
      prisma.db.taskSection = {
        findFirst: jest.fn().mockResolvedValue({
          materializedMarkdown: null,
        }),
      };
      const operation =
        op === 'section.clear'
          ? {
              op,
              ref: { refType: 'existing' as const, id: 'root-id' },
              key: 'description',
            }
          : {
              op,
              root: { refType: 'existing' as const, id: 'root-id' },
              sectionKey: 'graphLayout',
            };

      await expect(
        (service as any).verifyOperationPostcondition(
          {
            proposalId: 'proposal-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
          },
          operation,
          {
            workItems: { 'existing:root-id': 'root-id' },
            relationships: {},
          },
        ),
      ).resolves.toBe(true);
    },
  );

  describe('graph groups', () => {
    const NODE_A = '77777777-7777-4777-8777-777777777777';
    const NODE_B = '88888888-8888-4888-8888-888888888888';
    const operation = {
      op: 'section.replace' as const,
      ref: { refType: 'temporary' as const, tempId: 'root' },
      key: 'diagramGroups',
      content: {
        schemaVersion: 'diagram-groups.v1',
        groups: [
          {
            id: 'region',
            label: 'us-east-1',
            meaning: 'DEPLOYMENT_BOUNDARY',
            color: 'orange',
            members: [
              { kind: 'temporaryWorkItem', temporaryRef: 'node-a' },
              { kind: 'persistedWorkItem', workItemId: NODE_B },
            ],
          },
        ],
      },
    };
    type Internals = {
      applySectionLikeOperation(...args: unknown[]): Promise<void>;
      verifyOperationPostcondition(...args: unknown[]): Promise<boolean>;
    };
    const withTasks = (prisma: { db: object }, ids: string[]) =>
      Object.assign(prisma.db, {
        task: {
          findMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))),
        },
      });
    const mappings = {
      workItems: {
        'temporary:root': 'root-id',
        'temporary:node-a': NODE_A,
      },
      relationships: {},
    };

    it('stores temporary members as persisted identities', async () => {
      const { service, taskService, prisma } = createService();
      withTasks(prisma, []);

      await (service as unknown as Internals).applySectionLikeOperation(
        { organizationId: 'organization-1', projectId: 'project-1' },
        'materialization-1',
        operation,
        mappings,
        0,
        'claim-1',
      );

      const stored = JSON.parse(
        taskService.updateInTransaction.mock.calls[0][4].sections[0].content,
      );
      expect(stored.groups[0].members).toEqual([
        { kind: 'persistedWorkItem', workItemId: NODE_A },
        { kind: 'persistedWorkItem', workItemId: NODE_B },
      ]);
      expect(stored.groups[0].color).toBe('orange');
      expect(JSON.stringify(stored)).not.toContain('temporaryWorkItem');
    });

    it('converges with prune-on-delete when a member is deleted later in the change set', async () => {
      const { service, prisma } = createService();
      withTasks(prisma, [NODE_B]);
      prisma.db.taskSection.findFirst.mockResolvedValue({
        materializedMarkdown: JSON.stringify({
          schemaVersion: 'diagram-groups.v1',
          groups: [
            {
              id: 'region',
              label: 'us-east-1',
              meaning: 'DEPLOYMENT_BOUNDARY',
              color: 'orange',
              members: [{ kind: 'persistedWorkItem', workItemId: NODE_A }],
            },
          ],
        }),
      });

      await expect(
        (service as unknown as Internals).verifyOperationPostcondition(
          {
            proposalId: 'proposal-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
          },
          operation,
          mappings,
        ),
      ).resolves.toBe(true);
    });
  });

  it('preserves explicit nulls when materializing relationship field clears', () => {
    const { service } = createService();

    const dto = (service as any).toUpdateAgentEdgeDto(
      {
        op: 'relationship.update',
        ref: { refType: 'existing', id: 'relationship-1' },
        direction: null,
        predicate: null,
      },
      {
        workItems: {},
        relationships: { 'existing:relationship-1': 'relationship-1' },
      },
      'proposal-1',
    );

    expect(dto).toEqual(
      expect.objectContaining({
        direction: null,
        predicate: null,
        lastModifiedBySessionId: 'proposal-1',
      }),
    );
  });

  it('uses the durable write receipt when checkpoint progress was not recorded', async () => {
    const { service, prisma } = createService();
    jest
      .spyOn(service as any, 'verifyOperationPostcondition')
      .mockResolvedValue(true);
    (
      service as unknown as { reconciliation: { guardTaskEffect: jest.Mock } }
    ).reconciliation.guardTaskEffect.mockResolvedValueOnce(undefined);
    const apply = jest.spyOn(service as any, 'applyOperation');

    await (service as any).applyCheckpoint(
      {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      { id: 'materialization-1' },
      { id: 'checkpoint-1', operationIndex: 0 },
      {
        op: 'workItem.delete',
        ref: { refType: 'existing', id: 'task-1' },
      },
      { workItems: { 'existing:task-1': 'task-1' }, relationships: {} },
      'claim-1',
    );

    expect(apply).toHaveBeenCalledTimes(1);
    expect(
      prisma.db.workItemChangeSetMaterializationCheckpoint.update,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'checkpoint-1' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    );
  });

  it('mutates once and verifies again when the postcondition is absent', async () => {
    const { service } = createService();
    jest
      .spyOn(service as any, 'verifyOperationPostcondition')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const apply = jest
      .spyOn(service as any, 'applyOperation')
      .mockResolvedValue(undefined);

    await (service as any).applyCheckpoint(
      {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      },
      { id: 'materialization-1' },
      { id: 'checkpoint-1', operationIndex: 0 },
      {
        op: 'workItem.delete',
        ref: { refType: 'existing', id: 'task-1' },
      },
      { workItems: { 'existing:task-1': 'task-1' }, relationships: {} },
      'claim-1',
    );

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('resumes a mixed workflow update after an ambiguous Graph timeout', async () => {
    const { service, agentEdgeClient } = createService();
    const operations = [
      {
        op: 'workItem.create' as const,
        ref: { refType: 'temporary' as const, tempId: 'check-prices' },
        name: 'Check prices',
        type: 'workflow_step',
        parent: { refType: 'existing' as const, id: 'workflow-1' },
      },
      {
        op: 'section.replace' as const,
        ref: { refType: 'temporary' as const, tempId: 'check-prices' },
        key: 'description',
        content: 'Compare the current cart total with the launch budget.',
      },
      {
        op: 'relationship.create' as const,
        ref: { refType: 'temporary' as const, tempId: 'prices-in' },
        source: { refType: 'existing' as const, id: 'fill-cart-step' },
        target: { refType: 'temporary' as const, tempId: 'check-prices' },
        edgeType: 'STANDARD' as const,
        category: 'flow' as const,
        direction: 'forward' as const,
      },
      {
        op: 'relationship.create' as const,
        ref: { refType: 'temporary' as const, tempId: 'prices-out' },
        source: { refType: 'temporary' as const, tempId: 'check-prices' },
        target: { refType: 'existing' as const, id: 'checkout-step' },
        edgeType: 'STANDARD' as const,
        category: 'flow' as const,
        direction: 'forward' as const,
      },
      {
        op: 'relationship.create' as const,
        ref: { refType: 'temporary' as const, tempId: 'prices-too-high' },
        source: { refType: 'temporary' as const, tempId: 'check-prices' },
        target: { refType: 'existing' as const, id: 'adjust-cart-step' },
        edgeType: 'CONDITIONAL' as const,
        category: 'flow' as const,
        direction: 'forward' as const,
        predicate: 'Too high',
      },
      {
        op: 'layout.replace' as const,
        root: { refType: 'existing' as const, id: 'workflow-1' },
        sectionKey: 'graphLayout',
        entries: [
          {
            node: { refType: 'temporary' as const, tempId: 'check-prices' },
            position: { x: 320, y: 160 },
          },
        ],
      },
    ];
    const request = {
      root: { refType: 'existing' as const, id: 'workflow-1' },
      operations,
      layoutBoundary: [
        { refType: 'temporary' as const, tempId: 'check-prices' },
      ],
    };
    const validationRevision = service.validationRevision(request);
    const mappings = {
      workItems: {
        'existing:workflow-1': 'workflow-1',
        'existing:fill-cart-step': 'fill-cart-step',
        'existing:checkout-step': 'checkout-step',
        'existing:adjust-cart-step': 'adjust-cart-step',
        'temporary:check-prices': 'stable-check-prices-id',
      },
      relationships: {
        'temporary:prices-in': 'stable-prices-in-id',
        'temporary:prices-out': 'stable-prices-out-id',
        'temporary:prices-too-high': 'stable-prices-too-high-id',
      },
    };
    const intent = {
      id: 'materialization-1',
      proposalId: 'proposal-1',
      rootWorkItemId: 'workflow-1',
      operationSet: request,
      validationRevision,
      priorProjectionRevision: validationRevision,
      workItemIdMappings: mappings.workItems,
      relationshipIdMappings: mappings.relationships,
      priorProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: projectionFor('workflow-1', 'Coffee Cart Launch'),
      },
      targetProjection: {
        schemaVersion: 'work-item-change-set-projection.v1',
        projection: projectionFor('workflow-1', 'Coffee Cart Launch'),
      },
      affectedWorkItemIds: Object.values(mappings.workItems),
      affectedRelationshipIds: Object.values(mappings.relationships),
      checkpoints: operations.map((operation, operationIndex) => ({
        id: `checkpoint-${operationIndex}`,
        operationIndex,
        operationKind: operation.op,
        validationRevision,
      })),
    };
    const operationKey = (operation: (typeof operations)[number]) =>
      operation.op === 'relationship.create'
        ? `relationship:${operation.ref.tempId}`
        : operation.op === 'workItem.create'
          ? `workItem:${operation.ref.tempId}`
          : operation.op === 'section.replace'
            ? `section:${operation.ref.tempId}:${operation.key}`
            : `layout:${operation.sectionKey}`;
    const satisfied = new Set<string>();
    let injectedTimeout = false;
    agentEdgeClient.createBatch.mockImplementation(
      async (_organizationId, _projectId, dtos) => {
        if (!injectedTimeout) {
          injectedTimeout = true;
          satisfied.add('relationship:prices-in');
          return dtos.map((_dto: unknown, index: number) => ({
            index,
            success: false,
            error: 'downstream Graph timeout after commit',
          }));
        }
        const relationshipKeys = [
          'relationship:prices-in',
          'relationship:prices-out',
          'relationship:prices-too-high',
        ];
        return dtos.map((dto: Record<string, unknown>, index: number) => {
          satisfied.add(relationshipKeys[index]!);
          return { index, success: true, edge: dto };
        });
      },
    );
    const verify = jest
      .spyOn(service as any, 'verifyOperationPostcondition')
      .mockImplementation(async (_params, operation) =>
        satisfied.has(operationKey(operation as (typeof operations)[number])),
      );
    const apply = jest
      .spyOn(service as any, 'applyOperation')
      .mockImplementation(
        async (_params, _materializationId, operation, appliedMappings) => {
          expect(appliedMappings).toEqual(mappings);
          const key = operationKey(operation as (typeof operations)[number]);
          satisfied.add(key);
        },
      );
    const params = {
      proposalId: 'proposal-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
    };

    await expect(
      (service as any).applyPreparedIntent(
        params,
        { ...intent, status: 'APPLYING', claimToken: 'claim-1' },
        'claim-1',
      ),
    ).rejects.toThrow('downstream Graph timeout after commit');

    expect(satisfied).toEqual(
      new Set([
        'workItem:check-prices',
        'section:check-prices:description',
        'relationship:prices-in',
      ]),
    );

    const completedBeforeRetry = new Set(satisfied);
    await expect(
      (service as any).applyPreparedIntent(
        params,
        { ...intent, status: 'APPLYING', claimToken: 'claim-2' },
        'claim-2',
      ),
    ).resolves.toBeUndefined();

    expect(satisfied).toEqual(new Set(operations.map(operationKey)));
    for (const operation of operations.filter(
      (candidate) => candidate.op !== 'relationship.create',
    )) {
      expect(
        apply.mock.calls.filter((call) => call[2] === operation),
      ).toHaveLength(completedBeforeRetry.has(operationKey(operation)) ? 2 : 1);
    }
    expect(agentEdgeClient.createBatch).toHaveBeenCalledTimes(2);
    expect(agentEdgeClient.get).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalled();
  });

  it.each(['meta', undefined] as const)(
    'materializes and verifies nine relationship creates with category %s with two Graph requests',
    async (category) => {
      const { service, agentEdgeClient } = createService();
      agentEdgeClient.createBatch.mockImplementation((_org, _project, dtos) =>
        Promise.resolve(
          dtos.map((dto: Record<string, unknown>, index: number) => ({
            index,
            success: true,
            edge: { ...dto, category: 'meta' },
          })),
        ),
      );
      const timingLog = jest.spyOn((service as any).logger, 'log');
      const operations = Array.from({ length: 9 }, (_, index) => ({
        op: 'relationship.create' as const,
        ref: { refType: 'temporary' as const, tempId: `edge-${index}` },
        source: { refType: 'existing' as const, id: `source-${index}` },
        target: { refType: 'existing' as const, id: `target-${index}` },
        edgeType: 'RELATED_TO' as const,
        ...(category === undefined ? {} : { category }),
      }));
      const request = {
        root: { refType: 'existing' as const, id: 'source-0' },
        operations,
      };
      const validationRevision = service.validationRevision(request);
      const mappings = {
        workItems: Object.fromEntries(
          operations.flatMap((operation, index) => [
            [`existing:${operation.source.id}`, `source-${index}`],
            [`existing:${operation.target.id}`, `target-${index}`],
          ]),
        ),
        relationships: Object.fromEntries(
          operations.map((operation, index) => [
            `temporary:${operation.ref.tempId}`,
            `relationship-${index}`,
          ]),
        ),
      };
      const intent = {
        id: 'materialization-1',
        rootWorkItemId: 'source-0',
        operationSet: request,
        validationRevision,
        priorProjectionRevision: validationRevision,
        workItemIdMappings: mappings.workItems,
        relationshipIdMappings: mappings.relationships,
        priorProjection: {
          schemaVersion: 'work-item-change-set-projection.v1',
          projection: projectionFor('source-0'),
        },
        targetProjection: {
          schemaVersion: 'work-item-change-set-projection.v1',
          projection: projectionFor('source-0'),
        },
        affectedWorkItemIds: Object.values(mappings.workItems),
        affectedRelationshipIds: Object.values(mappings.relationships),
        checkpoints: operations.map((operation, operationIndex) => ({
          id: `checkpoint-${operationIndex}`,
          operationIndex,
          operationKind: operation.op,
          validationRevision,
        })),
      };
      const params = {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      };

      await (service as any).applyPreparedIntent(params, intent, 'claim-1');
      const submittedEdges = agentEdgeClient.createBatch.mock.calls[0]![2];
      agentEdgeClient.findIncident.mockResolvedValue(
        submittedEdges.map((edge: object) => ({ ...edge, category: 'meta' })),
      );
      const hydrated = await (service as any).findCreatedRelationships(
        params,
        operations,
        mappings,
      );

      expect(agentEdgeClient.createBatch).toHaveBeenCalledTimes(1);
      expect(agentEdgeClient.findIncident).toHaveBeenCalledTimes(1);
      expect(agentEdgeClient.get).not.toHaveBeenCalled();
      expect(hydrated.size).toBe(9);
      expect(timingLog).toHaveBeenCalledWith(
        'Generic relationship batch materialization timing',
        expect.objectContaining({
          edgeCount: 9,
          failureCount: 0,
          outcome: 'success',
          graphRequestCount: 1,
          graphTransactionCount: 9,
          graphStatementCount: 18,
          applyingCheckpointPersistenceMs: expect.any(Number),
          completedCheckpointPersistenceMs: expect.any(Number),
          failureCheckpointPersistenceMs: 0,
          graphRequestElapsedMs: expect.any(Number),
          totalElapsedMs: expect.any(Number),
        }),
      );
    },
  );

  it('uses the grouped reservation for a temporary root identity', () => {
    const { service } = createService();
    const reservedRootId = '123e4567-e89b-42d3-a456-426614174300';

    const mappings = (service as any).allocateIdentityMappings(
      {
        root: { refType: 'temporary', tempId: 'root' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'root' },
            name: 'Root',
            type: 'STANDARD',
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'child' },
            name: 'Child',
            type: 'STANDARD',
          },
        ],
      },
      reservedRootId,
    );

    expect(mappings.workItems['temporary:root']).toBe(reservedRootId);
    expect(mappings.workItems['temporary:child']).toEqual(expect.any(String));
    expect(mappings.workItems['temporary:child']).not.toBe(reservedRootId);
  });
});

function reconciliationStub(completedEffects = new Set<string>()) {
  return {
    guardTaskEffect: jest.fn(
      async (
        _tx: unknown,
        _proposal: unknown,
        materializationId: string,
        taskId: string,
        operationIndex: number,
        _creates: boolean,
        write: () => Promise<unknown>,
      ) => {
        const key = `${materializationId}:${taskId}:${operationIndex}`;
        if (completedEffects.has(key)) return;
        const result = await write();
        completedEffects.add(key);
        return result;
      },
    ),
    recordEdgeEffect: jest.fn(),
    reviewedEdgeBasis: jest.fn().mockResolvedValue({ version: '' }),
    edgeBasis: jest.fn().mockResolvedValue({ version: '' }),
    publishTaskEffects: jest.fn(
      async (
        _tx: unknown,
        _proposal: unknown,
        _materializationId: string,
        write: (writtenTaskIds: string[]) => Promise<unknown>,
      ) => write(['task-1']),
    ),
  } as never;
}

function createService(workItemTypeRegistry?: {
  getSectionDefinitions: jest.Mock;
  getRulesForProject?: jest.Mock;
}) {
  const completedEffects = new Set<string>();
  let activeClaimToken = 'claim-1';
  const workItemChangeSetMaterialization = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue({ id: 'materialization-1' }),
    findUniqueOrThrow: jest.fn(async () => ({
      claimToken: activeClaimToken,
      claimExpiresAt: new Date(Date.now() + 60000),
      proposal: { id: 'proposal-1' },
    })),
    update: jest.fn().mockResolvedValue(undefined),
    updateMany: jest.fn(async ({ where }) => {
      if (where.claimToken) activeClaimToken = where.claimToken;
      return { count: 1 };
    }),
  };
  const workItemChangeSetMaterializationCheckpoint = {
    update: jest.fn().mockResolvedValue(undefined),
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    proposalReconciliationReplacement: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    workItemChangeSetMaterialization,
    workItemChangeSetMaterializationCheckpoint,
  };
  const prisma = {
    db: {
      $transaction: jest.fn(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      ),
      workItemChangeSetMaterializationCheckpoint,
      workItemChangeSetMaterialization,
      task: { findFirst: jest.fn() },
      taskSection: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      proposalReconciliationEffect: { upsert: jest.fn() },
      proposal: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'proposal-1',
          organizationId: 'organization-1',
          projectId: 'project-1',
        }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    },
  };
  const taskService = {
    createInTransaction: jest.fn().mockResolvedValue({ id: 'task-1' }),
    replaceServiceAssignmentsInTransaction: jest
      .fn()
      .mockResolvedValue(undefined),
    updateInTransaction: jest.fn().mockResolvedValue(undefined),
    runUpdatePostCommit: jest.fn().mockResolvedValue(undefined),
    applySectionUpdatesInTransaction: jest.fn().mockResolvedValue(undefined),
  };
  const agentEdgeClient = {
    create: jest.fn(),
    createBatch: jest.fn().mockImplementation((_org, _project, dtos) =>
      Promise.resolve(
        dtos.map((dto: Record<string, unknown>, index: number) => ({
          index,
          success: true,
          edge: dto,
        })),
      ),
    ),
    update: jest.fn(),
    delete: jest.fn(),
    get: jest.fn(),
    findIncident: jest.fn().mockResolvedValue([]),
  };
  const projector = {
    rehydrateCurrentProjection: jest.fn(),
    projectSnapshots: jest.fn(),
  };
  const mentionProcessingService = {
    extractAndValidate: jest.fn().mockResolvedValue([]),
  };
  return {
    service: new WorkItemChangeSetMaterializerService(
      prisma as any,
      projector as any,
      taskService as any,
      agentEdgeClient as any,
      {} as any,
      jest.fn(),
      reconciliationStub(completedEffects),
      workItemTypeRegistry as any,
      {} as any,
      mentionProcessingService as any,
    ),
    taskService,
    prisma,
    agentEdgeClient,
    projector,
  };
}

function preparedIntent(params: {
  operationSet: {
    root: { refType: 'existing'; id: string };
    operations: never[];
  };
  validationRevision: string;
  targetProjection?: unknown;
}) {
  return {
    id: 'materialization-1',
    proposalId: 'proposal-1',
    rootWorkItemId: params.operationSet.root.id,
    status: WorkItemChangeSetMaterializationStatus.PREPARED,
    validationRevision: params.validationRevision,
    priorProjectionRevision: params.validationRevision,
    operationSet: params.operationSet,
    workItemIdMappings: {
      [`existing:${params.operationSet.root.id}`]: params.operationSet.root.id,
    },
    relationshipIdMappings: {},
    priorProjection: {
      schemaVersion: 'work-item-change-set-projection.v1',
      projection: projectionFor(params.operationSet.root.id, 'Prior title'),
    },
    targetProjection: {
      schemaVersion: 'work-item-change-set-projection.v1',
      projection:
        params.targetProjection ?? projectionFor(params.operationSet.root.id),
    },
    affectedWorkItemIds: [params.operationSet.root.id],
    affectedRelationshipIds: [],
    lastError: 'old diagnostic',
    checkpoints: [],
  };
}

function projectionFor(id: string, name = 'Target title') {
  return {
    valid: true,
    projectedRoot: {
      identity: { refType: 'existing' as const, id },
      label: name,
      type: 'STANDARD',
      name,
      status: 'BACKLOG',
      sections: [],
      deleted: false,
    },
    children: [],
    sections: [],
    incidentRelationships: [],
    identityLabels: { [`existing:${id}`]: name },
    issues: [],
  };
}

function projectionForTemporaryRoot(tempId: string, name = 'Target title') {
  return {
    ...projectionFor('placeholder', name),
    projectedRoot: {
      ...projectionFor('placeholder', name).projectedRoot,
      identity: { refType: 'temporary' as const, tempId },
    },
    identityLabels: { [`temporary:${tempId}`]: name },
  };
}

describe('materializer persistence and Graph adapter boundary', () => {
  it.each([false, true])(
    'reloads and resumes after Graph failure (committed=%s) without duplicate writes',
    async (commitBeforeFailure) => {
      const { service, prisma } = createService();
      const db = prisma.db as any;
      const tasks = new Map<string, any>([
        [
          'feature',
          {
            id: 'feature',
            type: 'FEATURE',
            projectId: '123e4567-e89b-42d3-a456-426614174003',
          },
        ],
      ]);
      const sections = new Map<string, any>();
      const edges = new Map<string, any>();
      db.$transaction.mockImplementation(async (callback: any) => callback(db));
      db.$queryRaw = jest.fn().mockResolvedValue([]);
      db.workItemTypeCascadeExecution = {
        findFirst: jest.fn().mockResolvedValue(null),
      };
      db.workItemChangeSetMaterialization.findMany.mockResolvedValue([
        { id: 'materialization-1', status: 'APPLYING' },
      ]);
      db.task = {
        create: jest.fn(async ({ data }: any) => {
          if (tasks.has(data.id)) throw new Error('duplicate task');
          const row = { ...data, initiativeId: null, serviceRelations: [] };
          tasks.set(data.id, row);
          for (const section of data.sections.create) {
            const id = data.id + ':' + section.key;
            sections.set(id, { ...section, id, taskId: data.id });
          }
          return row;
        }),
        findFirst: jest.fn(
          async ({ where }: any) => tasks.get(where.id) ?? null,
        ),
        findUniqueOrThrow: jest.fn(async ({ where }: any) =>
          tasks.get(where.id),
        ),
        findMany: jest.fn(async ({ where }: any) =>
          [...tasks.values()].filter((t) => where.id.in.includes(t.id)),
        ),
      };
      db.taskSection = {
        findFirst: jest.fn(
          async ({ where }: any) =>
            sections.get(where.taskId + ':' + where.key) ?? null,
        ),
        findMany: jest.fn(async ({ where }: any) =>
          [...sections.values()].filter(
            (s) =>
              s.taskId === where.taskId &&
              (!where.key?.in || where.key.in.includes(s.key)),
          ),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          Object.assign(sections.get(where.id), data);
          return sections.get(where.id);
        }),
      };
      // Real TaskService persistence methods; only event publication and hierarchy
      // effects outside this boundary are replaced.
      const registry = await createWarmWorkItemTypeRegistry();
      const taskService = Object.assign(Object.create(TaskService.prototype), {
        logger: new Logger('TaskServiceBoundary'),
        workItemTypeRegistry: registry,
        taskSectionSchemaValidators: new TaskSectionSchemaValidatorRegistry(),
        workItemParentageValidator: new WorkItemParentageValidator(registry),
        publishTaskCreatedEvent: jest.fn(),
        publishTaskContentChangedEvent: jest.fn(),
        rollUpCanonicalPlanHierarchy: jest.fn(),
      });
      (service as any).taskService = taskService;
      let fail = true;
      const transport = {
        getAgentEdge: jest.fn((_org, _project, id) =>
          edges.has(id)
            ? of({ data: edges.get(id) })
            : throwError(() => ({ response: { status: 404 } })),
        ),
        createAgentEdge: jest.fn((_org, _project, dto) =>
          defer(() => {
            const row = {
              ...dto,
              reasoning:
                dto.reasoning ?? 'Generic work-item change-set relationship.',
              createdAt: '',
              updatedAt: '',
            };
            if (!fail || commitBeforeFailure) edges.set(dto.id, row);
            if (fail) {
              fail = false;
              throw new Error('Graph connection lost');
            }
            return of({ data: row });
          }),
        ),
        createAgentEdgesBatch: jest.fn((_org, _project, request) =>
          defer(() => {
            const results = request.edges.map((dto: any, index: number) => {
              const row = {
                ...dto,
                reasoning:
                  dto.reasoning ?? 'Generic work-item change-set relationship.',
                createdAt: '',
                updatedAt: '',
              };
              if (!fail || commitBeforeFailure) edges.set(dto.id, row);
              if (fail) {
                return {
                  index,
                  success: false,
                  error: 'Graph connection lost',
                };
              }
              return { index, success: true, edge: row };
            });
            if (fail) fail = false;
            return of({ data: { results } });
          }),
        ),
        updateAgentEdge: jest.fn((_org, _project, id, dto) => {
          const row = { ...edges.get(id), ...dto };
          edges.set(id, row);
          return of({ data: row });
        }),
        deleteAgentEdge: jest.fn((_org, _project, id) => {
          edges.delete(id);
          return of({ data: undefined });
        }),
      };
      (service as any).agentEdgeClient = new AgentEdgeClientService(
        transport as any,
        prisma as any,
      );
      const request = {
        root: { refType: 'temporary', tempId: 'later' },
        operations: [
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'first' },
            name: 'First',
            type: 'STANDARD',
            parent: { refType: 'existing', id: 'feature' },
          },
          {
            op: 'workItem.create',
            ref: { refType: 'temporary', tempId: 'later' },
            name: 'Later',
            type: 'STANDARD',
            parent: { refType: 'existing', id: 'feature' },
          },
          {
            op: 'section.replace',
            ref: { refType: 'temporary', tempId: 'later' },
            key: 'description',
            content: 'Reviewed implementation',
          },
          {
            op: 'relationship.create',
            ref: { refType: 'temporary', tempId: 'dependency' },
            source: { refType: 'temporary', tempId: 'later' },
            target: { refType: 'temporary', tempId: 'first' },
            edgeType: 'DEPENDS_ON',
            category: 'meta',
          },
        ],
      };
      const revision = service.validationRevision(request as any);
      const intent = JSON.parse(
        JSON.stringify({
          id: 'materialization-1',
          proposalId: 'proposal-1',
          rootWorkItemId: 'later',
          operationSet: request,
          validationRevision: revision,
          priorProjectionRevision: revision,
          workItemIdMappings: {
            'existing:feature': 'feature',
            'temporary:first': 'first',
            'temporary:later': 'later',
          },
          relationshipIdMappings: { 'temporary:dependency': 'dependency' },
          priorProjection: {
            schemaVersion: 'work-item-change-set-projection.v1',
            projection: projectionFor('later'),
          },
          targetProjection: {
            schemaVersion: 'work-item-change-set-projection.v1',
            projection: projectionFor('later'),
          },
          affectedWorkItemIds: ['first', 'later'],
          affectedRelationshipIds: ['dependency'],
          checkpoints: request.operations.map((operation, operationIndex) => ({
            id: 'checkpoint-' + operationIndex,
            operationIndex,
            operationKind: operation.op,
            validationRevision: revision,
          })),
        }),
      );
      const checkpointStates = new Map<string, string>();
      db.workItemChangeSetMaterializationCheckpoint.update.mockImplementation(
        async ({ where, data }: any) => {
          checkpointStates.set(where.id, data.status);
          return { id: where.id, ...data };
        },
      );
      const params = {
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: '123e4567-e89b-42d3-a456-426614174003',
      };
      await expect(
        (service as any).applyPreparedIntent(params, intent, 'claim-1'),
      ).rejects.toThrow('Graph connection lost');
      expect([...checkpointStates.values()]).toEqual([
        'COMPLETED',
        'COMPLETED',
        'COMPLETED',
        'FAILED',
      ]);
      expect(tasks.size).toBe(3);
      expect(sections.get('later:description').materializedMarkdown).toBe(
        'Reviewed implementation',
      );
      expect(edges.size).toBe(commitBeforeFailure ? 1 : 0);
      await (service as any).applyPreparedIntent(
        params,
        JSON.parse(JSON.stringify(intent)),
        'claim-2',
      );
      expect([...checkpointStates.values()]).toEqual([
        'COMPLETED',
        'COMPLETED',
        'COMPLETED',
        'COMPLETED',
      ]);
      expect(db.task.create).toHaveBeenCalledTimes(2);
      expect(db.taskSection.update).toHaveBeenCalledTimes(1);
      expect(transport.createAgentEdge).not.toHaveBeenCalled();
      expect(transport.createAgentEdgesBatch).toHaveBeenCalledTimes(2);
      expect(edges.size).toBe(1);
      expect(edges.get('dependency')).toMatchObject({
        sourceNodeId: 'later',
        targetNodeId: 'first',
        type: 'DEPENDS_ON',
      });
      const mappings = {
        workItems: { 'existing:first': 'first', 'existing:later': 'later' },
        relationships: { 'existing:dependency': 'dependency' },
      };
      for (const operation of [
        {
          op: 'relationship.update',
          ref: { refType: 'existing', id: 'dependency' },
          reasoning: 'Updated reason',
          source: { refType: 'existing', id: 'first' },
          target: { refType: 'existing', id: 'later' },
        },
        {
          op: 'relationship.delete',
          ref: { refType: 'existing', id: 'dependency' },
        },
      ]) {
        await (service as any).applyCheckpoint(
          params,
          intent,
          { id: 'checkpoint-extra', operationIndex: 4 },
          operation,
          mappings,
          'claim-2',
        );
      }
      expect(transport.updateAgentEdge).toHaveBeenCalledTimes(1);
      expect(transport.updateAgentEdge.mock.calls[0]?.[3]).toMatchObject({
        sourceNodeId: 'first',
        sourceEntityType: 'TASK',
        targetNodeId: 'later',
        targetEntityType: 'TASK',
      });
      expect(transport.deleteAgentEdge).toHaveBeenCalledTimes(1);
      expect(edges.size).toBe(0);
      expect(db.taskDependency).toBeUndefined();
    },
  );
});

describe('WorkItemChangeSetMaterializerService dependency injection', () => {
  it('declares the work-item type registry as a resolvable injection token', () => {
    const paramTypes = Reflect.getMetadata(
      'design:paramtypes',
      WorkItemChangeSetMaterializerService,
    ) as unknown[];
    expect(paramTypes).toContain(WorkItemTypeRegistryService);
  });
});

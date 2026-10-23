import type {
  CreateTaskDto,
  UpdateTaskDto,
  WorkItemChangeSetValidationRequest,
} from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import {
  deriveChangedFields,
  resolveEntityContext,
  type EntityContextInput,
} from '../entity-context-resolver';
import { evaluatePermissions } from '../permission-evaluation';
import { DEFAULT_PROJECT_APPROVAL_POLICY } from '../project-approval-policy.service';
import { proposalWriteFacts } from '../task-proposal-change-set-conversion';

const rootId = '11111111-1111-4111-8111-111111111111';
const parentId = '22222222-2222-4222-8222-222222222222';
const input = (action: string, updates: unknown): EntityContextInput => ({
  targetEntityType: 'TASK',
  targetEntityId: rootId,
  action,
  updates,
});

// Ordinary proposals derive changed fields from write facts alone.
const noDb = {} as AnyTransactionClient;

describe('proposal write facts', () => {
  it('gives raw, prepared and graph FEATURE creates the same content approval facts', async () => {
    const raw = {
      name: 'Billing',
      type: 'FEATURE',
      tag: 'product',
      initialRequirements: [],
    } satisfies CreateTaskDto;
    const prepared = {
      name: raw.name,
      type: raw.type,
      tag: raw.tag,
      sections: [{ key: 'requirements', content: { records: [] } }],
    } satisfies CreateTaskDto;
    const graph = {
      root: { refType: 'temporary', tempId: 'root' },
      operations: [
        {
          op: 'workItem.create',
          ref: { refType: 'temporary', tempId: 'root' },
          name: raw.name,
          type: raw.type,
          tag: raw.tag,
        },
        {
          op: 'section.replace',
          ref: { refType: 'temporary', tempId: 'root' },
          key: 'requirements',
          content: { records: [] },
        },
      ],
    } satisfies WorkItemChangeSetValidationRequest;
    // CREATE permission context and write facts require no database access.
    const db = {} as AnyTransactionClient;
    for (const updates of [raw, prepared, graph]) {
      const proposal = input('CREATE', updates);
      const entity = await resolveEntityContext(db, proposal);
      expect(entity).toEqual({
        type: 'FEATURE',
        parentTaskId: null,
        initiativeId: null,
      });
      expect(new Set(await deriveChangedFields(noDb, proposal))).toEqual(
        new Set(['name', 'type', 'tag', 'sections.requirements']),
      );
      expect(
        evaluatePermissions(
          entity,
          {
            source: 'agent',
            action: 'CREATE',
            toolName: null,
            authorId: rootId,
            eligibleProjectMemberIds: [rootId],
            changedFields: await deriveChangedFields(noDb, proposal),
          },
          DEFAULT_PROJECT_APPROVAL_POLICY,
        ),
      ).toMatchObject({
        threshold: 1,
        allowsProposerApproval: false,
      });
    }
  });

  it('keeps requirement operations equivalent to their prepared section, including empty operations', async () => {
    const raw = {
      requirementOps: [{ op: 'delete', targetId: rootId }],
    } satisfies UpdateTaskDto;
    const prepared = {
      sections: [{ key: 'requirements', content: { records: [] } }],
    } satisfies UpdateTaskDto;
    expect(await deriveChangedFields(noDb, input('UPDATE', raw))).toEqual(
      await deriveChangedFields(noDb, input('UPDATE', prepared)),
    );
    expect(
      await deriveChangedFields(noDb, input('UPDATE', { requirementOps: [] })),
    ).toEqual([]);
    expect(await deriveChangedFields(noDb, input('UPDATE', {}))).toEqual([]);
  });

  it('reads root field updates and section clears from graph operations using semantic identities', async () => {
    const graph = {
      root: { refType: 'existing', id: rootId },
      operations: [
        {
          op: 'workItem.update',
          ref: { refType: 'existing', id: rootId },
          status: 'ACTIVE',
          parent: null,
        },
        {
          op: 'section.clear',
          ref: { refType: 'existing', id: rootId },
          key: 'description',
        },
        {
          op: 'section.replace',
          ref: { refType: 'existing', id: rootId },
          key: 'requirements',
          content: { records: [] },
        },
        {
          op: 'section.replace',
          ref: { refType: 'existing', id: parentId },
          key: 'acceptanceCriteria',
          content: 'Unchanged root scope',
        },
      ],
    } satisfies WorkItemChangeSetValidationRequest;
    expect(
      new Set(await deriveChangedFields(noDb, input('UPDATE', graph))),
    ).toEqual(
      new Set([
        'status',
        'parentTaskId',
        'sections.description',
        'sections.requirements',
      ]),
    );
    expect(
      evaluatePermissions(
        { type: 'FEATURE', parentTaskId: null, initiativeId: null },
        {
          source: 'agent',
          action: 'UPDATE',
          toolName: null,
          authorId: rootId,
          eligibleProjectMemberIds: [rootId],
          changedFields: await deriveChangedFields(
            noDb,
            input('UPDATE', graph),
          ),
        },
        DEFAULT_PROJECT_APPROVAL_POLICY,
      ),
    ).toMatchObject({ threshold: 1 });
  });

  it('keeps a graph create nested when its parent is another temporary work item', async () => {
    const graph = {
      root: { refType: 'temporary', tempId: 'child' },
      operations: [
        {
          op: 'workItem.create',
          ref: { refType: 'temporary', tempId: 'parent' },
          name: 'Parent',
          type: 'FEATURE',
        },
        {
          op: 'workItem.create',
          ref: { refType: 'temporary', tempId: 'child' },
          parent: { refType: 'temporary', tempId: 'parent' },
          name: 'Child',
          type: 'FEATURE',
        },
      ],
    } satisfies WorkItemChangeSetValidationRequest;
    expect(
      await resolveEntityContext(
        {} as AnyTransactionClient,
        input('CREATE', graph),
      ),
    ).toEqual({
      type: 'FEATURE',
      parentTaskId: 'parent',
      initiativeId: null,
    });
  });

  it('retains write facts while requirement content still needs preparation', () => {
    expect(
      proposalWriteFacts(
        input('CREATE', {
          name: 'Billing',
          type: 'FEATURE',
          initialRequirements: [],
        }),
      ),
    ).toEqual({
      fieldUpdates: ['name', 'type'],
      sectionWrites: ['requirements'],
      hasUnpreparedRequirements: true,
    });
  });
});

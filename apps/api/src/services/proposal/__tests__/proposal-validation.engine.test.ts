import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ProposalValidationEngine,
  assertProposalStructurallyValid,
  validateProposalStructure,
} from '../proposal-validation.engine';
import type { ValidateProposalsInput } from '../proposal-validation.types';
import * as TestUtils from '../../../utils/testUtils';
import type {
  CreateProposalDto,
  CreateProposalRequestDto,
  Influence,
} from '../../../generated';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { WorkItemParentageValidator } from '../../tasks/work-item-parentage-validator.service';
import {
  createWarmWorkItemTypeRegistry,
  createRegistryWithArchivedSystemType,
  createWarmWorkItemTypeRegistryWithCustomTypes,
} from '../../../../test/setup/work-item-type-registry.fixture';

import type { WorkItemTypeDefinitionDto } from '../../../generated/model/workItemTypeDefinitionDto';
import { EntityType } from '../../../generated/model/entityType';
import { WorkItemTypeEffectiveSource } from '../../../generated/model/workItemTypeEffectiveSource';
import type { TaskMonitorExecutionDefinition } from '../../../generated/model/taskMonitorExecutionDefinition';
import { TaskMonitorReviewMode } from '../../../generated/model/taskMonitorReviewMode';
import { WorkItemChangeSetProjectorService } from '../work-item-change-set-projector.service';
import {
  snapshotEdgeTitles,
  snapshotInfluenceReferences,
} from '../proposal-title-snapshot';

const { testIds } = TestUtils;

const TARGET_PROPOSAL_ID = '77777777-7777-4777-8777-777777777777';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const TASK_MONITOR_TASK_ID = '44444444-4444-4444-8444-444444444444';

const VALID_TASK_MONITOR_EXECUTION_DEFINITION = {
  executionPlan: [
    {
      taskId: TASK_MONITOR_TASK_ID,
      dependsOnTaskIds: [],
      launchConfiguration: {
        method: 'quick',
        provider: 'codex',
        model: 'gpt-5.5',
        reasoningEffort: 'high',
      },
      agentSessionId: '55555555-5555-4555-8555-555555555555',
    },
  ],
  launchPolicy: {
    terminalSupervision: { mode: TaskMonitorReviewMode.AgentDecides },
  },
  cursor: 0,
} satisfies TaskMonitorExecutionDefinition;

/**
 * A well-formed WORK_ITEM_TYPE CREATE proposal. `defOverrides` patches the
 * serialized WorkItemTypeDefinitionDto in `updates`; `dtoOverrides` patches
 * the envelope. Mirrors the create_work_item_type submit tool: action CREATE,
 * NIL_UUID target for ordinary creation (or an exact retained key for
 * restoration), with the definition serialized straight into `updates`.
 */
function makeCreateWorkItemTypeDto(
  defOverrides?: Partial<WorkItemTypeDefinitionDto>,
  dtoOverrides?: Partial<CreateProposalRequestDto>,
): CreateProposalRequestDto {
  return {
    type: 'SINGLE',
    action: 'CREATE',
    eli5: 'Creates a work item type for review.',
    targetEntityId: NIL_UUID,
    targetEntityType: 'WORK_ITEM_TYPE',
    updates: {
      key: 'MARKETING',
      name: 'Marketing',
      role: 'project-info',
      sections: [{ key: 'audience', label: 'Audience' }],
      allowedStatuses: ['BACKLOG', 'ACTIVE', 'COMPLETED'],
      ...defOverrides,
    },
    ...dtoOverrides,
  };
}

function mockPrismaWithValidationSession() {
  const base = TestUtils.createMockPrismaService();
  (base.db as any).validationSession = {
    findFirst: jest.fn(),
  };
  (base.db as any).taskSection = {
    findFirst: jest.fn(),
  };
  return base;
}

function makeContext(
  overrides?: Partial<ValidateProposalsInput['context']>,
): ValidateProposalsInput['context'] {
  return {
    organizationId: testIds.organization,
    projectId: testIds.project,
    requestor: TestUtils.createMockAuthenticatedUser(),
    ...overrides,
  };
}

function makeUpdateTaskDto(
  overrides?: Partial<CreateProposalRequestDto>,
): CreateProposalRequestDto {
  return {
    type: 'SINGLE',
    action: 'UPDATE',
    eli5: 'Updates a task for review.',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { name: 'Updated name' },
    ...overrides,
  };
}

function makeCreateTaskDto(
  overrides?: Partial<CreateProposalRequestDto>,
): CreateProposalRequestDto {
  return {
    type: 'SINGLE',
    action: 'CREATE',
    eli5: 'Creates a task for review.',
    targetEntityId: '',
    targetEntityType: 'TASK',
    updates: {
      name: 'New task',
      initiativeId: testIds.initiative,
      type: 'STANDARD',
    },
    ...overrides,
  };
}

function makeDeleteTaskDto(
  overrides?: Partial<CreateProposalRequestDto>,
): CreateProposalRequestDto {
  return {
    type: 'SINGLE',
    action: 'DELETE',
    eli5: 'Deletes a task for review.',
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: {},
    ...overrides,
  };
}

function makeCascadeDeleteWorkItemTypeDto(
  updates?: Record<string, unknown>,
  targetEntityId = 'MARKETING',
): CreateProposalRequestDto {
  return {
    type: 'SINGLE',
    action: 'DELETE',
    eli5: 'Deletes a work item type for review.',
    targetEntityId,
    targetEntityType: 'WORK_ITEM_TYPE',
    updates: {
      operation: 'CASCADE_DELETE',
      cascade: true,
      typeKey: targetEntityId,
      itemCount: 2,
      edgeCount: 3,
      ...updates,
    },
  };
}

describe('ProposalValidationEngine', () => {
  let engine: ProposalValidationEngine;
  let mockPrisma: ReturnType<typeof mockPrismaWithValidationSession>;
  let mockProjector: {
    project: jest.Mock;
    projectPlanStageProposalCandidates: jest.Mock;
  };

  beforeEach(async () => {
    mockPrisma = mockPrismaWithValidationSession();
    mockProjector = {
      project: jest.fn().mockResolvedValue({ valid: true }),
      projectPlanStageProposalCandidates: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalValidationEngine,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: WorkItemTypeRegistryService,
          useValue: await createWarmWorkItemTypeRegistry(),
        },
        WorkItemParentageValidator,
        {
          provide: WorkItemChangeSetProjectorService,
          useValue: mockProjector,
        },
      ],
    }).compile();

    engine = module.get<ProposalValidationEngine>(ProposalValidationEngine);
    jest.clearAllMocks();
  });

  describe('authoring admission boundary', () => {
    it.each(['DRAFT', 'REJECTED', 'APPROVED'])(
      'admits direct and batch durable declarations for %s targets without requiring materialization',
      async (status) => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        } as never);
        mockPrisma.db.proposal.findMany.mockResolvedValue([
          {
            id: TARGET_PROPOSAL_ID,
            title: 'Target',
            status,
            targetEntityId: null,
          },
        ] as never);
        const dto = makeCreateTaskDto({
          title: 'Candidate',
          requestorContext,
          updates: { name: 'Candidate', type: 'FEATURE', tag: 'product' },
          edges: [
            {
              endpointMode: 'PROPOSAL',
              targetEntityType: 'PROPOSAL',
              targetEntityId: TARGET_PROPOSAL_ID,
              edgeType: 'EVOLVES',
            },
          ],
        });
        for (const proposals of [[dto], [dto, dto]]) {
          const admitted = await engine.assertAuthoringCandidatesValid({
            proposals,
            context: makeContext(),
          });
          expect(admitted.candidates).toHaveLength(proposals.length);
          expect(
            await snapshotEdgeTitles(
              mockPrisma.db,
              testIds.organization,
              dto.edges,
              admitted.metadata,
            ),
          ).toEqual([{ ...dto.edges![0], targetEntityTitle: 'Target' }]);
        }
        expect(mockPrisma.db.proposal.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: { in: [TARGET_PROPOSAL_ID] },
              organizationId: testIds.organization,
              projectId: testIds.project,
            },
          }),
        );
        mockPrisma.db.proposal.findMany.mockResolvedValue([]);
        dto.edges![0]!.targetEntityTitle =
          'Supplied title cannot authorize a missing or cross-scope target';
        await expect(
          engine.assertAuthoringCandidatesValid({
            proposals: [dto],
            context: makeContext(),
          }),
        ).rejects.toMatchObject({
          response: {
            errors: expect.arrayContaining([
              expect.objectContaining({
                field: 'proposals[0].edges[0].targetEntityId',
                code: 'unresolved_reference',
              }),
            ]),
          },
        });
      },
    );

    it('keeps durable proposal links and rejects graph outer entity targets', () => {
      const dto = makeUpdateTaskDto({
        edges: [
          {
            endpointMode: 'PROPOSAL',
            targetEntityType: 'TASK',
            targetEntityId: testIds.task,
            edgeType: 'EVOLVES',
          },
        ],
      });
      expect(validateProposalStructure(dto)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: expect.stringContaining('targetEntityType'),
          }),
        ]),
      );
      for (const action of ['CREATE', 'UPDATE'] as const) {
        const graph = makeUpdateTaskDto({
          action,
          title: 'Graph',
          updates: {
            root: { refType: 'existing', id: testIds.task },
            operations: [],
          },
          edges: [
            {
              targetEntityType: 'PROPOSAL',
              targetEntityId: TARGET_PROPOSAL_ID,
              edgeType: 'DEPENDS_ON',
            },
          ],
        });
        expect(validateProposalStructure(graph)).toEqual([]);

        const graphWithExistingEntityTarget = {
          ...graph,
          edges: [
            {
              targetEntityType: 'TASK' as const,
              targetEntityId: testIds.task,
              edgeType: 'RELATED_TO' as const,
            },
          ],
        };
        expect(
          validateProposalStructure(graphWithExistingEntityTarget),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].edges[0].targetEntityType',
            }),
          ]),
        );
      }
      const ordinary = makeUpdateTaskDto({
        edges: [
          {
            endpointMode: 'ENTITY',
            targetEntityType: 'TASK',
            targetEntityId: testIds.task,
            edgeType: 'EVOLVES',
          },
        ],
      });
      expect(validateProposalStructure(ordinary)).toEqual([]);
    });
    const requestorContext = {
      source: 'agent' as const,
      userId: testIds.user,
      organizationId: testIds.organization,
      toolName: 'create_work_item',
      timestamp: '2026-09-14T00:00:00.000Z',
    };

    const diagramRootTemporary = {
      refType: 'temporary' as const,
      tempId: 'diagram-root',
    };
    const diagramElementTemporary = {
      refType: 'temporary' as const,
      tempId: 'diagram-element',
    };
    const diagramElementId = '88888888-8888-4888-8888-888888888888';
    const diagramCreateUpdates = {
      root: diagramRootTemporary,
      operations: [
        {
          op: 'workItem.create' as const,
          ref: diagramRootTemporary,
          name: 'Diagram',
          type: WORK_ITEM_TYPE_KEYS.Diagram,
        },
        {
          op: 'workItem.create' as const,
          ref: diagramElementTemporary,
          name: 'Element',
          type: WORK_ITEM_TYPE_KEYS.DiagramElement,
          parent: diagramRootTemporary,
        },
      ],
    };
    const diagramProjection = (
      rootIdentity:
        | { refType: 'existing'; id: string }
        | typeof diagramRootTemporary,
      elementIdentities: Array<
        { refType: 'existing'; id: string } | typeof diagramElementTemporary
      >,
    ) => ({
      valid: true,
      projectedRoot: {
        identity: rootIdentity,
        type: WORK_ITEM_TYPE_KEYS.Diagram,
        deleted: false,
      },
      children: elementIdentities.map((identity) => ({
        identity,
        type: WORK_ITEM_TYPE_KEYS.DiagramElement,
        deleted: false,
      })),
    });
    const createDiagramDto = (
      edge: NonNullable<CreateProposalRequestDto['edges']>[number],
    ) =>
      makeCreateTaskDto({
        title: 'Diagram',
        requestorContext,
        updates: diagramCreateUpdates,
        edges: [edge],
      });
    const targetProposal = (overrides: Record<string, unknown> = {}) => ({
      id: TARGET_PROPOSAL_ID,
      title: 'Target',
      action: 'CREATE',
      status: 'DRAFT',
      targetEntityType: 'TASK',
      updates: { name: 'Target', type: 'FEATURE', tag: 'product' },
      ...overrides,
    });
    const allowDiagramProposalEdges = (targetTypeKeys: string[] = []) => {
      const registry = (engine as any).workItemTypeRegistry;
      const getDefinition = registry.getDefinition.bind(registry);
      jest
        .spyOn(registry, 'getDefinition')
        .mockImplementation((...args: unknown[]) => {
          const [projectId, typeKey] = args as [string, string];
          const summary = getDefinition(projectId, typeKey);
          if (
            summary &&
            (typeKey === WORK_ITEM_TYPE_KEYS.Diagram ||
              typeKey === WORK_ITEM_TYPE_KEYS.DiagramElement)
          ) {
            return {
              ...summary,
              definition: {
                ...summary.definition,
                edgeTargets: [{ edgeType: 'RELATED_TO', targetTypeKeys }],
              },
            };
          }
          return summary;
        });
    };

    it.each([
      {
        label: 'a temporary Diagram Element source',
        sourceRef: diagramElementTemporary,
        projection: diagramProjection(diagramRootTemporary, [
          diagramElementTemporary,
        ]),
      },
      {
        label: 'an existing Diagram Element source',
        sourceRef: { refType: 'existing' as const, id: diagramElementId },
        projection: diagramProjection(
          { refType: 'existing', id: testIds.task },
          [{ refType: 'existing', id: diagramElementId }],
        ),
      },
    ])(
      'admits deferred Diagram links from $label',
      async ({ sourceRef, projection }) => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        } as never);
        mockPrisma.db.proposal.findMany.mockResolvedValue([
          targetProposal(),
        ] as never);
        allowDiagramProposalEdges();
        mockProjector.project.mockResolvedValue(projection as never);

        const edge = {
          targetEntityId: TARGET_PROPOSAL_ID,
          targetEntityType: 'PROPOSAL',
          edgeType: 'RELATED_TO',
          sourceRef,
        } as const;
        const dto =
          sourceRef.refType === 'temporary'
            ? createDiagramDto(edge)
            : makeUpdateTaskDto({
                requestorContext,
                updates: {
                  root: { refType: 'existing', id: testIds.task },
                  operations: [
                    {
                      op: 'workItem.update',
                      ref: { refType: 'existing', id: testIds.task },
                      name: 'Updated Diagram',
                    },
                  ],
                },
                edges: [edge],
              });
        if (sourceRef.refType === 'existing') {
          mockPrisma.db.entityRegistry.findMany.mockResolvedValue([
            {
              entityId: testIds.task,
              entityType: 'TASK',
              entityName: 'Diagram',
              deletedAt: null,
            },
          ] as never);
          mockPrisma.db.task.findMany.mockResolvedValue([
            {
              id: testIds.task,
              type: WORK_ITEM_TYPE_KEYS.Diagram,
              projectId: testIds.project,
            },
          ] as never);
        }
        const admission = await engine.assertAuthoringCandidatesValid({
          proposals: [dto],
          context: makeContext(),
        });

        expect(admission.candidates[0]!.candidate.edges).toEqual(dto.edges);
        expect(mockProjector.project).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['DRAFT', 'APPROVED'] as const)(
      'uses the Diagram root when the CREATE target is %s',
      async (status) => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        } as never);
        mockPrisma.db.proposal.findMany.mockResolvedValue([
          targetProposal({ status }),
        ] as never);
        allowDiagramProposalEdges();

        const dto = createDiagramDto({
          targetEntityId: TARGET_PROPOSAL_ID,
          targetEntityType: 'PROPOSAL',
          edgeType: 'RELATED_TO',
        });
        const admission = await engine.assertAuthoringCandidatesValid({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          admission.candidates[0]!.candidate.edges?.[0]?.sourceRef,
        ).toBeUndefined();
        expect(mockProjector.project).not.toHaveBeenCalled();
      },
    );

    it('rejects sourceRef on existing-entity targets and durable PROPOSAL links', () => {
      const taskTarget = makeCreateTaskDto({
        title: 'Task',
        requestorContext,
        updates: {
          name: 'Task',
          initiativeId: testIds.initiative,
          type: 'STANDARD',
        },
        edges: [
          {
            targetEntityId: testIds.task,
            targetEntityType: 'TASK',
            edgeType: 'RELATED_TO',
            sourceRef: diagramElementTemporary,
          },
        ],
      });
      expect(validateProposalStructure(taskTarget)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'proposals[0].edges[0].sourceRef',
          }),
        ]),
      );

      const durable = makeCreateTaskDto({
        title: 'Task',
        requestorContext,
        updates: {
          name: 'Task',
          initiativeId: testIds.initiative,
          type: 'STANDARD',
        },
        edges: [
          {
            endpointMode: 'PROPOSAL',
            targetEntityId: TARGET_PROPOSAL_ID,
            targetEntityType: 'PROPOSAL',
            edgeType: 'RELATED_TO',
            sourceRef: diagramElementTemporary,
          },
        ],
      });
      expect(validateProposalStructure(durable)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'proposals[0].edges[0].sourceRef',
          }),
        ]),
      );
    });

    it('rejects a sourceRef outside the projected Diagram change set', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      } as never);
      mockPrisma.db.proposal.findMany.mockResolvedValue([
        targetProposal(),
      ] as never);
      allowDiagramProposalEdges();
      mockProjector.project.mockResolvedValue(
        diagramProjection(diagramRootTemporary, [
          diagramElementTemporary,
        ]) as never,
      );

      await expect(
        engine.assertAuthoringCandidatesValid({
          proposals: [
            createDiagramDto({
              targetEntityId: TARGET_PROPOSAL_ID,
              targetEntityType: 'PROPOSAL',
              edgeType: 'RELATED_TO',
              sourceRef: { refType: 'temporary', tempId: 'outside-change-set' },
            }),
          ],
          context: makeContext(),
        }),
      ).rejects.toMatchObject({
        response: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].edges[0].sourceRef',
              code: 'unresolved_reference',
            }),
          ]),
        },
      });
    });

    it('rejects sourceRef when the Diagram change set has no valid projection', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      } as never);
      mockPrisma.db.proposal.findMany.mockResolvedValue([
        targetProposal(),
      ] as never);
      allowDiagramProposalEdges();
      mockProjector.project.mockResolvedValue({
        ...diagramProjection(diagramRootTemporary, [diagramElementTemporary]),
        valid: false,
      } as never);

      await expect(
        engine.assertAuthoringCandidatesValid({
          proposals: [
            createDiagramDto({
              targetEntityId: TARGET_PROPOSAL_ID,
              targetEntityType: 'PROPOSAL',
              edgeType: 'RELATED_TO',
              sourceRef: {
                refType: 'temporary',
                tempId: 'unprojected-element',
              },
            }),
          ],
          context: makeContext(),
        }),
      ).rejects.toMatchObject({
        response: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].edges[0].sourceRef',
              code: 'unresolved_reference',
            }),
          ]),
        },
      });
    });

    it.each([
      {
        label: 'missing or outside this project',
        rows: [],
        expectedField: 'proposals[0].edges[0].targetEntityId',
      },
      {
        label: 'rejected',
        rows: [targetProposal({ status: 'REJECTED' })],
        expectedField: 'proposals[0].edges[0].targetEntityId',
      },
      {
        label: 'not a CREATE',
        rows: [targetProposal({ action: 'UPDATE' })],
        expectedField: 'proposals[0].edges[0].targetEntityId',
      },
      {
        label: 'with an unregistered work-item type',
        rows: [
          targetProposal({
            updates: { name: 'Target', type: 'UNREGISTERED_TYPE' },
          }),
        ],
        expectedField: 'proposals[0].edges[0].targetEntityId',
      },
      {
        label: 'disallowed by the source type registry',
        rows: [targetProposal()],
        expectedField: 'proposals[0].edges[0].edgeType',
      },
    ])(
      'rejects a deferred Diagram target that is $label',
      async ({ rows, expectedField, label }) => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        } as never);
        mockPrisma.db.proposal.findMany.mockResolvedValue(rows as never);
        allowDiagramProposalEdges(
          label === 'disallowed by the source type registry'
            ? ['CONTRACT']
            : ['FEATURE'],
        );

        await expect(
          engine.assertAuthoringCandidatesValid({
            proposals: [
              createDiagramDto({
                targetEntityId: TARGET_PROPOSAL_ID,
                targetEntityType: 'PROPOSAL',
                edgeType: 'RELATED_TO',
              }),
            ],
            context: makeContext(),
          }),
        ).rejects.toMatchObject({
          response: {
            errors: expect.arrayContaining([
              expect.objectContaining({ field: expectedField }),
            ]),
          },
        });
      },
    );

    it('preserves deferred links from ordinary task proposals', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      } as never);
      mockPrisma.db.proposal.findMany.mockResolvedValue([
        targetProposal(),
      ] as never);
      const dto = makeCreateTaskDto({
        title: 'Ordinary task',
        requestorContext,
        updates: {
          name: 'Ordinary task',
          type: 'FEATURE',
          tag: 'product',
        },
        edges: [
          {
            targetEntityId: TARGET_PROPOSAL_ID,
            targetEntityType: 'PROPOSAL',
            edgeType: 'DEPENDS_ON',
          },
        ],
      });

      const admission = await engine.assertAuthoringCandidatesValid({
        proposals: [dto],
        context: makeContext(),
      });

      expect(admission.candidates[0]!.candidate.edges).toEqual(dto.edges);
      expect(mockProjector.project).not.toHaveBeenCalled();
    });

    it('shares reference evidence through admission, specialized checks and snapshots', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      } as never);
      mockPrisma.db.entityRegistry.findMany.mockResolvedValue([
        {
          entityId: testIds.task,
          entityType: 'TASK',
          entityName: 'Referenced task',
          deletedAt: null,
        },
      ] as never);
      mockPrisma.db.task.findMany.mockResolvedValue([
        {
          id: testIds.task,
          projectId: testIds.project,
          type: 'custom-evidence',
        },
      ] as never);
      const dto = makeCreateTaskDto({
        title: 'Candidate',
        requestorContext,
        updates: { name: 'Candidate', type: 'FEATURE', tag: 'product' },
        influences: [
          {
            entityId: testIds.task,
            entityType: 'TASK',
            reasonType: 'derived',
            reasoning: 'Source',
          },
        ],
        edges: [
          {
            targetEntityId: testIds.task,
            targetEntityType: 'TASK',
            edgeType: 'RELATED_TO',
          },
        ],
      });
      const references = jest.spyOn(engine as any, 'validateReferences');
      const admission = await engine.assertAuthoringCandidatesValid({
        proposals: [dto, dto],
        context: makeContext(),
      });
      for (const admitted of admission.candidates) {
        await engine.assertTaskMutationAuthoringValid(
          admitted,
          testIds.organization,
          testIds.project,
          mockPrisma.db,
        );
        expect(
          await snapshotInfluenceReferences(
            mockPrisma.db,
            testIds.organization,
            admitted.candidate.influences,
            admission.metadata,
          ),
        ).toEqual([
          expect.objectContaining({
            entityTitle: 'Referenced task',
            taskType: 'custom-evidence',
          }),
        ]);
        expect(
          await snapshotEdgeTitles(
            mockPrisma.db,
            testIds.organization,
            admitted.candidate.edges,
            admission.metadata,
          ),
        ).toEqual([
          expect.objectContaining({ targetEntityTitle: 'Referenced task' }),
        ]);
      }
      expect(references).toHaveBeenCalledTimes(2);
      expect(mockPrisma.db.entityRegistry.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.db.task.findMany).toHaveBeenCalledTimes(1);
      expect(
        mockProjector.projectPlanStageProposalCandidates,
      ).toHaveBeenCalledTimes(2);
    });

    it('keeps admitted inputs isolated and validates changed candidates again', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      } as never);
      const dto = makeCreateTaskDto({
        title: 'Candidate',
        requestorContext,
        updates: { name: 'Candidate', type: 'FEATURE', tag: 'product' },
      });
      const admission = await engine.assertAuthoringCandidatesValid({
        proposals: [dto],
        context: makeContext(),
      });
      dto.updates = {};
      const changedCopy = admission.candidates[0]!.candidate;
      changedCopy.updates = {};
      await expect(
        engine.assertTaskMutationAuthoringValid(
          changedCopy,
          testIds.organization,
          testIds.project,
          mockPrisma.db,
        ),
      ).rejects.toThrow();
      expect(admission.candidates[0]!.candidate.updates).toMatchObject({
        name: 'Candidate',
      });
      await expect(
        engine.assertTaskMutationAuthoringValid(
          admission.candidates[0]!,
          testIds.organization,
          testIds.project,
          mockPrisma.db,
        ),
      ).resolves.toBeUndefined();
      await expect(
        engine.assertAuthoringCandidatesValid({
          proposals: [dto],
          context: makeContext(),
        }),
      ).rejects.toMatchObject({
        response: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].updates.type',
              code: 'required',
            }),
          ]),
        },
      });
      await expect(
        engine.assertTaskMutationAuthoringValid(
          dto,
          testIds.organization,
          testIds.project,
          mockPrisma.db,
        ),
      ).rejects.toThrow();
    });

    it('validates tracking once and admits its normalized edge using the shared metadata', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      } as never);
      mockPrisma.db.entityRegistry.findMany.mockResolvedValue([
        {
          entityId: testIds.task,
          entityType: 'TASK',
          entityName: 'Tracking source',
          deletedAt: null,
        },
      ] as never);
      mockPrisma.db.task.findMany.mockResolvedValue([
        {
          id: testIds.task,
          projectId: testIds.project,
          type: 'GOAL',
        },
      ] as never);
      const tracking = jest
        .spyOn(engine, 'assertTrackingAttachmentValid')
        .mockResolvedValue();
      const dto = makeCreateTaskDto({
        title: 'Tracked',
        requestorContext,
        updates: { name: 'Tracked', type: 'FEATURE', tag: 'product' },
        tracks: { sourceEntityId: testIds.task },
      });
      const admission = await engine.assertAuthoringCandidatesValid({
        proposals: [dto],
        context: makeContext(),
      });
      await engine.assertTaskMutationAuthoringValid(
        admission.candidates[0]!,
        testIds.organization,
        testIds.project,
        mockPrisma.db,
      );
      expect(tracking).toHaveBeenCalledTimes(1);
      expect(admission.candidates[0]!.candidate).toMatchObject({
        tracks: undefined,
        edges: [
          expect.objectContaining({
            edgeType: 'TRACKS',
            targetEntityId: testIds.task,
          }),
        ],
      });
      expect(mockPrisma.db.task.findMany).toHaveBeenCalledTimes(1);
      await expect(
        engine.assertAuthoringCandidatesValid({
          proposals: [
            {
              ...dto,
              tracks: undefined,
              edges: admission.candidates[0]!.candidate.edges,
            },
          ],
          context: makeContext(),
        }),
      ).rejects.toMatchObject({
        response: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].edges[0].edgeType',
            }),
          ]),
        },
      });
    });

    it.each(['missing', 'deleted', 'wrong-type', 'wrong-project'] as const)(
      'rejects a %s edge with a supplied title and accepts its valid counterpart',
      async (failure) => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        } as never);
        const row = {
          entityId: testIds.task,
          entityType: 'TASK',
          entityName: 'Live',
          deletedAt: null,
        };
        mockPrisma.db.entityRegistry.findMany.mockResolvedValue(
          (failure === 'missing'
            ? []
            : [
                {
                  ...row,
                  entityType: failure === 'wrong-type' ? 'DESIGN_DOC' : 'TASK',
                  deletedAt: failure === 'deleted' ? new Date() : null,
                },
              ]) as never,
        );
        mockPrisma.db.task.findMany.mockResolvedValue([
          {
            id: testIds.task,
            type: 'STANDARD',
            projectId:
              failure === 'wrong-project' ? 'other-project' : testIds.project,
          },
        ] as never);
        const dto = makeCreateTaskDto({
          title: 'Candidate',
          requestorContext,
          updates: { name: 'Candidate', type: 'FEATURE', tag: 'product' },
          edges: [
            {
              targetEntityId: testIds.task,
              targetEntityType: 'TASK',
              targetEntityTitle: 'Supplied title',
              edgeType: 'RELATED_TO',
            },
          ],
        });
        await expect(
          engine.assertAuthoringCandidatesValid({
            proposals: [dto],
            context: makeContext(),
          }),
        ).rejects.toMatchObject({
          response: {
            errors: [
              expect.objectContaining({
                field: `proposals[0].edges[0].${failure === 'wrong-type' ? 'targetEntityType' : 'targetEntityId'}`,
                code: 'unresolved_reference',
              }),
            ],
          },
        });
        mockPrisma.db.entityRegistry.findMany.mockResolvedValue([row] as never);
        mockPrisma.db.task.findMany.mockResolvedValue([
          { id: testIds.task, type: 'STANDARD', projectId: testIds.project },
        ] as never);
        await expect(
          engine.assertAuthoringCandidatesValid({
            proposals: [dto],
            context: makeContext(),
          }),
        ).resolves.toBeDefined();
      },
    );

    it('preserves deferred proposal targets and scopes their shared lookup', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      } as never);
      mockPrisma.db.proposal.findMany.mockResolvedValue([
        { id: testIds.task },
      ] as never);
      const dto = makeCreateTaskDto({
        title: 'Deferred',
        requestorContext,
        updates: { name: 'Candidate', type: 'FEATURE', tag: 'product' },
        edges: [
          {
            targetEntityId: testIds.task,
            targetEntityType: 'PROPOSAL',
            edgeType: 'RELATED_TO',
          },
        ],
      });
      await expect(
        engine.assertAuthoringCandidatesValid({
          proposals: [dto, dto],
          context: makeContext(),
        }),
      ).resolves.toBeDefined();
      expect(mockPrisma.db.proposal.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.db.proposal.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [testIds.task] },
          organizationId: testIds.organization,
          projectId: testIds.project,
        },
        select: {
          id: true,
          title: true,
          action: true,
          status: true,
          targetEntityType: true,
          updates: true,
        },
      });
      mockPrisma.db.proposal.findMany.mockResolvedValue([]);
      await expect(
        engine.assertAuthoringCandidatesValid({
          proposals: [dto],
          context: makeContext(),
        }),
      ).rejects.toMatchObject({
        response: {
          errors: [
            expect.objectContaining({
              field: 'proposals[0].edges[0].targetEntityId',
            }),
          ],
        },
      });
    });

    it('returns structural diagnostics before trying to enrich malformed references', async () => {
      const dto = makeCreateTaskDto({
        title: 'Malformed references',
        requestorContext,
        influences: [null] as unknown as Influence[],
      });
      await expect(
        engine.assertAuthoringCandidatesValid({
          proposals: [dto],
          context: makeContext(),
        }),
      ).rejects.toMatchObject({
        response: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].influences[0]',
              layer: 'structural',
            }),
          ]),
        },
      });
      expect(mockPrisma.db.entityRegistry.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.db.task.findMany).not.toHaveBeenCalled();
    });

    it('accepts ELI5 at the contract limit and rejects longer text before persistence', () => {
      const valid = makeCreateTaskDto({
        eli5: 'x'.repeat(150),
        title: 'New task',
        requestorContext,
      });
      const invalid = makeCreateTaskDto({
        eli5: 'x'.repeat(151),
        title: 'New task',
        requestorContext,
      });

      expect(
        validateProposalStructure(valid, 0, { enforceAuthoringEnvelope: true }),
      ).toEqual([]);
      expect(
        validateProposalStructure(invalid, 0, {
          enforceAuthoringEnvelope: true,
        }),
      ).toEqual([
        expect.objectContaining({
          field: 'proposals[0].eli5',
          layer: 'structural',
        }),
      ]);
    });

    it('rejects missing ELI5 on new authoring but accepts a legacy snapshot', () => {
      const legacy: CreateProposalDto = { ...makeCreateTaskDto() };
      delete legacy.eli5;

      expect(validateProposalStructure(legacy)).toEqual([]);
      expect(
        validateProposalStructure(legacy, 0, {
          enforceAuthoringEnvelope: true,
        }),
      ).toEqual([
        expect.objectContaining({
          field: 'proposals[0].eli5',
          layer: 'structural',
        }),
      ]);
    });

    it('returns every structural issue for one candidate in stable field order', async () => {
      const dto = makeCreateTaskDto({
        title: undefined,
        requestorContext,
        updates: {},
      });

      await expect(
        engine.assertAuthoringCandidatesValid({
          proposals: [dto],
          context: {
            organizationId: testIds.organization,
            projectId: testIds.project,
            db: mockPrisma.db,
          },
        }),
      ).rejects.toMatchObject({
        response: {
          message: 'Proposal authoring validation failed',
          errors: [
            expect.objectContaining({
              field: 'proposals[0].title',
              code: 'required',
              layer: 'structural',
            }),
            expect.objectContaining({
              field: 'proposals[0].updates.name',
              code: 'required',
              layer: 'structural',
            }),
            expect.objectContaining({
              field: 'proposals[0].updates.type',
              code: 'required',
              layer: 'structural',
            }),
          ],
        },
      });
    });

    it('aggregates independently invalid batch candidates without persistence', async () => {
      const first = makeCreateTaskDto({
        title: 'First',
        requestorContext,
        updates: {},
      });
      const second = makeCreateTaskDto({
        title: undefined,
        requestorContext,
      });

      await expect(
        engine.assertAuthoringCandidatesValid({
          proposals: [first, second],
          context: {
            organizationId: testIds.organization,
            projectId: testIds.project,
            db: mockPrisma.db,
          },
        }),
      ).rejects.toMatchObject({
        response: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].updates.name',
            }),
            expect.objectContaining({ field: 'proposals[1].title' }),
          ]),
        },
      });
      expect(mockPrisma.db.proposal.create).not.toHaveBeenCalled();
      expect(mockPrisma.db.message.create).not.toHaveBeenCalled();
    });

    it('accepts built-in and project-defined TASK subtype influences', () => {
      const influences = [
        {
          entityId: testIds.task,
          entityType: 'TASK',
          taskType: 'PLAN',
          reasoning: 'The plan establishes the implementation sequence.',
          reasonType: 'derived',
        },
        {
          entityId: testIds.task,
          entityType: 'TASK',
          taskType: 'project_defined_subtype',
          reasoning:
            'The project-defined work item supplies implementation context.',
          reasonType: 'implied',
        },
      ] satisfies Influence[];
      const dto = makeUpdateTaskDto({
        requestorContext,
        influences,
      });

      expect(
        validateProposalStructure(dto, 0, {
          enforceAuthoringEnvelope: true,
        }),
      ).toEqual([]);
    });
  });

  describe('TASK mutation authoring assertion', () => {
    function makeTransactionDb() {
      const transactionPrisma = mockPrismaWithValidationSession();
      transactionPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      transactionPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });
      transactionPrisma.db.task.findFirst.mockResolvedValue({
        id: testIds.task,
        type: 'FEATURE',
      });
      return transactionPrisma.db;
    }

    it('rejects task type changes before proposal persistence', async () => {
      const tx = makeTransactionDb();

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeUpdateTaskDto({ updates: { type: 'STANDARD' } }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toThrow('Task type cannot be changed after creation.');
    });

    it('accepts a minimal STANDARD create without an initiative', async () => {
      const tx = makeTransactionDb();

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Minimal task',
              type: 'STANDARD',
              parentTaskId: testIds.task,
              sections: [
                { key: 'description', content: 'Implementation notes' },
                { key: 'acceptanceCriteria', content: 'The task exists.' },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();
    });

    it('accepts a CONTRACT beneath a FEATURE before proposal persistence', async () => {
      const tx = makeTransactionDb();

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Feature agreement',
              type: 'CONTRACT',
              parentTaskId: testIds.task,
              sections: [
                {
                  key: 'description',
                  content: 'The provider guarantees the agreed result.',
                },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();
      expect(tx.proposal.create).not.toHaveBeenCalled();
    });

    it('rejects a CONTRACT beneath an undeclared parent before proposal persistence', async () => {
      const tx = makeTransactionDb();
      tx.task.findFirst.mockResolvedValue({
        id: testIds.task,
        type: 'workflow_step',
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Misplaced agreement',
              type: 'CONTRACT',
              parentTaskId: testIds.task,
              sections: [
                {
                  key: 'description',
                  content: 'The provider guarantees the agreed result.',
                },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toMatchObject({
        response: {
          message: 'Proposal contains invalid work-item updates',
          errors: expect.arrayContaining([
            expect.objectContaining({
              code: 'invalid_placement',
              field: 'proposals[0].updates.parentTaskId',
              reason:
                'A workflow_step item cannot parent a CONTRACT item under the configured work-item type definitions.',
            }),
          ]),
        },
      });
      expect(tx.proposal.create).not.toHaveBeenCalled();
    });

    it('rejects a PLAN_STAGE dependency on an ordinary Task before proposal persistence', async () => {
      mockProjector.projectPlanStageProposalCandidates.mockResolvedValueOnce([
        {
          field: 'relationships.temporary:edge-0',
          code: 'plan_stage_reference_outside_plan',
          reason:
            'A Plan Stage dependency must target another PLAN_STAGE under the same Plan.',
          layer: 'referential',
        },
      ]);
      const tx = makeTransactionDb();
      tx.task.findFirst.mockImplementation(({ where }: any) => {
        if (where.id === testIds.plan) {
          return Promise.resolve({
            id: testIds.plan,
            type: 'PLAN',
            parentTaskId: null,
          });
        }
        if (where.id === testIds.task) {
          return Promise.resolve({
            id: testIds.task,
            type: 'STANDARD',
            parentTaskId: testIds.planStage,
          });
        }
        return Promise.resolve(null);
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Generated stage',
              type: 'PLAN_STAGE',
              parentTaskId: testIds.plan,
            },
            edges: [
              {
                targetEntityId: testIds.task,
                targetEntityType: 'TASK',
                edgeType: 'DEPENDS_ON',
              },
            ],
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({
              code: 'plan_stage_reference_outside_plan',
              field: 'relationships.temporary:edge-0',
              layer: 'referential',
            }),
          ]),
        }),
      });
    });

    it('accepts a PLAN_STAGE dependency on a Stage with the same Plan parent', async () => {
      const tx = makeTransactionDb();
      tx.task.findFirst.mockImplementation(({ where }: any) => {
        if (where.id === testIds.plan) {
          return Promise.resolve({
            id: testIds.plan,
            type: 'PLAN',
            parentTaskId: null,
          });
        }
        if (where.id === testIds.planStage) {
          return Promise.resolve({
            id: testIds.planStage,
            type: 'PLAN_STAGE',
            parentTaskId: testIds.plan,
          });
        }
        return Promise.resolve(null);
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Generated stage',
              type: 'PLAN_STAGE',
              parentTaskId: testIds.plan,
            },
            edges: [
              {
                targetEntityId: testIds.planStage,
                targetEntityType: 'TASK',
                edgeType: 'DEPENDS_ON',
              },
            ],
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();
    });

    it('rejects a PLAN_STAGE dependency on a Stage under another Plan', async () => {
      mockProjector.projectPlanStageProposalCandidates.mockResolvedValueOnce([
        {
          field: 'relationships.temporary:edge-0',
          code: 'plan_stage_reference_outside_plan',
          reason:
            'A Plan Stage dependency must target another PLAN_STAGE under the same Plan.',
          layer: 'referential',
        },
      ]);
      const otherPlanId = '88888888-8888-4888-8888-888888888888';
      const tx = makeTransactionDb();
      tx.task.findFirst.mockImplementation(({ where }: any) => {
        if (where.id === testIds.plan) {
          return Promise.resolve({
            id: testIds.plan,
            type: 'PLAN',
            parentTaskId: null,
          });
        }
        if (where.id === testIds.planStage) {
          return Promise.resolve({
            id: testIds.planStage,
            type: 'PLAN_STAGE',
            parentTaskId: otherPlanId,
          });
        }
        return Promise.resolve(null);
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Generated stage',
              type: 'PLAN_STAGE',
              parentTaskId: testIds.plan,
            },
            edges: [
              {
                targetEntityId: testIds.planStage,
                targetEntityType: 'TASK',
                edgeType: 'DEPENDS_ON',
              },
            ],
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({
              code: 'plan_stage_reference_outside_plan',
            }),
          ]),
        }),
      });
    });

    it('validates proposal-target Stage dependencies before group materialization', async () => {
      const tx = makeTransactionDb();
      tx.task.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === testIds.plan
            ? { id: testIds.plan, type: 'PLAN', parentTaskId: null }
            : null,
        ),
      );
      (tx as any).proposal = {
        findFirst: jest.fn().mockResolvedValue({
          updates: {
            name: 'Earlier stage',
            type: 'PLAN_STAGE',
            parentTaskId: testIds.plan,
          },
        }),
      };

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Generated stage',
              type: 'PLAN_STAGE',
              parentTaskId: testIds.plan,
            },
            edges: [
              {
                targetEntityId: '99999999-9999-4999-8999-999999999999',
                targetEntityType: 'PROPOSAL',
                edgeType: 'DEPENDS_ON',
              },
            ],
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();
    });

    it('validates proposal edges against the generated OpenAPI shape', () => {
      expect(() =>
        assertProposalStructurallyValid(
          makeCreateTaskDto({
            edges: [
              {
                targetEntityId: 'not-a-uuid',
                targetEntityType: 'TASK',
                edgeType: 'DEPENDS_ON',
              },
            ],
          }),
        ),
      ).toThrow('Proposal violates the OpenAPI structural contract');
    });

    it('accepts a FEATURE create with grouped and ungrouped requirements', async () => {
      const tx = makeTransactionDb();

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Grouped feature',
              initiativeId: testIds.initiative,
              type: 'FEATURE',
              tag: 'product',
              initialRequirements: [
                { statement: 'The system does X', group: 'Access control' },
                { statement: 'The system does Y', group: 'Access control' },
                { statement: 'The system does Z' },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();
    });

    it('accepts a FEATURE create when all large-collection requirements share one group', async () => {
      const tx = makeTransactionDb();

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Grouped feature',
              initiativeId: testIds.initiative,
              type: 'FEATURE',
              tag: 'product',
              initialRequirements: [
                { statement: 'The system does X', group: 'Access control' },
                { statement: 'The system does Y', group: 'Access control' },
                { statement: 'The system does Z', group: 'Access control' },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();
    });

    it('validates the resulting collection for partial requirement edits', async () => {
      const tx = makeTransactionDb();
      (tx as any).taskSection.findFirst.mockResolvedValue({
        materializedMarkdown: JSON.stringify({
          records: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              statement: 'The system does X',
              designedBy: [],
              fulfilledBy: [],
              contracts: [],
            },
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              statement: 'The system does Y',
              designedBy: [],
              fulfilledBy: [],
              contracts: [],
            },
          ],
        }),
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeUpdateTaskDto({
            updates: {
              requirementOps: [
                { op: 'add', value: { statement: 'The system does Z' } },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();

      (tx as any).taskSection.findFirst.mockResolvedValue({
        materializedMarkdown: JSON.stringify({
          records: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              statement: 'The system does X',
              designedBy: [],
              fulfilledBy: [],
              contracts: [],
            },
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              statement: 'The system does Y',
              group: 'Access control',
              designedBy: [],
              fulfilledBy: [],
              contracts: [],
            },
            {
              id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              statement: 'The system does Z',
              group: 'Access control',
              designedBy: [],
              fulfilledBy: [],
              contracts: [],
            },
          ],
        }),
      });
      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeUpdateTaskDto({
            updates: {
              requirementOps: [
                {
                  op: 'update',
                  targetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                  group: 'Access control',
                },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();
    });

    it('preserves malformed requirementOps for structural validation', async () => {
      const tx = makeTransactionDb();
      const dto = makeUpdateTaskDto({
        updates: { requirementOps: null } as any,
      });

      await expect(
        engine.prepareTaskMutationRequirements(
          dto,
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBe(dto);

      await expect(
        engine.assertTaskMutationAuthoringValid(
          dto,
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toMatchObject({
        response: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].updates.requirementOps',
              layer: 'structural',
            }),
          ]),
        },
      });
    });

    it('preserves malformed sections while preparing requirements', async () => {
      const tx = makeTransactionDb();
      const createDto = makeCreateTaskDto({
        updates: {
          name: 'Malformed sections',
          type: 'FEATURE',
          tag: 'product',
          initialRequirements: [{ statement: 'The system does X' }],
          sections: null,
        } as any,
      });

      await expect(
        engine.prepareTaskMutationRequirements(
          createDto,
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBe(createDto);

      await expect(
        engine.assertTaskMutationAuthoringValid(
          createDto,
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toMatchObject({
        response: {
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].updates.sections',
              layer: 'structural',
            }),
          ]),
        },
      });
    });

    it('allows an edit to produce a smaller requirements collection', async () => {
      const tx = makeTransactionDb();
      (tx as any).taskSection.findFirst.mockResolvedValue({
        materializedMarkdown: JSON.stringify({
          records: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              statement: 'The system does X',
              designedBy: [],
              fulfilledBy: [],
              contracts: [],
            },
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              statement: 'The system does Y',
              designedBy: [],
              fulfilledBy: [],
              contracts: [],
            },
            {
              id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              statement: 'The system does Z',
              designedBy: [],
              fulfilledBy: [],
              contracts: [],
            },
          ],
        }),
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeUpdateTaskDto({
            updates: {
              requirementOps: [
                {
                  op: 'delete',
                  targetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();
    });

    it('rejects a TASK CREATE without an explicit type', async () => {
      const tx = makeTransactionDb();

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'Documented task',
              initiativeId: testIds.initiative,
              parentTaskId: testIds.task,
              sections: [
                { key: 'description', content: 'Implementation notes' },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({
              code: 'required',
              field: 'proposals[0].updates.type',
              layer: 'structural',
            }),
          ]),
        }),
      });
    });

    it('accepts valid schema-backed JSON and rejects invalid content before persistence', async () => {
      const tx = makeTransactionDb();
      const registry = (
        engine as unknown as {
          workItemTypeRegistry: {
            isParentRequired: (type: string, projectId: string) => boolean;
          };
        }
      ).workItemTypeRegistry;
      const isParentRequired = registry.isParentRequired.bind(registry);
      jest
        .spyOn(registry, 'isParentRequired')
        .mockImplementation((type, projectId) =>
          type === 'TASK_MONITOR' ? false : isParentRequired(type, projectId),
        );
      const validDto = makeCreateTaskDto({
        updates: {
          name: 'Monitor',
          initiativeId: testIds.initiative,
          type: 'TASK_MONITOR',
          sections: [
            {
              key: 'executionDefinition',
              content: VALID_TASK_MONITOR_EXECUTION_DEFINITION,
            },
          ],
        },
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          validDto,
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();

      const { executionPlan: _executionPlan, ...invalidDefinition } =
        VALID_TASK_MONITOR_EXECUTION_DEFINITION;
      await expect(
        engine.assertTaskMutationAuthoringValid(
          {
            ...validDto,
            updates: {
              ...(validDto.updates as Record<string, unknown>),
              sections: [
                { key: 'executionDefinition', content: invalidDefinition },
              ],
            },
          },
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({ code: 'invalid_json_section' }),
          ]),
        }),
      });
    });

    it('resolves UPDATE type and all referential reads through the supplied transaction', async () => {
      const tx = makeTransactionDb();
      tx.task.findFirst.mockResolvedValue({
        id: testIds.task,
        type: 'TASK_MONITOR',
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeUpdateTaskDto({
            updates: {
              sections: [
                {
                  key: 'executionDefinition',
                  content: VALID_TASK_MONITOR_EXECUTION_DEFINITION,
                },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();

      expect(tx.project.findFirst).toHaveBeenCalled();
      expect(tx.task.findFirst).toHaveBeenCalled();
      expect(mockPrisma.db.project.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.db.task.findFirst).not.toHaveBeenCalled();
    });

    it('validates UPDATE sections against the current target type', async () => {
      const tx = makeTransactionDb();
      tx.task.findFirst.mockResolvedValue({
        id: testIds.task,
        type: 'FEATURE',
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeUpdateTaskDto({
            updates: {
              sections: [
                {
                  key: 'acceptanceCriteria',
                  content: 'Only STANDARD declares this section.',
                },
              ],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({
              code: 'invalid_section',
              field: 'proposals[0].updates.sections[0].key',
            }),
          ]),
        }),
      });
    });

    it('routes graph updates through the shared OpenAPI-aligned change-set schema', async () => {
      const tx = makeTransactionDb();

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeUpdateTaskDto({
            updates: {
              root: { refType: 'existing', id: testIds.task },
              operations: [
                {
                  op: 'workItem.update',
                  ref: { refType: 'existing', id: testIds.task },
                  parent: null,
                  status: 'READY',
                },
              ],
              layoutBoundary: [{ refType: 'existing', id: testIds.task }],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeUpdateTaskDto({
            updates: {
              root: { refType: 'existing', id: 'not-a-uuid' },
              operations: [],
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({
              field: 'updates.root.id',
              layer: 'structural',
            }),
          ]),
        }),
      });
    });

    it('accepts a grouped TASK create through the generated change-set contract', () => {
      const root = { refType: 'temporary' as const, tempId: 'root' };
      expect(() =>
        assertProposalStructurallyValid(
          makeCreateTaskDto({
            targetEntityId: testIds.task,
            title: 'Implementation task',
            updates: {
              root,
              operations: [
                {
                  op: 'workItem.create',
                  ref: root,
                  name: 'Implementation task',
                  type: 'STANDARD',
                  parent: { refType: 'existing', id: testIds.planStage },
                  serviceIds: ['22222222-2222-4222-8222-222222222222'],
                },
              ],
            },
          }),
        ),
      ).not.toThrow();
    });

    it('does not evaluate permission warnings as authoring blockers', async () => {
      const tx = makeTransactionDb();
      const permissionSpy = jest.spyOn(engine as any, 'validatePermissions');

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateTaskDto({
            updates: {
              name: 'New task',
              initiativeId: testIds.initiative,
              parentTaskId: testIds.task,
              type: 'STANDARD',
            },
          }),
          testIds.organization,
          testIds.project,
          tx,
        ),
      ).resolves.toBeUndefined();

      expect(permissionSpy).not.toHaveBeenCalled();
    });
  });

  describe('WORK_ITEM_TYPE mutation authoring assertion', () => {
    it('rejects unknown parent keys before proposal persistence', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });

      await expect(
        engine.assertTaskMutationAuthoringValid(
          makeCreateWorkItemTypeDto({
            allowedParentTypes: ['UNKNOWN_PARENT'],
            allowedParentEntityTypes: [EntityType.Task],
          }),
          testIds.organization,
          testIds.project,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({ code: 'unrecognized_type' }),
          ]),
        }),
      });
    });
  });

  describe('complete work-item service scope', () => {
    const serviceA = '11111111-1111-4111-8111-111111111111';
    const serviceB = '22222222-2222-4222-8222-222222222222';

    beforeEach(() => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({
        id: testIds.task,
        type: 'STANDARD',
      });
      (mockPrisma.db as any).taskSection.findFirst.mockResolvedValue(null);
    });

    it('accepts omitted, single-service, multi-service, and known-empty create assertions', async () => {
      for (const serviceIds of [
        undefined,
        [serviceA],
        [serviceA, serviceB],
        [],
      ]) {
        mockPrisma.db.service.findMany.mockResolvedValue(
          (serviceIds ?? []).map((id) => ({ id })),
        );
        const updates: Record<string, unknown> = {
          name: 'Scoped task',
          initiativeId: testIds.initiative,
          type: 'STANDARD',
          parentTaskId: testIds.task,
        };
        if (serviceIds !== undefined) updates.serviceIds = serviceIds;
        const result = await engine.validate({
          proposals: [makeCreateTaskDto({ updates })],
          context: makeContext(),
        });
        expect(result.valid).toBe(true);
      }
    });

    it('accepts duplicate Service IDs without a validation failure', async () => {
      mockPrisma.db.service.findMany.mockResolvedValue([{ id: serviceA }]);
      const result = await engine.validate({
        proposals: [
          makeCreateTaskDto({
            updates: {
              name: 'Scoped task',
              initiativeId: testIds.initiative,
              type: 'STANDARD',
              parentTaskId: testIds.task,
              serviceIds: [serviceA, serviceA],
            },
          }),
        ],
        context: makeContext(),
      });
      expect(result.valid).toBe(true);
      expect(result.proposals[0]!.errors).toEqual([]);
    });

    it('rejects foreign-project and incomplete mentioned service sets', async () => {
      mockPrisma.db.service.findMany.mockResolvedValue([{ id: serviceA }]);
      const cases = [
        { serviceIds: [serviceB], code: 'entity_not_found' },
        {
          serviceIds: [serviceA],
          sections: [
            {
              key: 'description',
              content: `Changes @[service:${serviceB}|Other]`,
            },
          ],
          code: 'incomplete_service_scope',
        },
      ];
      for (const testCase of cases) {
        const result = await engine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'Scoped task',
                initiativeId: testIds.initiative,
                type: 'STANDARD',
                parentTaskId: testIds.task,
                serviceIds: testCase.serviceIds,
                ...(testCase.sections ? { sections: testCase.sections } : {}),
              },
            }),
          ],
          context: makeContext(),
        });
        expect(
          result.proposals[0]!.errors.some(
            (issue) => issue.code === testCase.code,
          ),
        ).toBe(true);
      }
    });

    it('treats omitted edit as preservation and validates supplied replacements', async () => {
      const omitted = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext(),
      });
      expect(omitted.valid).toBe(true);

      mockPrisma.db.service.findMany.mockResolvedValue([{ id: serviceA }]);
      const supplied = await engine.validate({
        proposals: [makeUpdateTaskDto({ updates: { serviceIds: [serviceA] } })],
        context: makeContext(),
      });
      expect(supplied.valid).toBe(true);
    });

    it('uses the immutable target type when validating serviceIds on edits', async () => {
      mockPrisma.db.service.findMany.mockResolvedValue([{ id: serviceA }]);
      mockPrisma.db.task.findFirst.mockResolvedValue({
        id: testIds.task,
        type: 'BUG',
      });

      const bugWithServices = await engine.validate({
        proposals: [
          makeUpdateTaskDto({
            updates: { type: 'STANDARD', serviceIds: [serviceA] },
          }),
        ],
        context: makeContext(),
      });
      expect(bugWithServices.valid).toBe(true);
      expect(bugWithServices.proposals[0]!.errors).toEqual([]);

      mockPrisma.db.task.findFirst.mockResolvedValue({
        id: testIds.task,
        type: 'STANDARD',
      });
      const standardWithServices = await engine.validate({
        proposals: [
          makeUpdateTaskDto({
            updates: { type: 'BUG', serviceIds: [serviceA] },
          }),
        ],
        context: makeContext(),
      });
      expect(
        standardWithServices.proposals[0]!.errors.some((issue) =>
          issue.field.endsWith('.updates.serviceIds'),
        ),
      ).toBe(false);
    });

    it('accepts a project-defined work-item role and rejects a project-info role', async () => {
      const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
        {
          typeKey: 'CUSTOM_WORK_ITEM',
          projectId: testIds.project,
          role: 'work-item',
        },
      ]);
      (engine as any).workItemTypeRegistry = registry;
      (engine as any).workItemParentageValidator.workItemTypeRegistry =
        registry;
      mockPrisma.db.service.findMany.mockResolvedValue([{ id: serviceA }]);

      const custom = await engine.validate({
        proposals: [
          makeCreateTaskDto({
            updates: {
              name: 'Custom work item',
              initiativeId: testIds.initiative,
              type: 'CUSTOM_WORK_ITEM',
              serviceIds: [serviceA],
            },
          }),
        ],
        context: makeContext(),
      });
      expect(custom.valid).toBe(true);

      const projectInfo = await engine.validate({
        proposals: [
          makeCreateTaskDto({
            updates: {
              name: 'Product feature',
              initiativeId: testIds.initiative,
              type: 'FEATURE',
              tag: 'product',
              serviceIds: [serviceA],
            },
          }),
        ],
        context: makeContext(),
      });
      expect(projectInfo.proposals[0]!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'invalid_field',
            field: expect.stringMatching(/serviceIds$/),
            reason: expect.stringContaining('registry role'),
          }),
        ]),
      );
    });

    it('checks a supplied edit replacement against the persisted folded description', async () => {
      mockPrisma.db.service.findMany.mockResolvedValue([{ id: serviceA }]);
      (mockPrisma.db as any).taskSection.findFirst.mockResolvedValue({
        materializedMarkdown: `Implementation uses @[service:${serviceB}|Other]`,
      });
      const result = await engine.validate({
        proposals: [makeUpdateTaskDto({ updates: { serviceIds: [serviceA] } })],
        context: makeContext(),
      });
      expect(
        result.proposals[0]!.errors.some(
          (issue) => issue.code === 'incomplete_service_scope',
        ),
      ).toBe(true);
    });
  });

  // ── Structural validation ─────────────────────────────────────

  describe('structural validation', () => {
    it('should pass a valid UPDATE/TASK proposal', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
      expect(result.proposals[0]!.errors).toHaveLength(0);
    });

    it('should pass a valid CREATE/TASK proposal', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });

      const result = await engine.validate({
        proposals: [
          makeCreateTaskDto({
            updates: {
              name: 'New feature',
              initiativeId: testIds.initiative,
              type: 'FEATURE',
              tag: 'product',
            },
          }),
        ],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
    });

    it('rejects CREATE/TASK config when the effective type policy does not accept it', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });

      const result = await engine.validate({
        proposals: [
          makeCreateTaskDto({
            updates: {
              name: 'Configured feature',
              initiativeId: testIds.initiative,
              type: 'FEATURE',
              tag: 'product',
              config: {
                kind: 'INITIAL_WORKTREE',
                version: 'v1',
                initialWorktreeBranch: 'feature/not-accepted',
              },
            },
          }),
        ],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(result.proposals[0]!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: expect.stringContaining('updates.config'),
            code: 'invalid_config',
          }),
        ]),
      );
    });

    it('passes a workflow CREATE proposal with embedded steps and links', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });
      mockPrisma.db.task.findMany.mockResolvedValue([{ id: testIds.task }]);

      const dto = makeCreateTaskDto({
        updates: {
          name: 'Review workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          sections: [{ key: 'description', content: 'Review steps.' }],
          workflowSteps: [
            {
              tempId: 'draft',
              name: 'Draft',
              sections: [{ key: 'description', content: 'Draft it.' }],
            },
            {
              tempId: 'approve',
              name: 'Approve',
              sections: [{ key: 'description', content: 'Approve it.' }],
            },
          ],
          workflowLinks: [
            {
              sourceStepTempId: 'draft',
              targetStepTempId: 'approve',
              type: 'STANDARD',
              direction: 'forward',
            },
            {
              sourceStepTempId: 'approve',
              type: 'FULFILLED_BY',
              targetTaskId: testIds.task,
            },
          ],
        },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
      expect(result.proposals[0]!.errors).toHaveLength(0);
    });

    it('rejects workflow links that reference a missing proposed step', async () => {
      const dto = makeCreateTaskDto({
        updates: {
          name: 'Broken workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          workflowSteps: [{ tempId: 'draft', name: 'Draft' }],
          workflowLinks: [
            {
              sourceStepTempId: 'draft',
              targetStepTempId: 'missing',
              type: 'STANDARD',
              direction: 'forward',
            },
          ],
        },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(result.proposals[0]!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'proposals[0].updates.workflowLinks[0].targetStepTempId',
            reason: "Unknown workflow step tempId 'missing'",
          }),
        ]),
      );
    });

    it('rejects LOOP direction while allowing its predicate and reports a missing CONDITIONAL predicate', async () => {
      const dto = makeCreateTaskDto({
        updates: {
          name: 'Broken workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          workflowSteps: [
            { tempId: 'decision', name: 'Decision' },
            { tempId: 'done', name: 'Done' },
          ],
          workflowLinks: [
            {
              sourceStepTempId: 'decision',
              targetStepTempId: 'done',
              type: 'CONDITIONAL',
              direction: 'forward',
            },
            {
              sourceStepTempId: 'done',
              type: 'LOOP',
              direction: 'backward',
              predicate: 'again',
            },
          ],
        },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(result.proposals[0]!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'proposals[0].updates.workflowLinks[0].predicate',
            code: 'required',
          }),
          expect.objectContaining({
            field: 'proposals[0].updates.workflowLinks[1]',
            code: 'unrecognized_keys',
            reason: "Unrecognized key(s) in object: 'direction'",
          }),
        ]),
      );
    });

    it('accepts a workflow LOOP link with a portable predicate', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });
      const dto = makeCreateTaskDto({
        updates: {
          name: 'Retry workflow',
          initiativeId: testIds.initiative,
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
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
      expect(result.proposals[0]!.errors).toEqual([]);
    });

    it('rejects FULFILLED_BY targets that do not exist', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });
      mockPrisma.db.task.findMany.mockResolvedValue([]);

      const dto = makeCreateTaskDto({
        updates: {
          name: 'Review workflow',
          initiativeId: testIds.initiative,
          type: 'workflow',
          workflowSteps: [{ tempId: 'draft', name: 'Draft' }],
          workflowLinks: [
            {
              sourceStepTempId: 'draft',
              type: 'FULFILLED_BY',
              targetTaskId: testIds.task,
            },
          ],
        },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(result.proposals[0]!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'proposals[0].updates.workflowLinks',
            code: 'entity_not_found',
            reason: `FULFILLED_BY target task ${testIds.task} was not found in this project`,
          }),
        ]),
      );
    });

    it('should pass a valid DELETE/TASK proposal', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const result = await engine.validate({
        proposals: [makeDeleteTaskDto()],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
    });

    it('should fail when type is invalid', async () => {
      const dto = makeUpdateTaskDto({ type: 'INVALID' as any });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      const errors = result.proposals[0]!.errors;
      expect(errors.some((e) => e.field.includes('type'))).toBe(true);
      expect(errors[0]!.layer).toBe('structural');
    });

    it('should fail when action is invalid', async () => {
      const dto = makeUpdateTaskDto({ action: 'MERGE' as any });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some((e) => e.field.includes('action')),
      ).toBe(true);
    });

    it('should fail when targetEntityType is invalid', async () => {
      const dto = makeUpdateTaskDto({ targetEntityType: 'SERVICE' as any });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some((e) =>
          e.field.includes('targetEntityType'),
        ),
      ).toBe(true);
    });

    it('should fail when UPDATE/TASK has no update fields', async () => {
      const dto = makeUpdateTaskDto({ updates: {} });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some((e) => e.field.includes('updates')),
      ).toBe(true);
    });

    it('reports a missing generic CONDITIONAL predicate at its request field', async () => {
      const root = { refType: 'existing', id: testIds.task } as const;
      const dto = makeUpdateTaskDto({
        updates: {
          root,
          operations: [
            {
              op: 'relationship.create',
              ref: { refType: 'temporary', tempId: 'branch' },
              source: root,
              target: root,
              edgeType: 'CONDITIONAL',
              category: 'flow',
              direction: 'forward',
            },
          ],
        },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.proposals[0]!.errors).toContainEqual(
        expect.objectContaining({
          field: 'proposals[0].updates.operations[0].predicate',
          code: 'required',
        }),
      );
    });

    it('should pass when UPDATE/TASK has only edge declarations', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });
      const dto = makeUpdateTaskDto({
        updates: {},
        edges: [
          {
            targetEntityId: '00000000-0000-4000-8000-000000000020',
            targetEntityType: 'TASK',
            edgeType: 'SUPERSEDES',
          },
        ],
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
    });

    it('rejects a status edit to SUPERSEDED with no SUPERSEDES edge', async () => {
      const dto = makeUpdateTaskDto({ updates: { status: 'SUPERSEDED' } });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      const issue = result.proposals[0]!.errors.find((e) =>
        e.field.includes('updates.status'),
      );
      expect(issue).toBeDefined();
      expect(issue!.code).toBe('forbidden_status');
      expect(issue!.suggestion).toContain('supersede transition');
    });

    it('passes a SUPERSEDED status edit paired with a SUPERSEDES edge', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const dto = makeUpdateTaskDto({
        updates: { status: 'SUPERSEDED' },
        edges: [
          {
            targetEntityId: '00000000-0000-4000-8000-000000000020',
            targetEntityType: 'TASK',
            edgeType: 'SUPERSEDES',
          },
        ],
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      // The co-presence guard must not flag a well-formed supersede proposal.
      const supersedeIssue = result.proposals[0]!.errors.find(
        (e) =>
          e.code === 'forbidden_status' ||
          e.code === 'orphan_supersedes_edge' ||
          e.code === 'ambiguous_successor',
      );
      expect(supersedeIssue).toBeUndefined();
    });

    it('allows a SUPERSEDES edge declared without a SUPERSEDED status change', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const dto = makeUpdateTaskDto({
        updates: { name: 'Renamed task' },
        edges: [
          {
            targetEntityId: '00000000-0000-4000-8000-000000000020',
            targetEntityType: 'TASK',
            edgeType: 'SUPERSEDES',
          },
        ],
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
      const issue = result.proposals[0]!.errors.find(
        (e) => e.code === 'orphan_supersedes_edge',
      );
      expect(issue).toBeUndefined();
    });

    it('should fail when CREATE/TASK is missing required name', async () => {
      const dto = makeCreateTaskDto({
        updates: { initiativeId: testIds.initiative },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some(
          (e) => e.field.includes('name') && e.code === 'required',
        ),
      ).toBe(true);
    });

    it('CREATE/FEATURE proposal: requires tag', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });

      const dto = makeCreateTaskDto({
        updates: {
          name: 'New feature',
          initiativeId: testIds.initiative,
          type: 'FEATURE',
        },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      const errors = result.proposals[0]!.errors;
      expect(
        errors.some((e) => e.field.includes('tag') && e.layer === 'structural'),
      ).toBe(true);
    });

    it('CREATE/FEATURE proposal: passes when tag is provided', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });

      const dto = makeCreateTaskDto({
        updates: {
          name: 'New feature',
          initiativeId: testIds.initiative,
          type: 'FEATURE',
          tag: 'backend',
        },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
    });

    it('CREATE/non-FEATURE proposal: forbids tag', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });

      const dto = makeCreateTaskDto({
        updates: {
          name: 'New task',
          initiativeId: testIds.initiative,
          type: 'STANDARD',
          tag: 'backend',
        },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      const errors = result.proposals[0]!.errors;
      expect(
        errors.some((e) => e.field.includes('tag') && e.layer === 'structural'),
      ).toBe(true);
    });

    it('CREATE/FEATURE proposal: rejects unknown tag values with invalid_enum', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });

      const dto = makeCreateTaskDto({
        updates: {
          name: 'New feature',
          initiativeId: testIds.initiative,
          type: 'FEATURE',
          tag: 'invalid-bucket',
        },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      const errors = result.proposals[0]!.errors;
      expect(
        errors.some(
          (e) => e.field.includes('tag') && e.code === 'invalid_enum',
        ),
      ).toBe(true);
    });

    it('UPDATE/TASK proposal: accepts tag (FEATURE-only check happens at the service)', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const dto = makeUpdateTaskDto({
        updates: { tag: 'frontend' },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
    });

    it('should fail when targetEntityId is not UUID for UPDATE', async () => {
      const dto = makeUpdateTaskDto({ targetEntityId: 'not-a-uuid' });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some((e) => e.code === 'invalid_format'),
      ).toBe(true);
    });

    it('should pass DESIGN_DOC UPDATE with valid updates', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.designDoc.findFirst.mockResolvedValue({
        id: testIds.designDoc,
      });

      const dto: CreateProposalDto = {
        type: 'SINGLE',
        action: 'UPDATE',
        targetEntityId: testIds.designDoc,
        targetEntityType: 'DESIGN_DOC',
        updates: { name: 'New title' },
      };

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
    });

    it('should include suggestions in structural errors', async () => {
      const dto = makeCreateTaskDto({
        updates: { initiativeId: testIds.initiative },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      const nameError = result.proposals[0]!.errors.find((e) =>
        e.field.includes('name'),
      );
      expect(nameError?.suggestion).toBeDefined();
    });
  });

  // ── Referential integrity ─────────────────────────────────────

  describe('referential integrity', () => {
    it('should fail when project does not exist', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue(null);

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some((e) => e.code === 'project_not_found'),
      ).toBe(true);
    });

    it('should fail when target task does not exist', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue(null);

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some(
          (e) => e.code === 'entity_not_found' && e.layer === 'referential',
        ),
      ).toBe(true);
    });

    it('accepts an unmaterialized target only through explicit group context', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue(null);

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext({
          group: {
            groupId: '10000000-0000-4000-8000-000000000001',
            reservedEntities: [
              {
                entityId: testIds.task,
                entityType: 'TASK',
                workItemType: 'STANDARD',
              },
            ],
          },
        }),
      });

      expect(
        result.proposals[0]!.errors.some(
          (error) =>
            error.code === 'entity_not_found' &&
            error.field.includes('targetEntityId'),
        ),
      ).toBe(false);
    });

    it('keeps ordinary validation unchanged without group context', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue(null);

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext(),
      });

      expect(
        result.proposals[0]!.errors.some(
          (error) =>
            error.code === 'entity_not_found' &&
            error.field.includes('targetEntityId'),
        ),
      ).toBe(true);
    });

    it('should fail when target design doc does not exist', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.designDoc.findFirst.mockResolvedValue(null);

      const dto: CreateProposalDto = {
        type: 'SINGLE',
        action: 'UPDATE',
        targetEntityId: testIds.designDoc,
        targetEntityType: 'DESIGN_DOC',
        updates: { name: 'X' },
      };

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some(
          (e) =>
            e.code === 'entity_not_found' && e.field.includes('targetEntityId'),
        ),
      ).toBe(true);
    });

    it('should skip entity existence check for CREATE action', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.initiative.findFirst.mockResolvedValue({
        id: testIds.initiative,
      });

      const result = await engine.validate({
        proposals: [
          makeCreateTaskDto({
            updates: {
              name: 'New feature',
              initiativeId: testIds.initiative,
              type: 'FEATURE',
              tag: 'product',
            },
          }),
        ],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
      // task.findFirst should not be called for the target entity
      expect(mockPrisma.db.task.findFirst).not.toHaveBeenCalled();
    });

    it('should fail when conversationId does not exist', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });
      mockPrisma.db.conversation.findFirst.mockResolvedValue(null);

      const dto = makeUpdateTaskDto({
        conversationId: testIds.conversation,
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some(
          (e) =>
            e.code === 'entity_not_found' && e.field.includes('conversationId'),
        ),
      ).toBe(true);
    });

    it('should fail when assigneeId user does not exist', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });
      mockPrisma.db.user.findFirst.mockResolvedValue(null);

      const dto = makeUpdateTaskDto({
        updates: { name: 'X', assigneeId: testIds.user },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some(
          (e) =>
            e.code === 'entity_not_found' && e.field.includes('assigneeId'),
        ),
      ).toBe(true);
    });

    it('should fail when parentTaskId does not exist', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      // First call for target entity, second for parent task
      mockPrisma.db.task.findFirst
        .mockResolvedValueOnce({ id: testIds.task })
        .mockResolvedValueOnce(null);

      const parentId = '123e4567-e89b-42d3-a456-426614174099';
      const dto = makeUpdateTaskDto({
        updates: { name: 'X', parentTaskId: parentId },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some(
          (e) =>
            e.code === 'entity_not_found' && e.field.includes('parentTaskId'),
        ),
      ).toBe(true);
      expect(result.proposals[0]!.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'proposals[0].updates.parentTaskId',
            reason:
              `Parent work item ${parentId} was not found as an existing, ` +
              'non-archived materialized work item.',
            suggestion:
              'Use an already-created parent work-item ID; draft proposal IDs are only valid in structured edge declarations, not parentTaskId.',
          }),
        ]),
      );
    });

    describe('parent placement validation', () => {
      const parentId = '123e4567-e89b-42d3-a456-426614174099';

      it('CREATE: rejects a FEATURE child under a STANDARD parent', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        // parent task lookup
        mockPrisma.db.task.findFirst.mockResolvedValueOnce({
          id: parentId,
          type: 'STANDARD',
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const dto = makeCreateTaskDto({
          updates: {
            name: 'New Feature',
            initiativeId: testIds.initiative,
            parentTaskId: parentId,
            type: 'FEATURE',
            tag: 'backend',
          },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) =>
              e.code === 'invalid_placement' &&
              e.field.includes('parentTaskId'),
          ),
        ).toBe(true);
      });

      it('CREATE: rejects any child under a GOAL parent', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.task.findFirst.mockResolvedValueOnce({
          id: parentId,
          type: 'GOAL',
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const dto = makeCreateTaskDto({
          updates: {
            name: 'Subtask',
            initiativeId: testIds.initiative,
            parentTaskId: parentId,
            type: 'STANDARD',
          },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) =>
              e.code === 'invalid_placement' &&
              e.field.includes('parentTaskId'),
          ),
        ).toBe(true);
      });

      it('CREATE: accepts a STANDARD child under a FEATURE parent', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.task.findFirst.mockResolvedValueOnce({
          id: parentId,
          type: 'FEATURE',
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const dto = makeCreateTaskDto({
          updates: {
            name: 'Subtask',
            initiativeId: testIds.initiative,
            parentTaskId: parentId,
            type: 'STANDARD',
          },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.some(
            (e) => e.code === 'invalid_placement',
          ),
        ).toBe(false);
      });

      it('UPDATE (re-parent): rejects moving a FEATURE under a STANDARD parent', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.task.findFirst
          .mockResolvedValueOnce({ id: testIds.task }) // target entity check
          .mockResolvedValueOnce({ id: parentId, type: 'STANDARD' }) // parent lookup
          .mockResolvedValueOnce({ type: 'FEATURE' }); // current task type

        const dto = makeUpdateTaskDto({
          updates: { name: 'X', parentTaskId: parentId },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) =>
              e.code === 'invalid_placement' &&
              e.field.includes('parentTaskId'),
          ),
        ).toBe(true);
      });

      it('UPDATE (re-parent): accepts moving a STANDARD task under a FEATURE parent', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.task.findFirst
          .mockResolvedValueOnce({ id: testIds.task }) // target entity check
          .mockResolvedValueOnce({ id: parentId, type: 'FEATURE' }) // parent lookup
          .mockResolvedValueOnce({ type: 'STANDARD' }); // current task type

        const dto = makeUpdateTaskDto({
          updates: { name: 'X', parentTaskId: parentId },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.some(
            (e) => e.code === 'invalid_placement',
          ),
        ).toBe(false);
      });

      it('accepts FEATURE-to-CONTRACT child-owned structural parentage', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.task.findFirst.mockResolvedValueOnce({
          id: parentId,
          type: 'FEATURE',
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const result = await engine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'Agreement',
                initiativeId: testIds.initiative,
                type: 'CONTRACT',
                parentTaskId: parentId,
              },
            }),
          ],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.some(
            (issue) => issue.code === 'invalid_placement',
          ),
        ).toBe(false);
      });

      it('rejects workflow_step-to-CONTRACT structural parentage without edge guidance', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.task.findFirst.mockResolvedValueOnce({
          id: parentId,
          type: 'workflow_step',
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const result = await engine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'Agreement',
                initiativeId: testIds.initiative,
                type: 'CONTRACT',
                parentTaskId: parentId,
              },
            }),
          ],
          context: makeContext(),
        });

        const placement = result.proposals[0]!.errors.find(
          (issue) => issue.code === 'invalid_placement',
        );
        expect(placement?.reason).toBe(
          'A workflow_step item cannot parent a CONTRACT item under the configured work-item type definitions.',
        );
        expect(placement?.suggestion).not.toMatch(/TRACKS|edge/i);
      });

      it('rejects removing the required parent from a CONTRACT update', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.task.findFirst
          .mockResolvedValueOnce({ id: testIds.task })
          .mockResolvedValueOnce({ type: 'CONTRACT' });

        const result = await engine.validate({
          proposals: [
            makeUpdateTaskDto({
              updates: { parentTaskId: null } as never,
            }),
          ],
          context: makeContext(),
        });

        expect(result.proposals[0]!.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'invalid_placement',
              reason:
                'CONTRACT items require a structural parent under the configured work-item type definition.',
            }),
          ]),
        );
      });

      it('accepts removing the optional parent from a FEATURE update', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.task.findFirst
          .mockResolvedValueOnce({ id: testIds.task })
          .mockResolvedValueOnce({ type: 'FEATURE' });

        const result = await engine.validate({
          proposals: [
            makeUpdateTaskDto({
              updates: { parentTaskId: null } as never,
            }),
          ],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.some(
            (issue) => issue.code === 'invalid_placement',
          ),
        ).toBe(false);
      });

      // Inline placement matrix for CREATE and UPDATE proposal tests.
      // Mirrors the registry's built-in type rules. Compatibility is owned by
      // each child's allowedParentTaskTypes declaration.
      type ConfigTaskType =
        | 'STANDARD'
        | 'FEATURE'
        | 'BUG'
        | 'GOAL'
        | 'CONTRACT'
        | 'workflow'
        | 'workflow_step';
      const PLACEMENT_RULES: Record<
        ConfigTaskType,
        {
          allowedParentTaskTypes: ConfigTaskType[];
        }
      > = {
        STANDARD: {
          allowedParentTaskTypes: ['FEATURE', 'STANDARD'],
        },
        FEATURE: {
          allowedParentTaskTypes: ['FEATURE'],
        },
        BUG: {
          allowedParentTaskTypes: ['FEATURE'],
        },
        GOAL: {
          allowedParentTaskTypes: [],
        },
        CONTRACT: {
          allowedParentTaskTypes: ['FEATURE'],
        },
        workflow: {
          allowedParentTaskTypes: ['FEATURE', 'STANDARD'],
        },
        workflow_step: {
          allowedParentTaskTypes: ['workflow'],
        },
      };
      const ALL_TASK_TYPES = Object.keys(PLACEMENT_RULES) as ConfigTaskType[];

      const childUpdates = (
        childType: ConfigTaskType,
      ): Record<string, unknown> => {
        if (childType === 'FEATURE') return { type: 'FEATURE', tag: 'product' };
        if (childType === 'BUG') return { type: 'BUG' };
        if (childType === 'CONTRACT') return { type: 'CONTRACT' };
        if (childType === 'workflow' || childType === 'workflow_step') {
          return { type: childType };
        }
        // GOAL is filtered out of CHILD_CANDIDATES below, leaving STANDARD.
        return { type: 'STANDARD' };
      };

      const CHILD_CANDIDATES = ALL_TASK_TYPES.filter(
        (t) => PLACEMENT_RULES[t].allowedParentTaskTypes.length > 0,
      );

      const INVALID_PAIR_CASES = ALL_TASK_TYPES.flatMap((parent) =>
        CHILD_CANDIDATES.filter(
          (child) =>
            !PLACEMENT_RULES[child].allowedParentTaskTypes.includes(parent),
        ).map((child) => ({ parent, child })),
      );

      const VALID_PAIR_CASES = ALL_TASK_TYPES.flatMap((parent) =>
        CHILD_CANDIDATES.filter((child) =>
          PLACEMENT_RULES[child].allowedParentTaskTypes.includes(parent),
        ).map((child) => ({ parent, child })),
      );

      // ── Child-owned per-pair allow-list ──

      it.each(INVALID_PAIR_CASES)(
        'CREATE: refuses a $child child under a $parent parent with a valid-parent suggestion',
        async ({ parent, child }) => {
          mockPrisma.db.project.findFirst.mockResolvedValue({
            id: testIds.project,
          });
          mockPrisma.db.task.findFirst.mockResolvedValueOnce({
            id: parentId,
            type: parent,
          });
          mockPrisma.db.initiative.findFirst.mockResolvedValue({
            id: testIds.initiative,
          });

          const dto = makeCreateTaskDto({
            updates: {
              name: 'New child',
              initiativeId: testIds.initiative,
              parentTaskId: parentId,
              ...childUpdates(child),
            },
          });

          const result = await engine.validate({
            proposals: [dto],
            context: makeContext(),
          });

          expect(result.valid).toBe(false);
          const placement = result.proposals[0]!.errors.find(
            (e) =>
              e.code === 'invalid_placement' &&
              e.field.includes('parentTaskId'),
          );
          expect(placement).toBeDefined();
          expect(placement!.reason).toBe(
            `A ${parent} item cannot parent a ${child} item under the configured work-item type definitions.`,
          );
          expect(placement!.suggestion).not.toMatch(/TRACKS|edge/i);
        },
      );

      it.each(INVALID_PAIR_CASES)(
        'UPDATE (re-parent): refuses moving a $child task under a $parent parent with a valid-parent suggestion',
        async ({ parent, child }) => {
          mockPrisma.db.project.findFirst.mockResolvedValue({
            id: testIds.project,
          });
          mockPrisma.db.task.findFirst
            .mockResolvedValueOnce({ id: testIds.task })
            .mockResolvedValueOnce({ id: parentId, type: parent })
            .mockResolvedValueOnce({ type: child });

          const dto = makeUpdateTaskDto({
            updates: { name: 'X', parentTaskId: parentId },
          });

          const result = await engine.validate({
            proposals: [dto],
            context: makeContext(),
          });

          expect(result.valid).toBe(false);
          const placement = result.proposals[0]!.errors.find(
            (e) =>
              e.code === 'invalid_placement' &&
              e.field.includes('parentTaskId'),
          );
          expect(placement).toBeDefined();
          expect(placement!.reason).toBe(
            `A ${parent} item cannot parent a ${child} item under the configured work-item type definitions.`,
          );
          expect(placement!.suggestion).not.toMatch(/TRACKS|edge/i);
        },
      );

      // ── Valid pairs (config-driven happy path) ──

      it.each(VALID_PAIR_CASES)(
        'CREATE: accepts a $child child under a $parent parent',
        async ({ parent, child }) => {
          mockPrisma.db.project.findFirst.mockResolvedValue({
            id: testIds.project,
          });
          mockPrisma.db.task.findFirst.mockResolvedValueOnce({
            id: parentId,
            type: parent,
          });
          mockPrisma.db.initiative.findFirst.mockResolvedValue({
            id: testIds.initiative,
          });

          const dto = makeCreateTaskDto({
            updates: {
              name: 'New child',
              initiativeId: testIds.initiative,
              parentTaskId: parentId,
              ...childUpdates(child),
            },
          });

          const result = await engine.validate({
            proposals: [dto],
            context: makeContext(),
          });

          expect(
            result.proposals[0]!.errors.some(
              (e) => e.code === 'invalid_placement',
            ),
          ).toBe(false);
        },
      );

      it.each(VALID_PAIR_CASES)(
        'UPDATE (re-parent): accepts moving a $child task under a $parent parent',
        async ({ parent, child }) => {
          mockPrisma.db.project.findFirst.mockResolvedValue({
            id: testIds.project,
          });
          mockPrisma.db.task.findFirst
            .mockResolvedValueOnce({ id: testIds.task })
            .mockResolvedValueOnce({ id: parentId, type: parent })
            .mockResolvedValueOnce({ type: child });

          const dto = makeUpdateTaskDto({
            updates: { name: 'X', parentTaskId: parentId },
          });

          const result = await engine.validate({
            proposals: [dto],
            context: makeContext(),
          });

          expect(
            result.proposals[0]!.errors.some(
              (e) => e.code === 'invalid_placement',
            ),
          ).toBe(false);
        },
      );
    });

    describe('work-item type recognition', () => {
      const projectModeFiles = {
        schemaVersion: 'project-mode-files.v1',
        files: {
          'MODE.md': 'Start here and keep the startup instructions compact.',
          'references/checklist.md': '- Verify the requested behavior.',
        },
      };

      async function createProjectModeEngine(): Promise<ProposalValidationEngine> {
        const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: WORK_ITEM_TYPE_KEYS.Mode,
            projectId: testIds.project,
            sectionDefinitions: [
              { key: 'description', label: 'Catalog description' },
              {
                key: 'files',
                label: 'Files',
                kind: 'json',
                schemaRef: '#/components/schemas/ProjectModeFiles',
              },
            ],
            allowedParentTypes: ['FEATURE'],
            allowedParentEntityTypes: [EntityType.Task],
            capabilities: { requiresParent: true },
            forbiddenScalars: ['dueDate', 'tag'],
          },
        ]);
        const module = await Test.createTestingModule({
          providers: [
            ProposalValidationEngine,
            WorkItemParentageValidator,
            { provide: PrismaService, useValue: mockPrisma },
            { provide: WorkItemTypeRegistryService, useValue: registry },
          ],
        }).compile();
        return module.get<ProposalValidationEngine>(ProposalValidationEngine);
      }

      function makeProjectModeDto(files: unknown): CreateProposalDto {
        return makeCreateTaskDto({
          updates: {
            name: 'Review Mode',
            initiativeId: testIds.initiative,
            type: WORK_ITEM_TYPE_KEYS.Mode,
            parentTaskId: testIds.task,
            sections: [
              {
                key: 'description',
                content: 'A compact mode for STANDARD work items.',
              },
              { key: 'files', content: files },
            ],
          },
        });
      }

      it('CREATE: accepts MODE.md and supporting files at the pre-review boundary', async () => {
        const modeEngine = await createProjectModeEngine();
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });
        mockPrisma.db.task.findFirst.mockResolvedValue({
          id: testIds.task,
          type: 'FEATURE',
        });

        const result = await modeEngine.validate({
          proposals: [makeProjectModeDto(projectModeFiles)],
          context: makeContext(),
        });

        expect(result.valid).toBe(true);
        expect(result.proposals[0]!.errors).toHaveLength(0);
      });

      it.each([
        [
          'missing MODE.md',
          {
            schemaVersion: 'project-mode-files.v1',
            files: { 'references/checklist.md': 'Read this later.' },
          },
        ],
        [
          'empty MODE.md',
          {
            schemaVersion: 'project-mode-files.v1',
            files: {
              'MODE.md': '',
              'references/checklist.md': 'Read this later.',
            },
          },
        ],
        [
          'malformed file values',
          {
            schemaVersion: 'project-mode-files.v1',
            files: { 'MODE.md': 'Start here.', 'references/checklist.md': 7 },
          },
        ],
        [
          'absolute paths',
          {
            schemaVersion: 'project-mode-files.v1',
            files: { 'MODE.md': 'Start here.', '/tmp/escape.md': 'No.' },
          },
        ],
        [
          'traversal paths',
          {
            schemaVersion: 'project-mode-files.v1',
            files: { 'MODE.md': 'Start here.', '../escape.md': 'No.' },
          },
        ],
      ] as const)(
        'CREATE: rejects MODE files with %s before review persistence',
        async (_case, files) => {
          const modeEngine = await createProjectModeEngine();
          mockPrisma.db.project.findFirst.mockResolvedValue({
            id: testIds.project,
          });
          mockPrisma.db.initiative.findFirst.mockResolvedValue({
            id: testIds.initiative,
          });

          const result = await modeEngine.validate({
            proposals: [makeProjectModeDto(files)],
            context: makeContext(),
          });

          expect(result.valid).toBe(false);
          expect(
            result.proposals[0]!.errors.some(
              (error) => error.code === 'invalid_json_section',
            ),
          ).toBe(true);
        },
      );

      it('CREATE: passes a built-in type (GOAL) the registry knows', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const dto = makeCreateTaskDto({
          updates: {
            name: 'New goal',
            initiativeId: testIds.initiative,
            type: 'GOAL',
          },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.some(
            (e) => e.code === 'unrecognized_type',
          ),
        ).toBe(false);
      });

      it('CREATE: accepts an active project-defined type', async () => {
        const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'MARKETING',
            projectId: testIds.project,
            name: 'Marketing',
            sectionDefinitions: [],
            allowedParentTypes: [],
          },
        ]);
        const module = await Test.createTestingModule({
          providers: [
            ProposalValidationEngine,
            WorkItemParentageValidator,
            { provide: PrismaService, useValue: mockPrisma },
            { provide: WorkItemTypeRegistryService, useValue: registry },
          ],
        }).compile();
        const customEngine = module.get<ProposalValidationEngine>(
          ProposalValidationEngine,
        );
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const result = await customEngine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: { name: 'Campaign brief', type: 'MARKETING' },
            }),
          ],
          context: makeContext(),
        });

        expect(result.valid).toBe(true);
      });

      it('CREATE: rejects an unrecognized type with a valid-types message', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const dto = makeCreateTaskDto({
          updates: {
            name: 'Mystery item',
            initiativeId: testIds.initiative,
            type: 'EPIC',
          },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        const issue = result.proposals[0]!.errors.find(
          (e) => e.code === 'unrecognized_type',
        );
        expect(issue).toBeDefined();
        expect(issue!.field).toBe('proposals[0].updates.type');
        expect(issue!.layer).toBe('referential');
        expect(issue!.reason).toBe(
          "'EPIC' is not a usable type for this project. " +
            'Valid types: BUG, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, FEATURE, GOAL, PLAN, PLAN_STAGE, STANDARD, TASK_MONITOR, workflow, workflow_step',
        );
      });

      it('UPDATE: rejects a re-typed proposal naming an unrecognized type', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

        const dto = makeUpdateTaskDto({
          updates: { type: 'EPIC' },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) =>
              e.code === 'unrecognized_type' &&
              e.field.includes('updates.type'),
          ),
        ).toBe(true);
      });

      it('CREATE: rejects an omitted type as a structural error', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const result = await engine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'Untyped task',
                initiativeId: testIds.initiative,
              },
            }),
          ],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(result.proposals[0]!.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'proposals[0].updates.type',
              code: 'required',
              layer: 'structural',
            }),
          ]),
        );
      });

      it('CREATE: accepts a valid TASK_MONITOR executionDefinition JSON section', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const dto = makeCreateTaskDto({
          updates: {
            name: 'Plan stage monitor',
            initiativeId: testIds.initiative,
            type: 'TASK_MONITOR',
            sections: [
              { key: 'summary', content: 'Run selected work.' },
              {
                key: 'executionDefinition',
                content: VALID_TASK_MONITOR_EXECUTION_DEFINITION,
              },
            ],
          },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.some(
            (e) => e.code === 'invalid_json_section',
          ),
        ).toBe(false);
      });

      it('CREATE: allows omitted schema-backed sections because sections are optional in the generated DTO', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const dto = makeCreateTaskDto({
          updates: {
            name: 'Plan stage monitor shell',
            initiativeId: testIds.initiative,
            type: 'TASK_MONITOR',
          },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.some((e) => e.code === 'missing_section'),
        ).toBe(false);
      });

      it('CREATE: validates Workflow layout preferences through the shared JSON section registry', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const valid = await engine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'Release workflow',
                initiativeId: testIds.initiative,
                type: 'workflow',
                sections: [
                  {
                    key: 'graphLayoutPreference',
                    content: {
                      schemaVersion: 'work-item-graph-layout-preference.v1',
                      rows: 2,
                      columns: 3,
                    },
                  },
                ],
              },
            }),
          ],
          context: makeContext(),
        });
        const invalid = await engine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'Invalid release workflow',
                initiativeId: testIds.initiative,
                type: 'workflow',
                sections: [
                  {
                    key: 'graphLayoutPreference',
                    content: {
                      schemaVersion: 'work-item-graph-layout-preference.v1',
                      rows: 0,
                      columns: 3,
                    },
                  },
                ],
              },
            }),
          ],
          context: makeContext(),
        });

        expect(valid.valid).toBe(true);
        expect(invalid.proposals[0]!.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: 'invalid_json_section',
              reason: expect.stringContaining('graphLayoutPreference'),
            }),
          ]),
        );
      });

      it('CREATE: rejects TASK_MONITOR executionDefinition without an execution plan', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });
        const { executionPlan: _executionPlan, ...definitionWithoutPlan } =
          VALID_TASK_MONITOR_EXECUTION_DEFINITION;

        const dto = makeCreateTaskDto({
          updates: {
            name: 'Broken monitor',
            initiativeId: testIds.initiative,
            type: 'TASK_MONITOR',
            sections: [
              {
                key: 'executionDefinition',
                content: definitionWithoutPlan,
              },
            ],
          },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) =>
              e.code === 'invalid_json_section' &&
              e.reason.includes('executionDefinition') &&
              e.reason.includes(
                '#/components/schemas/TaskMonitorExecutionDefinition',
              ) &&
              e.reason.includes('executionPlan'),
          ),
        ).toBe(true);
      });

      it('CREATE: rejects TASK_MONITOR node status mirrors', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const dto = makeCreateTaskDto({
          updates: {
            name: 'Copied evidence monitor',
            initiativeId: testIds.initiative,
            type: 'TASK_MONITOR',
            sections: [
              {
                key: 'executionDefinition',
                content: {
                  ...VALID_TASK_MONITOR_EXECUTION_DEFINITION,
                  executionPlan: [
                    {
                      ...VALID_TASK_MONITOR_EXECUTION_DEFINITION
                        .executionPlan[0],
                      taskStatus: 'COMPLETED',
                    },
                  ],
                },
              },
            ],
          },
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) =>
              e.code === 'invalid_json_section' &&
              e.reason.includes('must NOT have additional properties'),
          ),
        ).toBe(true);
      });

      it('CREATE: rejects unsupported schemaRef declared by the target type', async () => {
        const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'CUSTOM_JSON',
            projectId: testIds.project,
            name: 'Custom JSON',
            sectionDefinitions: [
              {
                key: 'payload',
                label: 'Payload',
                kind: 'json',
                schemaRef: '#/components/schemas/UnsupportedSection',
              },
            ],
            allowedParentTypes: [],
          },
        ]);
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            ProposalValidationEngine,
            WorkItemParentageValidator,
            { provide: PrismaService, useValue: mockPrisma },
            {
              provide: WorkItemTypeRegistryService,
              useValue: registry,
            },
          ],
        }).compile();
        const customEngine = module.get<ProposalValidationEngine>(
          ProposalValidationEngine,
        );
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const dto = makeCreateTaskDto({
          updates: {
            name: 'Custom JSON task',
            initiativeId: testIds.initiative,
            type: 'CUSTOM_JSON',
            sections: [
              {
                key: 'payload',
                content: VALID_TASK_MONITOR_EXECUTION_DEFINITION,
              },
            ],
          },
        });

        const result = await customEngine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) =>
              e.code === 'unsupported_json_section_schema' &&
              e.reason.includes('#/components/schemas/UnsupportedSection'),
          ),
        ).toBe(true);
      });

      it('CREATE: validates HTML/CSS section content during proposal review', async () => {
        const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'CUSTOM_HTML_CSS',
            projectId: testIds.project,
            name: 'Custom HTML/CSS',
            sectionDefinitions: [
              {
                key: 'preview',
                label: 'Preview',
                kind: 'html/css',
                defaultSizeKey: 'desktop',
                sizeProfiles: [
                  {
                    key: 'desktop',
                    label: 'Desktop',
                    breakpoints: [
                      {
                        minContainerWidth: 0,
                        inline: { width: 400, height: 300 },
                        page: { width: 1200, height: 800 },
                      },
                    ],
                  },
                ],
              },
            ],
            allowedParentTypes: [],
          },
        ]);
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            ProposalValidationEngine,
            WorkItemParentageValidator,
            { provide: PrismaService, useValue: mockPrisma },
            { provide: WorkItemTypeRegistryService, useValue: registry },
          ],
        }).compile();
        const customEngine = module.get<ProposalValidationEngine>(
          ProposalValidationEngine,
        );
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const valid = await customEngine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'HTML/CSS task',
                type: 'CUSTOM_HTML_CSS',
                sections: [
                  {
                    key: 'preview',
                    content: {
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
                          lifecycle: 'open',
                          authoredProposalId:
                            '20000000-0000-4000-8000-000000000001',
                          authoredSizeKey: 'desktop',
                          target: { type: 'element', nodeId: 'hero' },
                        },
                      ],
                    },
                  },
                ],
              },
            }),
          ],
          context: makeContext(),
        });
        const invalid = await customEngine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'Broken HTML/CSS task',
                type: 'CUSTOM_HTML_CSS',
                sections: [
                  {
                    key: 'preview',
                    content: {
                      html: '<main>Preview</main>',
                      css: '',
                      extra: true,
                    },
                  },
                ],
              },
            }),
          ],
          context: makeContext(),
        });

        expect(valid.valid).toBe(true);
        expect(invalid.valid).toBe(false);
        expect(invalid.proposals[0]!.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'invalid_html_css_section' }),
          ]),
        );

        mockPrisma.db.task.findFirst.mockResolvedValue({
          id: testIds.task,
          type: 'CUSTOM_HTML_CSS',
          projectId: testIds.project,
        });
        const update = await customEngine.validate({
          proposals: [
            makeUpdateTaskDto({
              updates: {
                sections: [
                  {
                    key: 'preview',
                    content: {
                      html: '<main>Preview</main>',
                      css: '',
                      sizeKey: 'desktop',
                      annotations: [],
                    },
                  },
                ],
              },
            }),
          ],
          context: makeContext(),
        });
        expect(update.valid).toBe(true);

        const invalidUpdateTx = mockPrisma.db;
        invalidUpdateTx.task.findFirst.mockResolvedValue({
          id: testIds.task,
          type: 'CUSTOM_HTML_CSS',
          projectId: testIds.project,
        });
        await expect(
          customEngine.assertTaskMutationAuthoringValid(
            makeUpdateTaskDto({
              updates: {
                sections: [
                  {
                    key: 'preview',
                    content: {
                      html: '<main>Preview</main>',
                      css: 42,
                      sizeKey: 'desktop',
                    },
                  },
                ],
              },
            }),
            testIds.organization,
            testIds.project,
            invalidUpdateTx,
          ),
        ).rejects.toMatchObject({
          response: expect.objectContaining({
            errors: expect.arrayContaining([
              expect.objectContaining({
                code: 'invalid_html_css_section',
                field: 'proposals[0].updates.sections[0].content.css',
              }),
            ]),
          }),
        });
        expect(invalidUpdateTx.proposal.create).not.toHaveBeenCalled();
      });

      it('CREATE: validates structured mockup versions and reports nested fields', async () => {
        const registry = await createWarmWorkItemTypeRegistryWithCustomTypes([
          {
            typeKey: 'CUSTOM_STRUCTURED_MOCKUP',
            projectId: testIds.project,
            name: 'Custom structured mockup',
            sectionDefinitions: [
              { key: 'desktop', label: 'Desktop', kind: 'structured-mockup' },
              { key: 'mobile', label: 'Mobile', kind: 'structured-mockup' },
            ],
            allowedParentTypes: [],
          },
        ]);
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            ProposalValidationEngine,
            WorkItemParentageValidator,
            { provide: PrismaService, useValue: mockPrisma },
            { provide: WorkItemTypeRegistryService, useValue: registry },
          ],
        }).compile();
        const customEngine = module.get<ProposalValidationEngine>(
          ProposalValidationEngine,
        );
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        mockPrisma.db.initiative.findFirst.mockResolvedValue({
          id: testIds.initiative,
        });

        const makeDocument = (align: string) => ({
          schemaVersion: 'work-item-structured-mockup.v3',
          revision: 1,
          content: [
            {
              type: 'row',
              props: {
                id: 'root',
                width: { mode: 'fill' },
                height: { mode: 'content' },
                gap: 8,
                padding: 16,
                justify: 'spread',
                align,
              },
              children: [
                {
                  type: 'text',
                  props: {
                    id: 'title',
                    width: { mode: 'fit' },
                    height: { mode: 'content' },
                    text: 'Preview',
                  },
                },
              ],
            },
          ],
          annotations: [],
        });

        const valid = await customEngine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'Structured mockup task',
                initiativeId: testIds.initiative,
                type: 'CUSTOM_STRUCTURED_MOCKUP',
                sections: [
                  { key: 'desktop', content: makeDocument('stretch') },
                  { key: 'mobile', content: makeDocument('start') },
                ],
              },
            }),
          ],
          context: makeContext(),
        });
        const invalid = await customEngine.validate({
          proposals: [
            makeCreateTaskDto({
              updates: {
                name: 'Broken structured mockup task',
                initiativeId: testIds.initiative,
                type: 'CUSTOM_STRUCTURED_MOCKUP',
                sections: [
                  {
                    key: 'desktop',
                    content: makeDocument('spread'),
                  },
                ],
              },
            }),
          ],
          context: makeContext(),
        });

        expect(valid.valid).toBe(true);
        expect(invalid.valid).toBe(false);
        expect(invalid.proposals[0]!.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field:
                'proposals[0].updates.sections[0].content.content[0].props.align',
              code: 'invalid_structured_mockup_section',
              suggestion: expect.stringContaining(
                'work-item-structured-mockup.v3, v4, or v5',
              ),
            }),
          ]),
        );
        const structuredMockupError = invalid.proposals[0]!.errors.find(
          (error) => error.code === 'invalid_structured_mockup_section',
        );
        expect(structuredMockupError?.suggestion).toEqual(
          expect.stringContaining('independent justify'),
        );
      });
    });

    it('should fail when initiativeId in updates does not exist', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });
      mockPrisma.db.initiative.findFirst.mockResolvedValue(null);

      const dto = makeUpdateTaskDto({
        updates: { name: 'X', initiativeId: testIds.initiative },
      });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(
        result.proposals[0]!.errors.some(
          (e) =>
            e.code === 'entity_not_found' && e.field.includes('initiativeId'),
        ),
      ).toBe(true);
    });
  });

  // ── Permission validation ─────────────────────────────────────

  describe('permission validation', () => {
    it('should warn when requestor has no org membership', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const requestor = TestUtils.createMockAuthenticatedUser({
        orgMemberships: [],
      });

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext({ requestor }),
      });

      // Permission issues are warnings, not blocking errors
      expect(result.valid).toBe(true);
      const warnings = result.proposals[0]!.warnings;
      expect(warnings.some((w) => w.code === 'no_org_membership')).toBe(true);
      expect(warnings[0]!.layer).toBe('permission');
    });

    it('should warn when requestor has VIEWER role', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const requestor = TestUtils.createMockAuthenticatedUser({
        orgMemberships: [{ orgId: testIds.organization, role: 'VIEWER' }],
      });

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext({ requestor }),
      });

      expect(result.valid).toBe(true);
      const warnings = result.proposals[0]!.warnings;
      expect(warnings.some((w) => w.code === 'insufficient_role')).toBe(true);
      expect(warnings[0]!.suggestion).toBeDefined();
    });

    it('should not warn for MEMBER role', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const requestor = TestUtils.createMockAuthenticatedUser({
        orgMemberships: [{ orgId: testIds.organization, role: 'MEMBER' }],
      });

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext({ requestor }),
      });

      expect(result.proposals[0]!.warnings).toHaveLength(0);
    });

    it('should not warn for OWNER role', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const requestor = TestUtils.createMockAuthenticatedUser({
        orgMemberships: [{ orgId: testIds.organization, role: 'OWNER' }],
      });

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext({ requestor }),
      });

      expect(result.proposals[0]!.warnings).toHaveLength(0);
    });
  });

  // ── Batch validation ──────────────────────────────────────────

  describe('batch validation', () => {
    it('should validate each proposal independently', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const validDto = makeUpdateTaskDto({ type: 'BATCH' });
      const invalidDto = makeUpdateTaskDto({
        type: 'BATCH',
        updates: {},
      });

      const result = await engine.validate({
        proposals: [validDto, invalidDto],
        context: makeContext(),
      });

      expect(result.valid).toBe(false);
      expect(result.proposals).toHaveLength(2);
      expect(result.proposals[0]!.valid).toBe(true);
      expect(result.proposals[1]!.valid).toBe(false);
    });

    it('should include correct index in field paths', async () => {
      const invalidDto = makeUpdateTaskDto({
        type: 'BATCH',
        action: 'INVALID' as any,
      });

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto(), invalidDto],
        context: makeContext(),
      });

      const secondErrors = result.proposals[1]!.errors;
      expect(secondErrors[0]!.field).toMatch(/^proposals\[1\]/);
    });

    it('should not run referential checks when structural fails', async () => {
      const dto = makeUpdateTaskDto({ action: 'INVALID' as any });

      await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      // If structural validation failed, no DB calls for entity checks
      expect(mockPrisma.db.project.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.db.task.findFirst).not.toHaveBeenCalled();
    });

    it('should set overall valid=true only when all proposals pass', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto(), makeUpdateTaskDto()],
        context: makeContext(),
      });

      expect(result.valid).toBe(true);
      expect(result.proposals.every((p) => p.valid)).toBe(true);
    });
  });

  // ── Result envelope structure ─────────────────────────────────

  describe('result envelope', () => {
    it('should return proper structure for single proposal', async () => {
      mockPrisma.db.project.findFirst.mockResolvedValue({
        id: testIds.project,
      });
      mockPrisma.db.task.findFirst.mockResolvedValue({ id: testIds.task });

      const result = await engine.validate({
        proposals: [makeUpdateTaskDto()],
        context: makeContext(),
      });

      expect(result).toEqual({
        valid: true,
        proposals: [
          {
            index: 0,
            valid: true,
            errors: [],
            warnings: [],
          },
        ],
      });
    });

    it('should include layer in every issue', async () => {
      const dto = makeUpdateTaskDto({ action: 'INVALID' as any });

      const result = await engine.validate({
        proposals: [dto],
        context: makeContext(),
      });

      for (const issue of result.proposals[0]!.errors) {
        expect(issue.layer).toBeDefined();
        expect(['structural', 'referential', 'permission']).toContain(
          issue.layer,
        );
      }
    });
  });

  // ── Work-item-type definition validation ──────────────────────

  describe('work-item-type definition validation', () => {
    describe('structural', () => {
      it('accepts semantic guidance on definition proposals', async () => {
        const result = await engine.validate({
          proposals: [
            makeCreateWorkItemTypeDto({
              agentGuidance: {
                overview: 'Meaning',
                examples: [{ title: 'Example', guidance: 'Use case' }],
                contexts: [
                  {
                    focalTypeKeys: ['custom-focus'],
                    guidance: 'Directional meaning',
                  },
                ],
              },
            }),
          ],
          context: makeContext(),
        });
        expect(
          result.proposals[0]!.errors.filter(
            (error) => error.layer === 'structural',
          ),
        ).toEqual([]);
      });
      it('accepts maintenance advice on definition proposals', async () => {
        const result = await engine.validate({
          proposals: [
            makeCreateWorkItemTypeDto({
              maintenanceGuidance: 'Review concrete changes in nearby work.',
            }),
          ],
          context: makeContext(),
        });
        expect(
          result.proposals[0]!.errors.filter(
            (error) => error.layer === 'structural',
          ),
        ).toEqual([]);
      });

      it.each([
        { overview: '' },
        { overview: 'Meaning', extra: true },
        {
          overview: 'Meaning',
          contexts: [{ focalTypeKeys: [], guidance: 'Body' }],
        },
        {
          overview: 'Meaning',
          contexts: [
            { focalTypeKeys: ['focus'], guidance: 'Body', extra: true },
          ],
        },
      ])(
        'rejects malformed guidance at proposal validation %j',
        async (agentGuidance) => {
          const result = await engine.validate({
            proposals: [makeCreateWorkItemTypeDto({ agentGuidance })],
            context: makeContext(),
          });
          expect(result.valid).toBe(false);
          expect(
            result.proposals[0]!.errors.some(
              (error) => error.layer === 'structural',
            ),
          ).toBe(true);
        },
      );

      it('rejects an unrecognized status enum member', async () => {
        const dto = makeCreateWorkItemTypeDto({
          allowedStatuses: ['BACKLOG', 'WIP'] as any,
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        const issue = result.proposals[0]!.errors.find(
          (e) =>
            e.field.includes('updates.allowedStatuses') &&
            e.code === 'invalid_enum',
        );
        expect(issue).toBeDefined();
        expect(issue!.layer).toBe('structural');
      });

      it('rejects a missing key with a required error', async () => {
        const dto: CreateProposalDto = {
          type: 'SINGLE',
          action: 'CREATE',
          targetEntityId: NIL_UUID,
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: {
            name: 'Marketing',
            sections: [{ key: 'audience', label: 'Audience' }],
            allowedStatuses: ['BACKLOG'],
          },
        };

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) => e.field.includes('updates.key') && e.code === 'required',
          ),
        ).toBe(true);
      });

      it('rejects a missing name with a required error', async () => {
        const dto: CreateProposalDto = {
          type: 'SINGLE',
          action: 'CREATE',
          targetEntityId: NIL_UUID,
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: {
            key: 'MARKETING',
            sections: [{ key: 'audience', label: 'Audience' }],
            allowedStatuses: ['BACKLOG'],
          },
        };

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) => e.field.includes('updates.name') && e.code === 'required',
          ),
        ).toBe(true);
      });

      it('preserves JSON section metadata in WORK_ITEM_TYPE create proposals', async () => {
        const dto = makeCreateWorkItemTypeDto({
          sections: [
            {
              key: 'payload',
              label: 'Payload',
              kind: 'json',
              schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
            },
          ],
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.filter((e) =>
            e.field.includes('updates.sections'),
          ),
        ).toEqual([]);
      });

      it('accepts HTML/CSS section declarations only without schemaRef', async () => {
        const accepted = await engine.validate({
          proposals: [
            makeCreateWorkItemTypeDto({
              sections: [
                { key: 'preview', label: 'Preview', kind: 'html/css' },
              ],
            }),
          ],
          context: makeContext(),
        });
        const rejected = await engine.validate({
          proposals: [
            makeCreateWorkItemTypeDto({
              sections: [
                {
                  key: 'preview',
                  label: 'Preview',
                  kind: 'html/css',
                  schemaRef:
                    '#/components/schemas/WorkItemHtmlCssSectionContent',
                },
              ],
            }),
          ],
          context: makeContext(),
        });

        expect(
          accepted.proposals[0]!.errors.filter((error) =>
            error.field.includes('updates.sections'),
          ),
        ).toEqual([]);
        expect(rejected.valid).toBe(false);
        expect(rejected.proposals[0]!.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: expect.stringContaining('schemaRef'),
              reason: expect.stringContaining('must be omitted'),
            }),
          ]),
        );
      });

      it('accepts structured mockup declarations with presentation profiles and no schemaRef', async () => {
        const section = {
          key: 'mockup',
          label: 'Mockup',
          kind: 'structured-mockup' as const,
          defaultSizeKey: 'panel',
          sizeProfiles: [
            {
              key: 'panel',
              label: 'Panel',
              breakpoints: [
                {
                  minContainerWidth: 0,
                  inline: { width: 320, height: 240 },
                  page: { width: 1024, height: 768 },
                },
              ],
            },
          ],
        };
        const accepted = await engine.validate({
          proposals: [
            makeCreateWorkItemTypeDto({
              sections: [section],
            }),
          ],
          context: makeContext(),
        });
        const rejected = await engine.validate({
          proposals: [
            makeCreateWorkItemTypeDto({
              sections: [
                {
                  ...section,
                  schemaRef: '#/components/schemas/Anything',
                },
              ],
            }),
          ],
          context: makeContext(),
        });

        expect(
          accepted.proposals[0]!.errors.filter((error) =>
            error.field.includes('updates.sections'),
          ),
        ).toEqual([]);
        expect(rejected.proposals[0]!.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: expect.stringContaining('schemaRef'),
              reason: expect.stringContaining('must be omitted'),
            }),
          ]),
        );
      });

      it('accepts generated graph capability declarations on WORK_ITEM_TYPE create proposals', async () => {
        const dto = makeCreateWorkItemTypeDto({
          capabilities: {
            graph: {
              nodeChildType: 'STANDARD',
              layout: {
                sectionKey: 'graphLayout',
                schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
              },
              layoutPreference: {
                sectionKey: 'graphLayoutPreference',
                schemaRef:
                  '#/components/schemas/WorkItemGraphLayoutPreferenceValue',
              },
              readableRelationships: [
                {
                  edgeType: 'STANDARD',
                  category: 'flow',
                  sourceEndpoint: {
                    role: 'graphNode',
                    entityTypes: ['TASK'],
                    workItemTypeKeys: ['STANDARD'],
                  },
                  targetEndpoint: {
                    role: 'graphNode',
                    entityTypes: ['TASK'],
                    workItemTypeKeys: ['STANDARD'],
                  },
                  direction: {
                    required: true,
                    allowedDirections: ['forward'],
                  },
                },
              ],
              editableRelationships: [],
              searchableMetaLinkTargets: [],
              rendererKey: 'work-item-graph',
              editorKey: 'work-item-graph-editor',
              supportedActions: ['viewGraph'],
            },
          } as WorkItemTypeDefinitionDto['capabilities'],
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.filter((e) =>
            e.field.includes('updates.capabilities'),
          ),
        ).toEqual([]);
      });

      it.each([
        ['true', { showsInExplorerSidebar: true }],
        ['false', { showsInExplorerSidebar: false }],
        ['omitted', { requiresParent: true }],
      ])(
        'accepts the optional Explorer capability when it is %s',
        async (_label, capabilities) => {
          const dto = makeCreateWorkItemTypeDto({ capabilities });

          const result = await engine.validate({
            proposals: [dto],
            context: makeContext(),
          });

          expect(
            result.proposals[0]!.errors.filter((e) =>
              e.field.includes('updates.capabilities'),
            ),
          ).toEqual([]);
        },
      );

      it('accepts reset-to-canonical for a canonical override', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        const dto: CreateProposalDto = {
          type: 'SINGLE',
          action: 'UPDATE',
          targetEntityId: WORK_ITEM_TYPE_KEYS.Standard,
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: { resetToCanonical: 'RESET_TO_CANONICAL' },
        };

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(true);
      });

      it('rejects an undeclared capability key', async () => {
        const dto = makeCreateWorkItemTypeDto({
          capabilities: { trackableByGoals: true } as any,
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) =>
              e.field.includes('updates.capabilities') &&
              e.code === 'unrecognized_keys',
          ),
        ).toBe(true);
      });

      it('uses the same capability schema for work-item-type edits', async () => {
        const definition = makeCreateWorkItemTypeDto({
          capabilities: { showsInExplorerSidebar: false },
        }).updates as WorkItemTypeDefinitionDto;
        const dto: CreateProposalDto = {
          type: 'SINGLE',
          action: 'UPDATE',
          targetEntityId: 'MARKETING',
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: { definition },
        };

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.some((e) =>
            e.field.includes('updates.definition.capabilities'),
          ),
        ).toBe(false);
      });

      it('rejects an empty allowedStatuses as an incoherent initial-status policy', async () => {
        const dto = makeCreateWorkItemTypeDto({ allowedStatuses: [] });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        const issue = result.proposals[0]!.errors.find((e) =>
          e.field.includes('updates.allowedStatuses'),
        );
        expect(issue).toBeDefined();
        expect(issue!.layer).toBe('structural');
        expect(issue!.reason).toContain('at least one status');
      });

      it('rejects a scalar field outside the closed WorkItemTypeScalarField set', async () => {
        const dto = makeCreateWorkItemTypeDto({
          requiredScalars: ['budget' as any],
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) =>
              e.field.includes('updates.requiredScalars') &&
              e.code === 'invalid_enum',
          ),
        ).toBe(true);
      });

      it('rejects an unknown top-level field (strict)', async () => {
        const dto = makeCreateWorkItemTypeDto({ bogus: true } as any);

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some((e) => e.layer === 'structural'),
        ).toBe(true);
      });

      it('rejects the removed allowedChildTypes field as a structural error', async () => {
        const dto = makeCreateWorkItemTypeDto({
          allowedChildTypes: ['STANDARD'],
        } as any);

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (error) =>
              error.layer === 'structural' &&
              error.reason.includes('allowedChildTypes'),
          ),
        ).toBe(true);
      });

      it('accepts the generated cascade-delete review payload shape', async () => {
        const result = await engine.validate({
          proposals: [makeCascadeDeleteWorkItemTypeDto()],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.filter(
            (error) => error.layer === 'structural',
          ),
        ).toEqual([]);
      });

      it.each([
        ['missing cascade', { cascade: undefined }, 'updates.cascade'],
        ['false cascade', { cascade: false }, 'updates.cascade'],
        ['missing type key', { typeKey: undefined }, 'updates.typeKey'],
        ['negative item count', { itemCount: -1 }, 'updates.itemCount'],
        ['fractional edge count', { edgeCount: 1.5 }, 'updates.edgeCount'],
      ])('rejects cascade payload with %s', async (_name, updates, field) => {
        const result = await engine.validate({
          proposals: [makeCascadeDeleteWorkItemTypeDto(updates)],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some((error) =>
            error.field.includes(field),
          ),
        ).toBe(true);
      });

      it('rejects cascade payload type key that differs from its target', async () => {
        const result = await engine.validate({
          proposals: [makeCascadeDeleteWorkItemTypeDto({ typeKey: 'OTHER' })],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (error) =>
              error.field.includes('updates.typeKey') &&
              error.code === 'invalid_value',
          ),
        ).toBe(true);
      });
    });

    describe('referential', () => {
      it('accepts a group-owned reserved UUID as the target of a new work-item type', async () => {
        const reservedId = '10000000-0000-4000-8000-000000000020';
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const result = await engine.validate({
          proposals: [
            makeCreateWorkItemTypeDto(undefined, {
              targetEntityId: reservedId,
            }),
          ],
          context: makeContext({
            group: {
              groupId: '10000000-0000-4000-8000-000000000021',
              reservedEntities: [
                {
                  entityId: reservedId,
                  entityType: 'WORK_ITEM_TYPE',
                  workItemType: 'MARKETING',
                },
              ],
            },
          }),
        });

        expect(
          result.proposals[0]!.errors.some(
            (error) => error.code === 'invalid_work_item_type_create_target',
          ),
        ).toBe(false);
      });

      it('rejects a key already active in the project scope as a collision', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        // FEATURE is an active built-in system type in every project scope.
        const dto = makeCreateWorkItemTypeDto({ key: 'FEATURE' });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        const issue = result.proposals[0]!.errors.find(
          (e) => e.code === 'type_key_collision',
        );
        expect(issue).toBeDefined();
        expect(issue!.field).toBe('proposals[0].updates.key');
        expect(issue!.layer).toBe('referential');
      });

      it('rejects creating a replacement for a retained archived key', async () => {
        const archivedRegistry =
          await createWarmWorkItemTypeRegistryWithCustomTypes([
            {
              typeKey: 'MARKETING',
              projectId: testIds.project,
              name: 'Marketing',
              lifecycleStatus: 'archived',
              sectionDefinitions: [{ key: 'audience', label: 'Audience' }],
              allowedStatuses: ['BACKLOG', 'ACTIVE', 'COMPLETED'] as any,
            },
          ]);
        const archivedRegistryModule: TestingModule =
          await Test.createTestingModule({
            providers: [
              ProposalValidationEngine,
              WorkItemParentageValidator,
              { provide: PrismaService, useValue: mockPrisma },
              {
                provide: WorkItemTypeRegistryService,
                useValue: archivedRegistry,
              },
            ],
          }).compile();
        const archivedEngine =
          archivedRegistryModule.get<ProposalValidationEngine>(
            ProposalValidationEngine,
          );
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const result = await archivedEngine.validate({
          proposals: [makeCreateWorkItemTypeDto()],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        const issue = result.proposals[0]!.errors.find(
          (error) => error.code === 'archived_type',
        );
        expect(issue).toBeDefined();
        expect(issue!.field).toBe('proposals[0].updates.key');
        expect(issue!.layer).toBe('referential');
      });

      it('accepts an exact stable-key CREATE as restoration of the retained row', async () => {
        const archivedRegistry =
          await createWarmWorkItemTypeRegistryWithCustomTypes([
            {
              typeKey: 'MARKETING',
              projectId: testIds.project,
              name: 'Marketing',
              lifecycleStatus: 'archived',
              sectionDefinitions: [{ key: 'audience', label: 'Audience' }],
              allowedStatuses: ['BACKLOG', 'ACTIVE', 'COMPLETED'] as any,
            },
          ]);
        const archivedSummary = archivedRegistry.getDefinition(
          testIds.project,
          'MARKETING',
        );
        expect(archivedSummary).toBeDefined();

        const archivedRegistryModule: TestingModule =
          await Test.createTestingModule({
            providers: [
              ProposalValidationEngine,
              WorkItemParentageValidator,
              { provide: PrismaService, useValue: mockPrisma },
              {
                provide: WorkItemTypeRegistryService,
                useValue: archivedRegistry,
              },
            ],
          }).compile();
        const archivedEngine =
          archivedRegistryModule.get<ProposalValidationEngine>(
            ProposalValidationEngine,
          );
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const result = await archivedEngine.validate({
          proposals: [
            makeCreateWorkItemTypeDto(undefined, {
              targetEntityId: 'MARKETING',
              updates: archivedSummary!.definition,
            }),
          ],
          context: makeContext(),
        });

        expect(result.valid).toBe(true);
        expect(result.proposals[0]!.errors).toHaveLength(0);
      });

      it('rejects a dangling parent reference with a valid-types message', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const dto = makeCreateWorkItemTypeDto({ allowedParentTypes: ['EPIC'] });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        const issue = result.proposals[0]!.errors.find(
          (e) => e.code === 'unrecognized_type',
        );
        expect(issue).toBeDefined();
        expect(issue!.layer).toBe('referential');
        expect(issue!.reason).toBe(
          "'EPIC' is not a usable type for this project. " +
            'Valid types: BUG, CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, FEATURE, GOAL, PLAN, PLAN_STAGE, STANDARD, TASK_MONITOR, workflow, workflow_step',
        );
      });

      it('rejects a dangling edge-target reference', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const dto = makeCreateWorkItemTypeDto({
          edgeTargets: [{ edgeType: 'TRACKS', targetTypeKeys: ['GHOST'] }],
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) => e.code === 'unrecognized_type' && e.reason.includes('GHOST'),
          ),
        ).toBe(true);
      });

      it('rejects a reference to an archived type', async () => {
        const archivedRegistryModule: TestingModule =
          await Test.createTestingModule({
            providers: [
              ProposalValidationEngine,
              WorkItemParentageValidator,
              { provide: PrismaService, useValue: mockPrisma },
              {
                provide: WorkItemTypeRegistryService,
                useValue: await createRegistryWithArchivedSystemType(
                  WORK_ITEM_TYPE_KEYS.Bug,
                ),
              },
            ],
          }).compile();
        const archivedEngine =
          archivedRegistryModule.get<ProposalValidationEngine>(
            ProposalValidationEngine,
          );
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        // BUG is archived in this registry, so referencing it is dangling and
        // it drops out of the valid-types list.
        const dto = makeCreateWorkItemTypeDto({ allowedParentTypes: ['BUG'] });

        const result = await archivedEngine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        const issue = result.proposals[0]!.errors.find(
          (e) => e.code === 'unrecognized_type' && e.reason.includes('BUG'),
        );
        expect(issue).toBeDefined();
        expect(issue!.reason).toContain(
          'Valid types: CONTRACT, DIAGRAM, DIAGRAM_ELEMENT, FEATURE, GOAL, PLAN, PLAN_STAGE, STANDARD, TASK_MONITOR, workflow, workflow_step',
        );
      });

      it('accepts MODE applicability declared with an active effective type key', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const result = await engine.validate({
          proposals: [
            makeCreateWorkItemTypeDto({
              key: WORK_ITEM_TYPE_KEYS.Mode,
              agentGuidance: {
                overview: 'A project-owned coding-agent behavior bundle.',
                contexts: [
                  {
                    focalTypeKeys: [WORK_ITEM_TYPE_KEYS.Standard],
                    guidance: 'Apply this mode to STANDARD work items.',
                  },
                ],
              },
            }),
          ],
          context: makeContext(),
        });

        expect(result.valid).toBe(true);
        expect(result.proposals[0]!.errors).toHaveLength(0);
      });

      it.each([
        ['unknown', 'NOT_A_TYPE'],
        ['archived', WORK_ITEM_TYPE_KEYS.Bug],
      ] as const)(
        'rejects MODE applicability for an %s effective type key',
        async (kind, typeKey) => {
          const registry =
            kind === 'archived'
              ? await createRegistryWithArchivedSystemType(
                  WORK_ITEM_TYPE_KEYS.Bug,
                )
              : await createWarmWorkItemTypeRegistry();
          const scopedModule: TestingModule = await Test.createTestingModule({
            providers: [
              ProposalValidationEngine,
              WorkItemParentageValidator,
              { provide: PrismaService, useValue: mockPrisma },
              {
                provide: WorkItemTypeRegistryService,
                useValue: registry,
              },
            ],
          }).compile();
          const scopedEngine = scopedModule.get<ProposalValidationEngine>(
            ProposalValidationEngine,
          );
          mockPrisma.db.project.findFirst.mockResolvedValue({
            id: testIds.project,
          });

          const result = await scopedEngine.validate({
            proposals: [
              makeCreateWorkItemTypeDto({
                key: WORK_ITEM_TYPE_KEYS.Mode,
                agentGuidance: {
                  overview: 'A project-owned coding-agent behavior bundle.',
                  contexts: [
                    {
                      focalTypeKeys: [typeKey],
                      guidance: 'Apply this mode to the selected work items.',
                    },
                  ],
                },
              }),
            ],
            context: makeContext(),
          });

          expect(result.valid).toBe(false);
          expect(
            result.proposals[0]!.errors.some(
              (error) =>
                error.code === 'unrecognized_type' &&
                error.field.includes(
                  'agentGuidance.contexts[0].focalTypeKeys[0]',
                ),
            ),
          ).toBe(true);
        },
      );

      it('allows a self-reference to the key being created', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        // MARKETING does not exist yet, but its child-owned parent declaration
        // may self-reference; that reference is forward-valid, not dangling.
        const dto = makeCreateWorkItemTypeDto({
          key: 'MARKETING',
          allowedParentTypes: ['MARKETING'],
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(
          result.proposals[0]!.errors.some(
            (e) => e.code === 'unrecognized_type',
          ),
        ).toBe(false);
      });

      it('passes a well-formed definition referencing only active types and bypasses target lookup', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const dto = makeCreateWorkItemTypeDto({
          key: 'MARKETING',
          allowedParentTypes: ['FEATURE'],
          edgeTargets: [{ edgeType: 'TRACKS', targetTypeKeys: ['FEATURE'] }],
        });

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(true);
        expect(result.proposals[0]!.errors).toHaveLength(0);
        // CREATE never looks up a pre-existing target row.
        expect(mockPrisma.db.task.findFirst).not.toHaveBeenCalled();
      });

      it('rejects a malformed work-item-type edit request', async () => {
        const dto: CreateProposalDto = {
          type: 'SINGLE',
          action: 'UPDATE',
          targetEntityId: 'MARKETING',
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: { definition: { key: 'MARKETING' } },
        };

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some((e) =>
            e.field.includes('updates.definition.name'),
          ),
        ).toBe(true);
      });

      it('rejects a malformed work-item-type archive request', async () => {
        const dto: CreateProposalDto = {
          type: 'SINGLE',
          action: 'DELETE',
          targetEntityId: 'MARKETING',
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: { reason: 42 },
        };

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some((e) =>
            e.field.includes('updates.reason'),
          ),
        ).toBe(true);
      });

      it('allows cascade delete review for an archived custom row', async () => {
        const lifecycleStatus = 'archived';
        const customRegistry =
          await createWarmWorkItemTypeRegistryWithCustomTypes([
            {
              typeKey: 'MARKETING',
              projectId: testIds.project,
              name: 'Marketing',
              lifecycleStatus,
              sectionDefinitions: [
                { key: 'description', label: 'Description' },
              ],
            },
          ]);
        const customModule = await Test.createTestingModule({
          providers: [
            ProposalValidationEngine,
            WorkItemParentageValidator,
            { provide: PrismaService, useValue: mockPrisma },
            {
              provide: WorkItemTypeRegistryService,
              useValue: customRegistry,
            },
          ],
        }).compile();
        const customEngine = customModule.get(ProposalValidationEngine);
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const result = await customEngine.validate({
          proposals: [makeCascadeDeleteWorkItemTypeDto()],
          context: makeContext(),
        });

        expect(result.proposals[0]!.errors).toEqual([]);
        expect(result.valid).toBe(true);
      });

      it('rejects cascade delete review for an active custom row', async () => {
        const customRegistry =
          await createWarmWorkItemTypeRegistryWithCustomTypes([
            {
              typeKey: 'MARKETING',
              projectId: testIds.project,
              name: 'Marketing',
              lifecycleStatus: 'active',
              sectionDefinitions: [
                { key: 'description', label: 'Description' },
              ],
            },
          ]);
        const customModule = await Test.createTestingModule({
          providers: [
            ProposalValidationEngine,
            WorkItemParentageValidator,
            { provide: PrismaService, useValue: mockPrisma },
            {
              provide: WorkItemTypeRegistryService,
              useValue: customRegistry,
            },
          ],
        }).compile();
        const customEngine = customModule.get(ProposalValidationEngine);
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const result = await customEngine.validate({
          proposals: [makeCascadeDeleteWorkItemTypeDto()],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(result.proposals[0]!.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'type_must_be_archived' }),
          ]),
        );
      });

      it.each([
        ['missing', 'MARKETING', 'entity_not_found'],
        ['canonical', WORK_ITEM_TYPE_KEYS.Standard, 'canonical_type_read_only'],
      ])(
        'rejects %s cascade targets before review',
        async (_name, targetEntityId, expectedCode) => {
          mockPrisma.db.project.findFirst.mockResolvedValue({
            id: testIds.project,
          });

          const result = await engine.validate({
            proposals: [makeCascadeDeleteWorkItemTypeDto({}, targetEntityId)],
            context: makeContext(),
          });

          expect(result.valid).toBe(false);
          expect(
            result.proposals[0]!.errors.some(
              (error) => error.code === expectedCode,
            ),
          ).toBe(true);
        },
      );

      it('keeps non-cascade delete as archive and rejects an archived row', async () => {
        const archivedRegistry =
          await createWarmWorkItemTypeRegistryWithCustomTypes([
            {
              typeKey: 'MARKETING',
              projectId: testIds.project,
              name: 'Marketing',
              lifecycleStatus: 'archived',
              sectionDefinitions: [
                { key: 'description', label: 'Description' },
              ],
            },
          ]);
        const archivedModule = await Test.createTestingModule({
          providers: [
            ProposalValidationEngine,
            WorkItemParentageValidator,
            { provide: PrismaService, useValue: mockPrisma },
            {
              provide: WorkItemTypeRegistryService,
              useValue: archivedRegistry,
            },
          ],
        }).compile();
        const archivedEngine = archivedModule.get(ProposalValidationEngine);
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const result = await archivedEngine.validate({
          proposals: [
            {
              type: 'SINGLE',
              action: 'DELETE',
              targetEntityId: 'MARKETING',
              targetEntityType: 'WORK_ITEM_TYPE',
              updates: {},
            },
          ],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (error) => error.code === 'archived_type',
          ),
        ).toBe(true);
      });

      it('rejects an edit that references an inactive type', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        const definition = makeCreateWorkItemTypeDto({
          allowedParentTypes: ['MISSING_TYPE'],
        }).updates;
        const dto: CreateProposalDto = {
          type: 'SINGLE',
          action: 'UPDATE',
          targetEntityId: 'MARKETING',
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: { definition },
        };

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) => e.code === 'unrecognized_type',
          ),
        ).toBe(true);
      });

      it.each([['missing', 'MARKETING', undefined, 'entity_not_found']])(
        'rejects %s lifecycle edit targets before review',
        async (_name, targetEntityId, _registry, expectedCode) => {
          mockPrisma.db.project.findFirst.mockResolvedValue({
            id: testIds.project,
          });
          const dto: CreateProposalDto = {
            type: 'SINGLE',
            action: 'UPDATE',
            targetEntityId,
            targetEntityType: 'WORK_ITEM_TYPE',
            updates: {
              definition: {
                key: targetEntityId,
                name: targetEntityId,
                role: 'work-item',
                sections: [{ key: 'description', label: 'Description' }],
                allowedStatuses: ['BACKLOG'],
              },
            },
          };

          const result = await engine.validate({
            proposals: [dto],
            context: makeContext(),
          });

          expect(result.valid).toBe(false);
          expect(
            result.proposals[0]!.errors.some((e) => e.code === expectedCode),
          ).toBe(true);
        },
      );

      it.each(['CANONICAL', 'CANONICAL_OVERRIDE'] as const)(
        'rejects color on %s before review',
        async (effectiveSource) => {
          mockPrisma.db.project.findFirst.mockResolvedValue({
            id: testIds.project,
          });
          const registry = (
            engine as unknown as {
              workItemTypeRegistry: WorkItemTypeRegistryService;
            }
          ).workItemTypeRegistry;
          const canonical = registry.getDefinition(
            testIds.project,
            WORK_ITEM_TYPE_KEYS.Standard,
          )!;
          jest
            .spyOn(registry, 'getDefinition')
            .mockReturnValue({ ...canonical, effectiveSource });
          const dto: CreateProposalDto = {
            type: 'SINGLE',
            action: 'UPDATE',
            targetEntityId: WORK_ITEM_TYPE_KEYS.Standard,
            targetEntityType: 'WORK_ITEM_TYPE',
            updates: {
              definition: { ...canonical.definition, colorKey: 'primary' },
              acknowledgeCanonicalCustomization: true,
            },
          };
          const result = await engine.validate({
            proposals: [dto],
            context: makeContext(),
          });
          expect(result.valid).toBe(false);
          expect(
            result.proposals[0]!.errors.some(
              (error) => error.code === 'canonical_color_read_only',
            ),
          ).toBe(true);
        },
      );

      it('requires acknowledgement before editing a canonical definition', async () => {
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        const registry = (
          engine as unknown as {
            workItemTypeRegistry: WorkItemTypeRegistryService;
          }
        ).workItemTypeRegistry;
        const canonical = registry.getDefinition(
          testIds.project,
          WORK_ITEM_TYPE_KEYS.Standard,
        )!;
        jest.spyOn(registry, 'getDefinition').mockReturnValue({
          ...canonical,
          effectiveSource: WorkItemTypeEffectiveSource.Canonical,
        });
        const dto: CreateProposalDto = {
          type: 'SINGLE',
          action: 'UPDATE',
          targetEntityId: WORK_ITEM_TYPE_KEYS.Standard,
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: { definition: canonical.definition },
        };

        const result = await engine.validate({
          proposals: [dto],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (error) =>
              error.code === 'canonical_customization_acknowledgement_required',
          ),
        ).toBe(true);
      });

      it('rejects stale archived restoration definitions before review', async () => {
        const archivedRegistry =
          await createWarmWorkItemTypeRegistryWithCustomTypes([
            {
              typeKey: 'MARKETING',
              projectId: testIds.project,
              name: 'Marketing',
              lifecycleStatus: 'archived',
              sectionDefinitions: [
                { key: 'description', label: 'Description' },
              ],
              allowedStatuses: ['BACKLOG', 'ACTIVE', 'COMPLETED'] as any,
            },
          ]);
        const archivedRegistryModule: TestingModule =
          await Test.createTestingModule({
            providers: [
              ProposalValidationEngine,
              WorkItemParentageValidator,
              { provide: PrismaService, useValue: mockPrisma },
              {
                provide: WorkItemTypeRegistryService,
                useValue: archivedRegistry,
              },
            ],
          }).compile();
        const archivedEngine =
          archivedRegistryModule.get<ProposalValidationEngine>(
            ProposalValidationEngine,
          );
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });

        const result = await archivedEngine.validate({
          proposals: [
            {
              type: 'SINGLE',
              action: 'UPDATE',
              targetEntityId: 'MARKETING',
              targetEntityType: 'WORK_ITEM_TYPE',
              updates: {
                definition: {
                  key: 'MARKETING',
                  name: 'Marketing',
                  role: 'work-item',
                  sections: [{ key: 'description', label: 'Description' }],
                  allowedStatuses: ['BACKLOG'],
                },
              },
            },
          ],
          context: makeContext(),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) => e.code === 'stale_work_item_type_definition',
          ),
        ).toBe(true);
      });

      it('accepts authorable custom type semantic edits', async () => {
        const customRegistry =
          await createWarmWorkItemTypeRegistryWithCustomTypes([
            {
              typeKey: 'MARKETING',
              projectId: testIds.project,
              name: 'Marketing',
              sectionDefinitions: [
                {
                  key: 'payload',
                  label: 'Payload',
                  kind: 'json',
                  schemaRef:
                    '#/components/schemas/TaskMonitorExecutionDefinition',
                },
              ],
              allowedStatuses: ['BACKLOG', 'ACTIVE', 'COMPLETED'] as any,
            },
          ]);
        const customModule = await Test.createTestingModule({
          providers: [
            ProposalValidationEngine,
            WorkItemParentageValidator,
            { provide: PrismaService, useValue: mockPrisma },
            { provide: WorkItemTypeRegistryService, useValue: customRegistry },
          ],
        }).compile();
        const customEngine = customModule.get<ProposalValidationEngine>(
          ProposalValidationEngine,
        );
        mockPrisma.db.project.findFirst.mockResolvedValue({
          id: testIds.project,
        });
        const existing = customRegistry.getDefinition(
          testIds.project,
          'MARKETING',
        )!;

        const result = await customEngine.validate({
          proposals: [
            {
              type: 'SINGLE',
              action: 'UPDATE',
              targetEntityId: 'MARKETING',
              targetEntityType: 'WORK_ITEM_TYPE',
              updates: {
                definition: {
                  ...existing.definition,
                  name: 'Campaign',
                  description: 'Campaign planning work',
                  allowedStatuses: ['BACKLOG', 'COMPLETED'],
                },
              },
            },
          ],
          context: makeContext(),
        });

        expect(result.valid).toBe(true);
      });

      it('rejects a work-item-type proposal without project context', async () => {
        const dto = makeCreateWorkItemTypeDto();
        const result = await engine.validate({
          proposals: [dto],
          context: makeContext({ projectId: undefined as never }),
        });

        expect(result.valid).toBe(false);
        expect(
          result.proposals[0]!.errors.some(
            (e) => e.code === 'project_not_found',
          ),
        ).toBe(true);
      });
    });
  });
});

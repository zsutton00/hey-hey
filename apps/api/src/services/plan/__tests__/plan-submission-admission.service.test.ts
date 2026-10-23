import { MutableContext } from 'src/utils/mutable-context';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, PlanId, ProjectId, UserId } from 'src/types';
import type { WorkItemChangeSetProjectorService } from '../../proposal/work-item-change-set-projector.service';
import { PlanSubmissionAdmissionService } from '../plan-submission-admission.service';

describe('PlanSubmissionAdmissionService', () => {
  const organizationId =
    '11111111-1111-4111-8111-111111111111' as OrganizationId;
  const projectId = '22222222-2222-4222-8222-222222222222' as ProjectId;
  const planId = '33333333-3333-4333-8333-333333333333' as PlanId;
  const stageId = '44444444-4444-4444-8444-444444444444';
  const otherStageId = '55555555-5555-4555-8555-555555555555';
  const serviceId = '66666666-6666-4666-8666-666666666666';
  const stepId = '77777777-7777-4777-8777-777777777777';
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UserId;

  const step = (overrides: Record<string, unknown> = {}) => ({
    id: stepId,
    stageId,
    title: '  Build admission  ',
    description: '  Validate before completion  ',
    implementation: '  Edit src/example.ts  ',
    type: 'TASK' as const,
    acceptanceCriteria: '  - accepted  ',
    sequenceOrder: 4,
    serviceIds: [serviceId],
    designDocMotivation: '  Required by the design  ',
    ...overrides,
  });

  let project: jest.Mock;
  let serviceFindMany: jest.Mock;
  let taskFindFirst: jest.Mock;
  let conversationFindFirst: jest.Mock;
  let messageFindFirst: jest.Mock;
  let messageFindMany: jest.Mock;
  let admission: PlanSubmissionAdmissionService;

  beforeEach(() => {
    serviceFindMany = jest.fn().mockResolvedValue([{ id: serviceId }]);
    taskFindFirst = jest.fn().mockResolvedValue({ id: planId });
    conversationFindFirst = jest
      .fn()
      .mockResolvedValue({ id: '88888888-8888-4888-8888-888888888888' });
    messageFindFirst = jest.fn().mockResolvedValue({
      data: {
        triggersAgent: {
          promptType: 'plan_shaping_phase_breakdown',
          nodeId: 'plan-shaping-phase-breakdown',
          payload: {
            planId,
            stageIdx: 0,
            phaseIdx: 0,
            journeyStep: { stageId },
          },
        },
      },
    });
    messageFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      db: {
        task: { findFirst: taskFindFirst },
        conversation: { findFirst: conversationFindFirst },
        message: {
          findFirst: messageFindFirst,
          findMany: messageFindMany,
        },
        service: { findMany: serviceFindMany },
      },
    } as unknown as PrismaService;
    project = jest.fn().mockImplementation(({ request }) => {
      const creates = request.operations.filter(
        (operation: { op: string }) => operation.op === 'workItem.create',
      );
      const identities = creates.map(
        (operation: { ref: { tempId: string } }) => operation.ref.tempId,
      );
      const duplicate = identities.find(
        (identity: string, index: number) =>
          identities.indexOf(identity) !== index,
      );
      const blank = request.operations.find(
        (operation: { op: string; content?: unknown }) =>
          operation.op === 'section.replace' &&
          typeof operation.content === 'string' &&
          operation.content.trim().length === 0,
      );
      const outsidePlan = creates.find(
        (operation: { parent?: { id?: string } }) =>
          operation.parent?.id !== stageId,
      );
      const issues = [
        ...(duplicate
          ? [
              {
                field: `nodes.temporary:${duplicate}`,
                code: 'duplicate_identity',
                reason: 'Duplicate handle.',
                layer: 'structural',
              },
            ]
          : []),
        ...(blank
          ? [
              {
                field: 'nodes.section',
                code: 'missing_required_section',
                reason: 'Required content is blank.',
                layer: 'referential',
              },
            ]
          : []),
        ...(outsidePlan
          ? [
              {
                field: 'nodes.parent',
                code: 'invalid_parent',
                reason: 'Stage is outside the Plan.',
                layer: 'structural',
              },
            ]
          : []),
      ];
      return {
        valid: issues.length === 0,
        projectedRoot: null,
        children: [],
        sections: [],
        incidentRelationships: [],
        identityLabels: {},
        issues,
      };
    });
    admission = new PlanSubmissionAdmissionService(prisma, {
      project,
    } as unknown as WorkItemChangeSetProjectorService);
  });

  const prepare = (overrides: Record<string, unknown> = {}) =>
    admission.prepare({
      organizationId,
      projectId,
      planId,
      kind: 'phase_breakdown',
      submission: {
        stageIdx: 0,
        phaseIdx: 0,
        plan: { steps: [step()] },
      },
      accumulatedPhases: {},
      expectedStageId: stageId,
      expectedStageIdx: 0,
      expectedPhaseIdx: 0,
      ...overrides,
    });

  it('preserves cross-phase prerequisites through normalization and complete stage replacement', async () => {
    const dependentId = otherStageId;
    const retained = { 0: { 0: { steps: [step()] } } };
    const drafted = await prepare({
      accumulatedPhases: retained,
      expectedPhaseIdx: 1,
      submission: {
        stageIdx: 0,
        phaseIdx: 1,
        plan: {
          steps: [step({ id: dependentId, dependsOnStepIds: [stepId] })],
        },
      },
    });
    if ('findings' in drafted) throw new Error('expected acceptance');
    expect(drafted.submission.plan.steps[0]?.dependsOnStepIds).toEqual([
      stepId,
    ]);
    expect(drafted.changeSet.operations).toContainEqual({
      op: 'relationship.create',
      ref: {
        refType: 'temporary',
        tempId: `journey-dependency:${dependentId}:${stepId}:0`,
      },
      source: { refType: 'temporary', tempId: `journey-task:${dependentId}` },
      target: { refType: 'temporary', tempId: `journey-task:${stepId}` },
      edgeType: 'DEPENDS_ON',
      category: 'meta',
    });
    const mergedId = userId;
    const reviewed = await prepare({
      kind: 'step_review',
      accumulatedPhases: drafted.accumulatedPhases,
      submission: {
        stageIdx: 0,
        plan: {
          steps: [
            step({ id: mergedId }),
            step({ id: dependentId, dependsOnStepIds: [mergedId] }),
          ],
        },
      },
    });
    if ('findings' in reviewed) throw new Error('expected acceptance');
    expect(reviewed.accumulatedPhases[0]?.[1]).toBeUndefined();
    expect(
      reviewed.changeSet.operations.filter(
        (op) => op.op === 'relationship.create',
      ),
    ).toEqual([
      expect.objectContaining({
        target: { refType: 'temporary', tempId: `journey-task:${mergedId}` },
      }),
    ]);
    expect(
      admission.buildChangeSet(planId, reviewed.accumulatedPhases),
    ).toEqual(reviewed.changeSet);
  });

  it('leaves ordered independent steps without dependency operations', () => {
    const result = admission.buildChangeSet(planId, {
      0: {
        0: { steps: [step(), step({ id: otherStageId, sequenceOrder: 5 })] },
      },
    });
    expect(
      result.operations.filter((op) => op.op === 'relationship.create'),
    ).toEqual([]);
  });

  it('returns stable normalized input and projects the same change set used for materialization', async () => {
    const result = await prepare();
    expect(result).not.toHaveProperty('findings');
    if ('findings' in result) throw new Error('expected acceptance');
    expect(result.submission.plan.steps[0]).toMatchObject({
      title: 'Build admission',
      description: 'Validate before completion',
      implementation: 'Edit src/example.ts',
      acceptanceCriteria: '- accepted',
      designDocMotivation: 'Required by the design',
      sequenceOrder: 0,
    });
    expect(project).toHaveBeenCalledWith(
      expect.objectContaining({ request: result.changeSet }),
    );
    await expect(
      admission.prepare({
        organizationId,
        projectId,
        planId,
        kind: 'phase_breakdown',
        submission: result.submission,
        accumulatedPhases: {},
        expectedStageId: stageId,
        expectedStageIdx: 0,
        expectedPhaseIdx: 0,
      }),
    ).resolves.not.toHaveProperty('findings');
  });

  it.each([false, true])(
    'prepares a second phase from tracked context without mutations (rejected: %s)',
    async (reject) => {
      const original = { accumulatedPhases: { 0: { 0: { steps: [step()] } } } };
      const before = JSON.parse(JSON.stringify(original));
      const tracker = new MutableContext(original);
      const result = await prepare({
        accumulatedPhases: tracker.getContext().accumulatedPhases,
        expectedPhaseIdx: 1,
        submission: {
          stageIdx: 0,
          phaseIdx: 1,
          plan: { steps: [step({ id: reject ? stepId : otherStageId })] },
        },
      });
      expect('findings' in result).toBe(reject);
      if ('findings' in result) {
        expect(result.findings).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ code: 'duplicate_identity' }),
          ]),
        );
      } else {
        expect(result.accumulatedPhases[0]?.[0]).toEqual(
          before.accumulatedPhases[0][0],
        );
        expect(result.accumulatedPhases[0]?.[1]?.steps[0]?.id).toBe(
          otherStageId,
        );
      }
      expect(original).toEqual(before);
      expect(tracker.getPatch()).toEqual([]);
    },
  );

  it.each(['phase_breakdown', 'step_review'] as const)(
    'preserves tracked state when rejecting a %s replacement',
    async (kind) => {
      const original = { accumulatedPhases: { 0: { 0: { steps: [step()] } } } };
      const before = JSON.parse(JSON.stringify(original));
      const tracker = new MutableContext(original);
      project.mockResolvedValueOnce({
        issues: [
          { field: 'nodes', code: 'invalid_parent', reason: 'Invalid parent' },
        ],
      });
      const result = await prepare({
        kind,
        accumulatedPhases: tracker.getContext().accumulatedPhases,
        submission: {
          stageIdx: 0,
          ...(kind === 'phase_breakdown' ? { phaseIdx: 0 } : {}),
          plan: { steps: [step({ title: 'Replacement' })] },
        },
      });
      expect(result).toHaveProperty('findings');
      expect(original).toEqual(before);
      expect(tracker.getPatch()).toEqual([]);
    },
  );

  it('normalizes tracked accumulation without modifying accepted Service assignments', async () => {
    const original = {
      accumulatedPhases: {
        0: {
          0: {
            steps: [step({ serviceIds: [serviceId, otherStageId, serviceId] })],
          },
        },
      },
    };
    const before = JSON.parse(JSON.stringify(original));
    const tracker = new MutableContext(original);
    const result = await admission.prepareAccumulated({
      organizationId,
      projectId,
      planId,
      accumulatedPhases: tracker.getContext().accumulatedPhases,
    });
    expect(result).not.toHaveProperty('findings');
    if ('findings' in result) throw new Error('expected acceptance');
    expect(
      result.changeSet.operations.find(
        (operation) => operation.op === 'workItem.create',
      ),
    ).toEqual(expect.objectContaining({ serviceIds: [serviceId, serviceId] }));
    expect(original).toEqual(before);
    expect(tracker.getPatch()).toEqual([]);
  });

  it('reconstructs retained accepted buckets before admitting a replacement', async () => {
    messageFindMany.mockResolvedValue([
      {
        data: {
          completesExternalAgentNode: {
            nodeId: 'plan-shaping-phase-breakdown',
            action: 'DONE',
            payload: {
              stageIdx: 1,
              phaseIdx: 0,
              plan: { steps: [step()] },
            },
          },
        },
      },
    ]);

    const result = await admission.admit({
      organizationId,
      projectId,
      planId,
      userId,
      request: {
        kind: 'phase_breakdown',
        conversationId: '88888888-8888-4888-8888-888888888888',
        triggerMessageId: '99999999-9999-4999-8999-999999999999',
        submission: {
          stageIdx: 0,
          phaseIdx: 0,
          plan: { steps: [step()] },
        },
      },
    });

    expect(result).toMatchObject({
      status: 'rejected',
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_identity' }),
      ]),
    });
  });

  it('scopes admission to the current user Plan-generation conversation', async () => {
    await admission.admit({
      organizationId,
      projectId,
      planId,
      userId,
      request: {
        kind: 'phase_breakdown',
        conversationId: '88888888-8888-4888-8888-888888888888',
        triggerMessageId: '99999999-9999-4999-8999-999999999999',
        submission: {
          stageIdx: 0,
          phaseIdx: 0,
          plan: { steps: [step()] },
        },
      },
    });

    expect(conversationFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workflowName: 'plan-from-design-doc',
        workflowAboutId: planId,
        agentSessions: {
          some: expect.objectContaining({
            userId,
            type: 'PLAN_GENERATION',
          }),
        },
      }),
      select: { id: true },
    });
  });

  it('rejects a request outside the OpenAPI union before querying persistence', async () => {
    const result = await admission.admit({
      organizationId,
      projectId,
      planId,
      userId,
      request: {
        kind: 'unexpected',
        conversationId: 'not-a-uuid',
        triggerMessageId: 'also-not-a-uuid',
        submission: { stageIdx: 0, plan: { steps: [] } },
      } as never,
    });

    expect(result).toMatchObject({
      status: 'rejected',
      findings: expect.arrayContaining([
        expect.objectContaining({ field: '/kind' }),
      ]),
    });
    expect(taskFindFirst).not.toHaveBeenCalled();
    expect(conversationFindFirst).not.toHaveBeenCalled();
    expect(messageFindFirst).not.toHaveBeenCalled();
  });

  it('binds an empty drafted step-review bucket through the approved journey map', async () => {
    messageFindFirst.mockResolvedValue({
      data: {
        triggersAgent: {
          promptType: 'plan_shaping_step_review',
          nodeId: 'plan-shaping-step-review',
          payload: { planId, stageIdx: 0, steps: [] },
        },
      },
    });
    messageFindMany.mockResolvedValue([
      {
        data: {
          completesExternalAgentNode: {
            nodeId: 'plan-shaping-journey-map',
            action: 'APPROVED',
            payload: {
              journeyMap: {
                steps: [{ stageId }, { stageId }, { stageId: otherStageId }],
              },
            },
          },
        },
      },
    ]);

    const result = await admission.admit({
      organizationId,
      projectId,
      planId,
      userId,
      request: {
        kind: 'step_review',
        conversationId: '88888888-8888-4888-8888-888888888888',
        triggerMessageId: '99999999-9999-4999-8999-999999999999',
        submission: {
          stageIdx: 0,
          plan: { steps: [step({ stageId: otherStageId })] },
        },
      },
    });

    expect(result).toMatchObject({
      status: 'rejected',
      findings: [expect.objectContaining({ code: 'wrong_active_stage' })],
    });
    expect(project).not.toHaveBeenCalled();
  });

  it('excludes the replaced bucket while retaining other buckets for duplicate checks', async () => {
    const replacement = await prepare({
      accumulatedPhases: { 0: { 0: { steps: [step()] } } },
    });
    expect(replacement).not.toHaveProperty('findings');

    const collision = await prepare({
      accumulatedPhases: {
        0: { 0: { steps: [step()] } },
        1: { 0: { steps: [step()] } },
      },
    });
    expect('findings' in collision && collision.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_identity' }),
      ]),
    );
  });

  it('rejects a stage from the same Plan when it is not the active cursor stage', async () => {
    const result = await prepare({
      submission: {
        stageIdx: 0,
        phaseIdx: 0,
        plan: { steps: [step({ stageId: otherStageId })] },
      },
    });
    expect(result).toMatchObject({
      findings: [expect.objectContaining({ code: 'wrong_active_stage' })],
    });
    expect(project).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only required content at the contract boundary', async () => {
    const result = await prepare({
      submission: {
        stageIdx: 0,
        phaseIdx: 0,
        plan: { steps: [step({ acceptanceCriteria: '   ' })] },
      },
    });
    expect(result).toMatchObject({
      findings: [expect.objectContaining({ code: 'too_small' })],
    });
    expect(project).not.toHaveBeenCalled();
  });

  it.each([
    'title',
    'description',
    'implementation',
    'acceptanceCriteria',
    'designDocMotivation',
  ])('rejects whitespace-only %s before projection', async (field) => {
    const result = await prepare({
      submission: {
        stageIdx: 0,
        phaseIdx: 0,
        plan: { steps: [step({ [field]: '   ' })] },
      },
    });

    expect(result).toMatchObject({
      findings: [
        expect.objectContaining({
          field: `/plan/steps/0/${field}`,
          code: 'too_small',
        }),
      ],
    });
    expect(project).not.toHaveBeenCalled();
  });

  it('rejects a Stage outside the canonical Plan through authoritative projection', async () => {
    const result = await prepare({
      expectedStageId: otherStageId,
      submission: {
        stageIdx: 0,
        phaseIdx: 0,
        plan: { steps: [step({ stageId: otherStageId })] },
      },
    });
    expect(result).toMatchObject({
      findings: [expect.objectContaining({ code: 'invalid_parent' })],
    });
  });

  it.each([
    {
      name: 'missing coverage',
      supplied: undefined,
      available: [{ id: serviceId }],
      expected: undefined,
      advisories: ['missing_service_coverage'],
    },
    {
      name: 'an empty array',
      supplied: [],
      available: [{ id: serviceId }],
      expected: [],
      advisories: ['empty_service_coverage'],
    },
    {
      name: 'an invalid project Service',
      supplied: ['99999999-9999-4999-8999-999999999999'],
      available: [],
      expected: [],
      advisories: ['service_assignment_omitted'],
    },
    {
      name: 'mixed valid and invalid Services',
      supplied: [serviceId, '99999999-9999-4999-8999-999999999999'],
      available: [{ id: serviceId }],
      expected: [serviceId],
      advisories: ['service_assignment_omitted'],
    },
    {
      name: 'repeated valid Services',
      supplied: [serviceId, serviceId],
      available: [{ id: serviceId }],
      expected: [serviceId, serviceId],
      advisories: ['duplicate_service_reference'],
    },
  ])(
    'accepts $name and preserves the normalized array-shaped representation',
    async ({ supplied, available, expected, advisories }) => {
      serviceFindMany.mockResolvedValue(available);
      const result = await prepare({
        submission: {
          stageIdx: 0,
          phaseIdx: 0,
          plan: { steps: [step({ serviceIds: supplied })] },
        },
      });

      expect(result).not.toHaveProperty('findings');
      if ('findings' in result) throw new Error('expected acceptance');
      expect(result.submission.plan.steps[0]?.serviceIds).toEqual(expected);
      expect(result.advisories.map((item) => item.code)).toEqual(advisories);
      expect(
        result.changeSet.operations.find(
          (operation) => operation.op === 'workItem.create',
        ),
      ).toEqual(
        expect.objectContaining(
          expected === undefined ? {} : { serviceIds: expected },
        ),
      );
      if (expected === undefined) {
        expect(
          result.changeSet.operations.find(
            (operation) => operation.op === 'workItem.create',
          ),
        ).not.toHaveProperty('serviceIds');
      }
    },
  );

  it('loads only active Services from the current organization and project', async () => {
    await prepare();

    expect(serviceFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: [serviceId] },
        organizationId,
        projectId,
        status: 'ACTIVE',
        archivedAt: null,
      },
      select: { id: true },
    });
  });

  it('normalizes a persisted accumulated payload before materialization', async () => {
    const invalidServiceId = '99999999-9999-4999-8999-999999999999';
    const accumulatedPhases = JSON.parse(
      JSON.stringify({
        0: {
          0: {
            steps: [
              step({
                serviceIds: [serviceId, invalidServiceId, serviceId],
              }),
            ],
          },
        },
      }),
    );

    const result = await admission.prepareAccumulated({
      organizationId,
      projectId,
      planId,
      accumulatedPhases,
    });

    expect(result).not.toHaveProperty('findings');
    if ('findings' in result) throw new Error('expected acceptance');
    expect(
      result.changeSet.operations.find(
        (operation) => operation.op === 'workItem.create',
      ),
    ).toEqual(expect.objectContaining({ serviceIds: [serviceId, serviceId] }));
    expect(result.advisories.map((item) => item.code)).toEqual([
      'duplicate_service_reference',
      'service_assignment_omitted',
    ]);
  });

  it('does not relabel projector outages as deterministic findings', async () => {
    const failure = new Error('projector unavailable');
    project.mockRejectedValue(failure);

    await expect(prepare()).rejects.toBe(failure);
  });
});

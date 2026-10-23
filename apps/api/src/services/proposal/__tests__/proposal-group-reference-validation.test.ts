import type { ProposalGroupDependency } from '@prisma/client';
import {
  ProposalGroupReferenceValidation,
  type ProposalGroupValidationMember,
} from '../proposal-group-reference-validation';

const GROUP_ID = '10000000-0000-4000-8000-000000000001';
const MEMBER_A = '10000000-0000-4000-8000-000000000002';
const MEMBER_B = '10000000-0000-4000-8000-000000000003';
const RESERVED_A = '10000000-0000-4000-8000-000000000004';
const RESERVED_B = '10000000-0000-4000-8000-000000000005';
const UNRELATED_USER = '10000000-0000-4000-8000-000000000006';
const UNRELATED_SESSION = '10000000-0000-4000-8000-000000000007';

function createMember(
  overrides: Partial<ProposalGroupValidationMember> & {
    id: string;
    reservedTargetEntityId: string | null;
  },
): ProposalGroupValidationMember {
  return {
    memberOrder: 0,
    proposal: {
      id: `${overrides.id}-proposal`,
      action: 'CREATE',
      targetEntityId: overrides.reservedTargetEntityId ?? RESERVED_A,
      targetEntityType: 'TASK',
      updates: {
        name: 'Member',
        initiativeId: '10000000-0000-4000-8000-000000000008',
      },
      edges: null,
    },
    ...overrides,
  };
}

function dependency(
  dependentMemberId: string,
  prerequisiteMemberId: string,
): ProposalGroupDependency {
  return {
    id: `${dependentMemberId}:${prerequisiteMemberId}`,
    groupId: GROUP_ID,
    dependentMemberId,
    prerequisiteMemberId,
    createdAt: new Date('2026-07-24T00:00:00.000Z'),
  };
}

describe('ProposalGroupReferenceValidation', () => {
  const validator = new ProposalGroupReferenceValidation();
  it('requires CREATE materialization ordering for reserved future completion targets', () => {
    const creator = createMember({
      id: MEMBER_A,
      reservedTargetEntityId: RESERVED_A,
    });
    const future = createMember({
      id: MEMBER_B,
      reservedTargetEntityId: null,
      proposal: {
        id: MEMBER_B,
        action: 'VERSIONED_UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: UNRELATED_USER,
        updates: {
          dependencies: [
            {
              edgeType: 'DEPENDS_ON',
              targetEntityType: 'TASK',
              targetEntityId: RESERVED_A,
            },
          ],
        },
        edges: null,
      },
    });
    expect(validator.validate([creator, future], []).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MEMBER_INVALID' }),
      ]),
    );
    expect(
      validator.validate([creator, future], [dependency(MEMBER_B, MEMBER_A)])
        .issues,
    ).toEqual([]);
  });
  it('does not infer enactment prerequisites from durable DEPENDS_ON declarations', () => {
    const member = createMember({
      id: MEMBER_A,
      reservedTargetEntityId: RESERVED_A,
    });
    member.proposal.edges = [
      {
        endpointMode: 'PROPOSAL',
        targetEntityType: 'PROPOSAL',
        targetEntityId: MEMBER_B,
        edgeType: 'DEPENDS_ON',
      },
    ];
    expect(validator.extractTypedReferences(member.proposal, 0)).toEqual([]);
  });

  it('extracts only supported typed entity-reference positions', () => {
    const member = createMember({
      id: MEMBER_A,
      reservedTargetEntityId: RESERVED_A,
      proposal: {
        id: 'proposal-a',
        action: 'CREATE',
        targetEntityId: RESERVED_A,
        targetEntityType: 'TASK',
        updates: {
          name: 'Child',
          initiativeId: '10000000-0000-4000-8000-000000000008',
          parentTaskId: RESERVED_B,
          assigneeId: UNRELATED_USER,
          workflowSteps: [
            {
              tempId: 'step',
              name: 'Step',
              assigneeId: UNRELATED_USER,
              serviceId: UNRELATED_SESSION,
            },
          ],
        },
        edges: null,
      },
    });

    expect(validator.extractTypedReferences(member.proposal, 0)).toEqual([
      {
        entityId: RESERVED_B,
        entityType: 'TASK',
        location: '/members/0/proposal/updates/parentTaskId',
      },
    ]);
  });

  it('accepts an exact typed-reference to prerequisite mapping', () => {
    const members = [
      createMember({
        id: MEMBER_A,
        memberOrder: 0,
        reservedTargetEntityId: RESERVED_A,
      }),
      createMember({
        id: MEMBER_B,
        memberOrder: 1,
        reservedTargetEntityId: RESERVED_B,
        proposal: {
          id: 'proposal-b',
          action: 'CREATE',
          targetEntityId: RESERVED_B,
          targetEntityType: 'TASK',
          updates: {
            name: 'Child',
            initiativeId: '10000000-0000-4000-8000-000000000008',
            parentTaskId: RESERVED_A,
          },
          edges: null,
        },
      }),
    ];

    expect(
      validator.validate(members, [dependency(MEMBER_B, MEMBER_A)]).issues,
    ).toEqual([]);
  });

  it('resolves grouped work-item-type key references to their reserved CREATE members', () => {
    const members = [
      createMember({
        id: MEMBER_A,
        memberOrder: 0,
        reservedTargetEntityId: RESERVED_A,
        proposal: {
          id: 'proposal-a',
          action: 'CREATE',
          targetEntityId: RESERVED_A,
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: {
            key: 'EPIC',
            name: 'Epic',
            sections: [],
            allowedStatuses: ['ACTIVE'],
          },
          edges: null,
        },
      }),
      createMember({
        id: MEMBER_B,
        memberOrder: 1,
        reservedTargetEntityId: RESERVED_B,
        proposal: {
          id: 'proposal-b',
          action: 'CREATE',
          targetEntityId: RESERVED_B,
          targetEntityType: 'WORK_ITEM_TYPE',
          updates: {
            key: 'STORY',
            name: 'Story',
            sections: [],
            allowedStatuses: ['ACTIVE'],
            allowedParentTypes: ['EPIC'],
          },
          edges: null,
        },
      }),
    ];

    expect(
      validator.validate(members, [dependency(MEMBER_B, MEMBER_A)]).issues,
    ).toEqual([]);
    expect(validator.extractTypedReferences(members[1]!.proposal, 1)).toEqual([
      {
        entityId: 'EPIC',
        entityType: 'WORK_ITEM_TYPE',
        location: '/members/1/proposal/updates/allowedParentTypes/0',
      },
    ]);
  });

  it('treats an UPDATE target using a reserved identity as a typed reference', () => {
    const members = [
      createMember({
        id: MEMBER_A,
        memberOrder: 0,
        reservedTargetEntityId: RESERVED_A,
      }),
      createMember({
        id: MEMBER_B,
        memberOrder: 1,
        reservedTargetEntityId: null,
        proposal: {
          id: 'proposal-b',
          action: 'UPDATE',
          targetEntityId: RESERVED_A,
          targetEntityType: 'TASK',
          updates: { name: 'Update after creation' },
          edges: null,
        },
      }),
    ];

    expect(
      validator.validate(members, [dependency(MEMBER_B, MEMBER_A)]).issues,
    ).toEqual([]);
    expect(validator.extractTypedReferences(members[1]!.proposal, 1)).toEqual([
      {
        entityId: RESERVED_A,
        entityType: 'TASK',
        location: '/members/1/proposal/targetEntityId',
      },
    ]);
  });

  it('reports both missing and extra prerequisites at the member field', () => {
    const members = [
      createMember({
        id: MEMBER_A,
        memberOrder: 0,
        reservedTargetEntityId: RESERVED_A,
      }),
      createMember({
        id: MEMBER_B,
        memberOrder: 1,
        reservedTargetEntityId: RESERVED_B,
        proposal: {
          id: 'proposal-b',
          action: 'CREATE',
          targetEntityId: RESERVED_B,
          targetEntityType: 'TASK',
          updates: {
            name: 'Independent',
            initiativeId: '10000000-0000-4000-8000-000000000008',
          },
          edges: null,
        },
      }),
    ];
    members[0]!.proposal.updates = {
      name: 'References B',
      initiativeId: '10000000-0000-4000-8000-000000000008',
      parentTaskId: RESERVED_B,
    };

    const issues = validator.validate(members, [
      dependency(MEMBER_B, MEMBER_A),
    ]).issues;

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MEMBER_INVALID',
          location: '/members/0/prerequisiteMemberIds',
          memberId: MEMBER_A,
        }),
        expect.objectContaining({
          code: 'MEMBER_INVALID',
          location: '/members/1/prerequisiteMemberIds',
          memberId: MEMBER_B,
        }),
      ]),
    );
  });

  it('rejects a reserved identity referenced through the wrong entity type', () => {
    const members = [
      createMember({
        id: MEMBER_A,
        memberOrder: 0,
        reservedTargetEntityId: RESERVED_A,
      }),
      createMember({
        id: MEMBER_B,
        memberOrder: 1,
        reservedTargetEntityId: RESERVED_B,
        proposal: {
          id: 'proposal-b',
          action: 'CREATE',
          targetEntityId: RESERVED_B,
          targetEntityType: 'DESIGN_DOC',
          updates: {
            name: 'Design doc',
            parentEntityType: 'DESIGN_DOC',
            parentEntityId: RESERVED_A,
          },
          edges: null,
        },
      }),
    ];

    expect(validator.validate(members, []).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MEMBER_REFERENCE_UNRESOLVED',
          location: '/members/1/proposal/updates/parentEntityId',
          memberId: MEMBER_B,
        }),
      ]),
    );
  });

  it('reports cycles and duplicate UPDATE targets', () => {
    const members = [
      createMember({
        id: MEMBER_A,
        memberOrder: 0,
        reservedTargetEntityId: RESERVED_A,
        proposal: {
          id: 'proposal-a',
          action: 'CREATE',
          targetEntityId: RESERVED_A,
          targetEntityType: 'TASK',
          updates: {
            name: 'A',
            initiativeId: '10000000-0000-4000-8000-000000000008',
            parentTaskId: RESERVED_B,
          },
          edges: null,
        },
      }),
      createMember({
        id: MEMBER_B,
        memberOrder: 1,
        reservedTargetEntityId: RESERVED_B,
        proposal: {
          id: 'proposal-b',
          action: 'CREATE',
          targetEntityId: RESERVED_B,
          targetEntityType: 'TASK',
          updates: {
            name: 'B',
            initiativeId: '10000000-0000-4000-8000-000000000008',
            parentTaskId: RESERVED_A,
          },
          edges: null,
        },
      }),
      createMember({
        id: '10000000-0000-4000-8000-000000000009',
        memberOrder: 2,
        reservedTargetEntityId: null,
        proposal: {
          id: 'proposal-update-1',
          action: 'UPDATE',
          targetEntityId: '10000000-0000-4000-8000-000000000010',
          targetEntityType: 'TASK',
          updates: { name: 'First' },
          edges: null,
        },
      }),
      createMember({
        id: '10000000-0000-4000-8000-000000000011',
        memberOrder: 3,
        reservedTargetEntityId: null,
        proposal: {
          id: 'proposal-update-2',
          action: 'UPDATE',
          targetEntityId: '10000000-0000-4000-8000-000000000010',
          targetEntityType: 'TASK',
          updates: { name: 'Second' },
          edges: null,
        },
      }),
    ];

    const issues = validator.validate(members, [
      dependency(MEMBER_A, MEMBER_B),
      dependency(MEMBER_B, MEMBER_A),
    ]).issues;

    expect(
      issues.filter((issue) => issue.code === 'PREREQUISITE_CYCLE'),
    ).toHaveLength(2);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MEMBER_INVALID',
          location: '/members/3/proposal/targetEntityId',
        }),
      ]),
    );
  });
});

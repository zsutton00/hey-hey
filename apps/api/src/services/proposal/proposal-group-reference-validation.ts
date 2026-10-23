import { Injectable, Logger } from '@nestjs/common';
import type { Proposal, ProposalGroupDependency } from '@prisma/client';
import type {
  ProposalEdgeDeclaration,
  ProposalGroupValidationIssue,
} from 'src/generated';

export interface ProposalGroupReference {
  entityId: string;
  entityType: string;
  location: string;
}

export interface ProposalGroupValidationMember {
  id: string;
  memberOrder: number;
  reservedTargetEntityId: string | null;
  proposal: Pick<
    Proposal,
    | 'id'
    | 'action'
    | 'targetEntityId'
    | 'targetEntityType'
    | 'updates'
    | 'edges'
  >;
}

export interface ProposalGroupReferenceValidationResult {
  issues: ProposalGroupValidationIssue[];
  referencesByMemberId: ReadonlyMap<string, ProposalGroupReference[]>;
}

type TypedReferenceCandidate = {
  value: unknown;
  entityType: string | undefined;
  path: string;
};

@Injectable()
export class ProposalGroupReferenceValidation {
  private readonly logger = new Logger(ProposalGroupReferenceValidation.name);

  validate(
    members: ProposalGroupValidationMember[],
    dependencies: ProposalGroupDependency[],
  ): ProposalGroupReferenceValidationResult {
    const issues: ProposalGroupValidationIssue[] = [];
    const memberById = new Map(members.map((member) => [member.id, member]));
    const reservationOwnerById = new Map<
      string,
      ProposalGroupValidationMember
    >();
    const workItemTypeOwnerByKey = new Map<
      string,
      ProposalGroupValidationMember
    >();
    const referencesByMemberId = new Map<string, ProposalGroupReference[]>();

    for (const [memberIndex, member] of members.entries()) {
      const reservation = member.reservedTargetEntityId;
      if (member.proposal.action === 'CREATE') {
        if (!reservation || reservation !== member.proposal.targetEntityId) {
          issues.push(
            this.issue(
              'RESERVED_ENTITY_ID_CONFLICT',
              `/members/${memberIndex}/reservedEntityId`,
              member.id,
              'CREATE members must own one reservation equal to the proposal target.',
            ),
          );
        } else if (reservationOwnerById.has(reservation)) {
          issues.push(
            this.issue(
              'RESERVED_ENTITY_ID_CONFLICT',
              `/members/${memberIndex}/reservedEntityId`,
              member.id,
              'The reserved entity identity is owned by more than one member.',
            ),
          );
        } else {
          reservationOwnerById.set(reservation, member);
          if (member.proposal.targetEntityType === 'WORK_ITEM_TYPE') {
            const updates = member.proposal.updates as Record<string, unknown>;
            if (typeof updates.key === 'string') {
              workItemTypeOwnerByKey.set(updates.key, member);
            }
          }
        }
      } else if (reservation !== null) {
        issues.push(
          this.issue(
            'RESERVED_ENTITY_ID_CONFLICT',
            `/members/${memberIndex}/reservedEntityId`,
            member.id,
            `${member.proposal.action} members cannot own CREATE reservations.`,
          ),
        );
      }

      referencesByMemberId.set(
        member.id,
        this.extractTypedReferences(member.proposal, memberIndex),
      );
    }

    const declaredPrerequisites = new Map<string, Set<string>>();
    for (const dependency of dependencies) {
      const dependentIndex = members.findIndex(
        (member) => member.id === dependency.dependentMemberId,
      );
      const location =
        dependentIndex >= 0
          ? `/members/${dependentIndex}/prerequisiteMemberIds`
          : '/members';
      if (
        !memberById.has(dependency.dependentMemberId) ||
        !memberById.has(dependency.prerequisiteMemberId)
      ) {
        issues.push(
          this.issue(
            'PREREQUISITE_MEMBER_NOT_FOUND',
            location,
            memberById.has(dependency.dependentMemberId)
              ? dependency.dependentMemberId
              : null,
            'Every prerequisite endpoint must be a member of this group.',
          ),
        );
        continue;
      }
      if (dependency.dependentMemberId === dependency.prerequisiteMemberId) {
        issues.push(
          this.issue(
            'PREREQUISITE_SELF_REFERENCE',
            location,
            dependency.dependentMemberId,
            'A member cannot depend on itself.',
          ),
        );
        continue;
      }
      const current =
        declaredPrerequisites.get(dependency.dependentMemberId) ??
        new Set<string>();
      current.add(dependency.prerequisiteMemberId);
      declaredPrerequisites.set(dependency.dependentMemberId, current);
    }

    for (const [memberIndex, member] of members.entries()) {
      const referencedPrerequisites = new Set<string>();
      for (const reference of referencesByMemberId.get(member.id) ?? []) {
        const owner =
          reservationOwnerById.get(reference.entityId) ??
          (reference.entityType === 'WORK_ITEM_TYPE'
            ? workItemTypeOwnerByKey.get(reference.entityId)
            : undefined);
        if (!owner) {
          continue;
        }
        if (owner.proposal.targetEntityType !== reference.entityType) {
          issues.push(
            this.issue(
              'MEMBER_REFERENCE_UNRESOLVED',
              reference.location,
              member.id,
              `The reserved identity belongs to ${owner.proposal.targetEntityType}, not ${reference.entityType}.`,
            ),
          );
          continue;
        }
        if (owner.id === member.id) {
          issues.push(
            this.issue(
              'MEMBER_REFERENCE_UNRESOLVED',
              reference.location,
              member.id,
              'A member cannot reference its own reserved entity identity.',
            ),
          );
          continue;
        }
        referencedPrerequisites.add(owner.id);
      }

      const declared =
        declaredPrerequisites.get(member.id) ?? new Set<string>();
      for (const requiredId of referencedPrerequisites) {
        if (!declared.has(requiredId)) {
          issues.push(
            this.issue(
              'MEMBER_INVALID',
              `/members/${memberIndex}/prerequisiteMemberIds`,
              member.id,
              `A reference to reserved member ${requiredId} requires that member in the complete prerequisite set.`,
            ),
          );
        }
      }
      for (const declaredId of declared) {
        if (!referencedPrerequisites.has(declaredId)) {
          issues.push(
            this.issue(
              'MEMBER_INVALID',
              `/members/${memberIndex}/prerequisiteMemberIds`,
              member.id,
              `Prerequisite member ${declaredId} has no matching typed reserved-entity reference.`,
            ),
          );
        }
      }
    }

    issues.push(...this.findCycles(members, declaredPrerequisites));
    issues.push(...this.findDuplicateUpdateTargets(members));

    this.logger.debug('Validated proposal-group reference graph', {
      memberCount: members.length,
      dependencyCount: dependencies.length,
      reservationCount: reservationOwnerById.size,
      referenceCount: [...referencesByMemberId.values()].reduce(
        (count, references) => count + references.length,
        0,
      ),
      issueCount: issues.length,
    });

    return { issues, referencesByMemberId };
  }

  extractTypedReferences(
    proposal: ProposalGroupValidationMember['proposal'],
    memberIndex: number,
  ): ProposalGroupReference[] {
    const updates =
      proposal.updates !== null && typeof proposal.updates === 'object'
        ? (proposal.updates as Record<string, unknown>)
        : {};
    const prefix = `/members/${memberIndex}/proposal`;
    const candidates: TypedReferenceCandidate[] = [];

    if (
      proposal.action === 'VERSIONED_UPDATE' &&
      Array.isArray(updates.dependencies)
    ) {
      updates.dependencies.forEach((dependency, index) => {
        candidates.push({
          value: dependency.targetEntityId,
          entityType: 'TASK',
          path: `${prefix}/updates/dependencies/${index}/targetEntityId`,
        });
      });
    }

    if (proposal.action !== 'CREATE') {
      candidates.push({
        value: proposal.targetEntityId,
        entityType: proposal.targetEntityType,
        path: `${prefix}/targetEntityId`,
      });
    }

    if (proposal.targetEntityType === 'TASK') {
      candidates.push({
        value: updates.parentTaskId,
        entityType: 'TASK',
        path: `${prefix}/updates/parentTaskId`,
      });

      const workflowLinks = Array.isArray(updates.workflowLinks)
        ? updates.workflowLinks
        : [];
      workflowLinks.forEach((link, index) => {
        if (!link || typeof link !== 'object') return;
        candidates.push({
          value: (link as Record<string, unknown>).targetTaskId,
          entityType: 'TASK',
          path: `${prefix}/updates/workflowLinks/${index}/targetTaskId`,
        });
      });
    }

    if (proposal.targetEntityType === 'DESIGN_DOC') {
      candidates.push({
        value: updates.parentEntityId,
        entityType:
          updates.parentEntityType === 'TASK' ||
          updates.parentEntityType === 'DESIGN_DOC'
            ? updates.parentEntityType
            : undefined,
        path: `${prefix}/updates/parentEntityId`,
      });
    }

    if (proposal.targetEntityType === 'WORK_ITEM_TYPE') {
      const definition =
        proposal.action === 'CREATE'
          ? updates
          : updates.definition !== null &&
              typeof updates.definition === 'object'
            ? (updates.definition as Record<string, unknown>)
            : {};
      const definitionPath =
        proposal.action === 'CREATE'
          ? `${prefix}/updates`
          : `${prefix}/updates/definition`;
      const ownKey =
        typeof definition.key === 'string' ? definition.key : undefined;
      const allowedParentTypes = Array.isArray(definition.allowedParentTypes)
        ? definition.allowedParentTypes
        : [];
      allowedParentTypes.forEach((value, index) => {
        if (value === ownKey) return;
        candidates.push({
          value,
          entityType: 'WORK_ITEM_TYPE',
          path: `${definitionPath}/allowedParentTypes/${index}`,
        });
      });

      const edgeTargets = Array.isArray(definition.edgeTargets)
        ? definition.edgeTargets
        : [];
      edgeTargets.forEach((target, targetIndex) => {
        if (!target || typeof target !== 'object') return;
        const targetTypeKeys = Array.isArray(
          (target as Record<string, unknown>).targetTypeKeys,
        )
          ? ((target as Record<string, unknown>).targetTypeKeys as unknown[])
          : [];
        targetTypeKeys.forEach((value, keyIndex) => {
          if (value === ownKey) return;
          candidates.push({
            value,
            entityType: 'WORK_ITEM_TYPE',
            path: `${definitionPath}/edgeTargets/${targetIndex}/targetTypeKeys/${keyIndex}`,
          });
        });
      });
    }

    const edges = Array.isArray(proposal.edges)
      ? (proposal.edges as unknown as ProposalEdgeDeclaration[])
      : [];
    edges.forEach((edge, index) => {
      if (edge.targetEntityType === 'PROPOSAL') return;
      candidates.push({
        value: edge.targetEntityId,
        entityType: edge.targetEntityType,
        path: `${prefix}/edges/${index}/targetEntityId`,
      });
    });

    return candidates.flatMap((candidate) =>
      typeof candidate.value === 'string' && candidate.entityType
        ? [
            {
              entityId: candidate.value,
              entityType: candidate.entityType,
              location: candidate.path,
            },
          ]
        : [],
    );
  }

  private findCycles(
    members: ProposalGroupValidationMember[],
    prerequisites: ReadonlyMap<string, Set<string>>,
  ): ProposalGroupValidationIssue[] {
    const issues: ProposalGroupValidationIssue[] = [];
    const state = new Map<string, 'visiting' | 'visited'>();
    const cycleMembers = new Set<string>();

    const visit = (memberId: string, path: string[]): void => {
      if (state.get(memberId) === 'visited') return;
      if (state.get(memberId) === 'visiting') {
        const start = path.indexOf(memberId);
        for (const id of path.slice(start)) cycleMembers.add(id);
        return;
      }
      state.set(memberId, 'visiting');
      for (const prerequisiteId of prerequisites.get(memberId) ?? []) {
        visit(prerequisiteId, [...path, memberId]);
      }
      state.set(memberId, 'visited');
    };

    for (const member of members) visit(member.id, []);
    for (const memberId of cycleMembers) {
      const index = members.findIndex((member) => member.id === memberId);
      issues.push(
        this.issue(
          'PREREQUISITE_CYCLE',
          `/members/${index}/prerequisiteMemberIds`,
          memberId,
          'The all-of prerequisite graph must be acyclic.',
        ),
      );
    }
    return issues;
  }

  private findDuplicateUpdateTargets(
    members: ProposalGroupValidationMember[],
  ): ProposalGroupValidationIssue[] {
    const firstByTarget = new Map<string, string>();
    const issues: ProposalGroupValidationIssue[] = [];
    for (const [index, member] of members.entries()) {
      if (member.proposal.action !== 'UPDATE') continue;
      const key = `${member.proposal.targetEntityType}:${member.proposal.targetEntityId}`;
      const first = firstByTarget.get(key);
      if (!first) {
        firstByTarget.set(key, member.id);
        continue;
      }
      issues.push(
        this.issue(
          'MEMBER_INVALID',
          `/members/${index}/proposal/targetEntityId`,
          member.id,
          `Only one UPDATE member may target an entity; member ${first} already targets it.`,
        ),
      );
    }
    return issues;
  }

  private issue(
    code: ProposalGroupValidationIssue['code'],
    location: string,
    memberId: string | null,
    message: string,
  ): ProposalGroupValidationIssue {
    return {
      code,
      location,
      memberId,
      message,
    } satisfies ProposalGroupValidationIssue;
  }
}

import {
  AgentEdgeCategory,
  AgentEdgeType,
  ProposalAction,
  ProposalEdgeTargetType,
  ProposalEdgeType,
  type CreateTaskDto,
  type ProjectedWorkItem,
  type ProjectedWorkItemRelationship,
  type ProposalGroupMemberSnapshot,
  type ProposalGroupSnapshot,
  type WorkItemChangeSetIdentity,
  type WorkItemTypeDefinitionDto,
} from "../../api";
import type {
  WorkItemGraphProjectionData,
  WorkflowGraphCreatedElements,
} from "../shared/WorkflowMentionInlineRenderer";
import type { WorkItemGraphDraftProjection } from "../shared/workItemGraphDraft";
import { projectWorkItemGraphDraft } from "../shared/workItemGraphDraft";
import {
  isWorkItemGraphProposal,
  getCreatedGraphRootType,
  isCreateTaskUpdates,
} from "../ProposalDispatchers/types";

export type CanonicalProposalGroupGraphResult =
  | {
      kind: "ready";
      rootMemberId: string;
      memberIds: readonly string[];
      projection: WorkItemGraphDraftProjection &
        Pick<WorkItemGraphProjectionData, "projectedReferenceTargets">;
      createdElements: WorkflowGraphCreatedElements;
    }
  | { kind: "not-graph-group" }
  | { kind: "unavailable"; reason: string };

export type CanonicalProposalGroupRootResolution =
  | { kind: "resolved"; definition: WorkItemTypeDefinitionDto }
  | { kind: "not-graph-group" }
  | { kind: "unavailable"; reason: string };

const hasReservedIdentity = (
  member: ProposalGroupMemberSnapshot,
): member is ProposalGroupMemberSnapshot & { reservedEntityId: string } =>
  typeof member.reservedEntityId === "string" &&
  member.reservedEntityId.trim().length > 0;

const readCreateTask = (
  member: ProposalGroupMemberSnapshot,
): CreateTaskDto | null =>
  member.proposal.action === ProposalAction.Create &&
  isCreateTaskUpdates(member.proposal)
    ? member.proposal.updates
    : null;

const buildPrerequisiteClosure = (
  snapshot: ProposalGroupSnapshot,
): ((memberId: string) => ReadonlySet<string>) => {
  const direct = new Map<string, string[]>();
  snapshot.dependencies.forEach((dependency) => {
    const prerequisites = direct.get(dependency.dependentMemberId) ?? [];
    prerequisites.push(dependency.prerequisiteMemberId);
    direct.set(dependency.dependentMemberId, prerequisites);
  });

  return (memberId: string): ReadonlySet<string> => {
    const closure = new Set<string>();
    const pending = [...(direct.get(memberId) ?? [])];
    while (pending.length > 0) {
      const prerequisite = pending.pop();
      if (!prerequisite || closure.has(prerequisite)) continue;
      closure.add(prerequisite);
      pending.push(...(direct.get(prerequisite) ?? []));
    }
    return closure;
  };
};

const orderedMembers = (
  snapshot: ProposalGroupSnapshot,
): ProposalGroupMemberSnapshot[] =>
  [...snapshot.members].sort(
    (left, right) => left.memberOrder - right.memberOrder,
  );

const hasStructuralGraphShape = (snapshot: ProposalGroupSnapshot): boolean => {
  const reservedMemberIds = new Map(
    snapshot.members.flatMap((member) =>
      hasReservedIdentity(member)
        ? [[member.reservedEntityId, member.memberId] as const]
        : [],
    ),
  );
  const prerequisiteClosure = buildPrerequisiteClosure(snapshot);

  return snapshot.members.some((member) => {
    const updates = readCreateTask(member);
    if (!updates?.parentTaskId) return false;
    const rootMemberId = reservedMemberIds.get(updates.parentTaskId);
    return Boolean(
      rootMemberId && prerequisiteClosure(member.memberId).has(rootMemberId),
    );
  });
};

export const resolveCanonicalProposalGroupRootDefinition = (
  snapshot: ProposalGroupSnapshot,
  definitions: readonly WorkItemTypeDefinitionDto[],
): CanonicalProposalGroupRootResolution => {
  const graphDefinitions = new Map(
    definitions.flatMap((definition) =>
      definition.capabilities?.graph?.rendererKey === "work-item-graph"
        ? [[definition.key, definition] as const]
        : [],
    ),
  );
  const candidates = snapshot.members.flatMap((member) => {
    const updates = readCreateTask(member);
    const type = isWorkItemGraphProposal(member.proposal)
      ? getCreatedGraphRootType(member.proposal.updates)
      : updates?.type;
    const definition = type ? graphDefinitions.get(type) : undefined;
    return definition ? [{ member, definition }] : [];
  });

  if (candidates.length === 0) {
    return hasStructuralGraphShape(snapshot)
      ? {
          kind: "unavailable",
          reason: "Graph rendering is unavailable for this proposal group.",
        }
      : { kind: "not-graph-group" };
  }
  if (candidates.length > 1) {
    return {
      kind: "unavailable",
      reason: "The proposal group has more than one graph root.",
    };
  }
  if (!hasReservedIdentity(candidates[0].member)) {
    return {
      kind: "unavailable",
      reason: "The graph root does not have a reserved identity.",
    };
  }
  return { kind: "resolved", definition: candidates[0].definition };
};

const existingIdentity = (id: string): WorkItemChangeSetIdentity => ({
  refType: "existing",
  id,
});

const projectCreateMember = (
  member: ProposalGroupMemberSnapshot & { reservedEntityId: string },
): ProjectedWorkItem => {
  const updates = readCreateTask(member);
  if (!updates) {
    throw new Error("A projected graph member must be a task CREATE proposal.");
  }

  return {
    identity: existingIdentity(member.reservedEntityId),
    label: updates.name,
    type: updates.type ?? "STANDARD",
    name: updates.name,
    parent: updates.parentTaskId
      ? existingIdentity(updates.parentTaskId)
      : undefined,
    status: updates.status,
    priority: updates.priority,
    dueDate: updates.dueDate,
    assigneeId: updates.assigneeId,
    tag: updates.tag,
    sections: (updates.sections ?? []).map(({ key, content }) => ({
      key,
      content,
    })),
    deleted: false,
  };
};

const proposalEdgeType = (edgeType: ProposalEdgeType): AgentEdgeType | null => {
  switch (edgeType) {
    case ProposalEdgeType.RelatedTo:
      return AgentEdgeType.RelatedTo;
    case ProposalEdgeType.DependsOn:
      return AgentEdgeType.DependsOn;
    case ProposalEdgeType.DerivesFrom:
      return AgentEdgeType.DerivesFrom;
    case ProposalEdgeType.Supersedes:
      return AgentEdgeType.Supersedes;
    case ProposalEdgeType.Contradicts:
      return AgentEdgeType.Contradicts;
    case ProposalEdgeType.Evolves:
      return AgentEdgeType.Evolves;
    case ProposalEdgeType.Tracks:
      return AgentEdgeType.Tracks;
    case ProposalEdgeType.Blocks:
      return null;
  }
};

const projectExplicitRelationships = (
  members: readonly (ProposalGroupMemberSnapshot & {
    reservedEntityId: string;
  })[],
): ProjectedWorkItemRelationship[] => {
  const selectedByProposalId = new Map(
    members.map((member) => [member.proposal.id, member] as const),
  );

  return members.flatMap((sourceMember) =>
    (sourceMember.proposal.edges ?? []).flatMap((edge, edgeIndex) => {
      if (edge.targetEntityType !== ProposalEdgeTargetType.Proposal) return [];
      const targetMember = selectedByProposalId.get(edge.targetEntityId);
      const edgeType = proposalEdgeType(edge.edgeType);
      if (!targetMember || !edgeType) return [];

      return [
        {
          identity: {
            refType: "temporary" as const,
            tempId: `proposal-group-edge:${sourceMember.memberId}:${edgeIndex}`,
          },
          label: edgeType,
          source: existingIdentity(sourceMember.reservedEntityId),
          target: existingIdentity(targetMember.reservedEntityId),
          edgeType,
          category: AgentEdgeCategory.Meta,
          reasoning: edge.description ?? null,
          deleted: false,
        },
      ];
    }),
  );
};

export const projectCanonicalProposalGroupGraph = (
  snapshot: ProposalGroupSnapshot,
  rootTypeDefinition: WorkItemTypeDefinitionDto,
): CanonicalProposalGroupGraphResult => {
  const graphCapability = rootTypeDefinition.capabilities?.graph;
  if (graphCapability?.rendererKey !== "work-item-graph") {
    return {
      kind: "unavailable",
      reason: "Graph rendering is unavailable for this work-item type.",
    };
  }

  const graphRoots = snapshot.members.filter(
    ({ proposal }) =>
      isWorkItemGraphProposal(proposal) &&
      getCreatedGraphRootType(proposal.updates) === rootTypeDefinition.key,
  );
  if (graphRoots.length === 1) {
    const member = graphRoots[0];
    const proposal = member.proposal;
    if (!isWorkItemGraphProposal(proposal)) {
      return { kind: "not-graph-group" };
    }
    const rootIdentity = proposal.updates.root;
    const rootCreate = proposal.updates.operations.find(
      (operation) =>
        operation.op === "workItem.create" &&
        rootIdentity.refType === "temporary" &&
        operation.ref.tempId === rootIdentity.tempId,
    );
    if (!rootCreate || rootCreate.op !== "workItem.create") {
      return {
        kind: "unavailable",
        reason: "The frozen Diagram has no authored root.",
      };
    }
    try {
      const draft = projectWorkItemGraphDraft(
        {
          root: {
            identity: rootIdentity,
            label: rootCreate.name,
            name: rootCreate.name,
            type: rootCreate.type ?? "DIAGRAM",
            parent: rootCreate.parent,
            sections: [],
            deleted: false,
          },
          children: [],
          incidentRelationships: [],
          typeDefinition: rootTypeDefinition,
        },
        proposal.updates.operations,
      );
      return {
        kind: "ready",
        rootMemberId: member.memberId,
        memberIds: [member.memberId],
        projection: {
          ...draft,
          projectedReferenceTargets: Object.fromEntries(
            snapshot.members.flatMap((screen) => {
              if (
                !screen.reservedEntityId ||
                isWorkItemGraphProposal(screen.proposal) ||
                !isCreateTaskUpdates(screen.proposal) ||
                screen.proposal.updates.type !== "mockup"
              ) {
                return [];
              }
              return [
                [
                  screen.reservedEntityId,
                  {
                    type: "mockup",
                    name: screen.proposal.updates.name,
                    sections: screen.proposal.updates.sections,
                  },
                ],
              ];
            }),
          ),
        },
        createdElements: {
          children: draft.children.map(({ identity }) => identity),
          relationships: draft.incidentRelationships.map(
            ({ identity }) => identity,
          ),
        },
      };
    } catch (error) {
      return {
        kind: "unavailable",
        reason:
          error instanceof Error
            ? error.message
            : "The frozen Diagram could not be rendered.",
      };
    }
  }

  const members = orderedMembers(snapshot);
  const rootCandidates = members.filter((member) => {
    const updates = readCreateTask(member);
    return updates?.type === rootTypeDefinition.key;
  });
  if (rootCandidates.length === 0) return { kind: "not-graph-group" };
  if (rootCandidates.length > 1) {
    return {
      kind: "unavailable",
      reason: "The proposal group has more than one graph root.",
    };
  }

  const root = rootCandidates[0];
  if (!hasReservedIdentity(root)) {
    return {
      kind: "unavailable",
      reason: "The graph root does not have a reserved identity.",
    };
  }
  const prerequisiteClosure = buildPrerequisiteClosure(snapshot);
  const matchingChildren = members.filter((member) => {
    const updates = readCreateTask(member);
    return (
      updates?.type === graphCapability.nodeChildType &&
      updates.parentTaskId === root.reservedEntityId &&
      prerequisiteClosure(member.memberId).has(root.memberId)
    );
  });
  const incompleteChild = matchingChildren.find(
    (member) => !hasReservedIdentity(member),
  );
  if (incompleteChild) {
    return {
      kind: "unavailable",
      reason: "A graph child does not have a reserved identity.",
    };
  }
  const children = matchingChildren.filter(hasReservedIdentity);
  const selectedMembers = [root, ...children];
  const projectedRoot = projectCreateMember(root);
  const projectedChildren = children.map(projectCreateMember);
  const relationships = projectExplicitRelationships(selectedMembers);

  try {
    const draft = projectWorkItemGraphDraft({
      root: projectedRoot,
      children: projectedChildren,
      incidentRelationships: relationships,
      typeDefinition: rootTypeDefinition,
    });
    const projection = {
      ...draft,
      children: projectedChildren,
      // References can point outside the Diagram parent chain. Keep their
      // frozen content separate from visible graph children and transitions.
      projectedReferenceTargets: Object.fromEntries(
        members.flatMap((member) => {
          const updates = readCreateTask(member);
          if (!updates || !hasReservedIdentity(member)) {
            return [];
          }

          return [
            [
              member.reservedEntityId,
              {
                type: updates.type ?? "STANDARD",
                name: updates.name,
                sections: updates.sections,
              },
            ],
          ];
        }),
      ),
    };

    return {
      kind: "ready",
      rootMemberId: root.memberId,
      memberIds: selectedMembers.map(({ memberId }) => memberId),
      projection,
      createdElements: {
        children: projectedChildren.map(({ identity }) => identity),
        relationships: relationships.map(({ identity }) => identity),
      },
    };
  } catch (error) {
    return {
      kind: "unavailable",
      reason:
        error instanceof Error
          ? error.message
          : "The proposal group graph could not be prepared for review.",
    };
  }
};

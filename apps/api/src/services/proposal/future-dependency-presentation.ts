import type {
  FutureCompletionDependency,
  FutureDependencyPresentation,
  FutureRevisionMutation,
} from 'src/generated';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { Prisma, Proposal } from '@prisma/client';

/** Project access is established by the owning review endpoint before this read. */
export async function readDependencyPresentation(
  tx: AnyTransactionClient,
  organizationId: string,
  projectId: string,
  dependencies: readonly FutureCompletionDependency[],
  includeStatus: boolean,
): Promise<FutureDependencyPresentation[]> {
  if (dependencies.length === 0) return [];
  const db = tx as Prisma.TransactionClient;
  const tasks = await db.task.findMany({
    where: {
      organizationId,
      projectId,
      id: { in: dependencies.map((d) => d.targetEntityId) },
      archivedAt: null,
      status: { not: 'ARCHIVED' },
    },
    select: {
      id: true,
      name: true,
      type: true,
      ...(includeStatus ? { status: true } : {}),
    },
  });
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return dependencies.map((dependency) => {
    const task = byId.get(dependency.targetEntityId);
    if (!task)
      return {
        targetEntityId: dependency.targetEntityId,
        availability: 'UNAVAILABLE',
      };
    return {
      targetEntityId: task.id,
      availability: 'AVAILABLE',
      title: task.name,
      workItemType: task.type,
      ...(includeStatus ? { status: task.status } : {}),
    };
  });
}

/** One identity read per project, including unapproved and grouped previews. */
export async function readProposalDependencyPresentation(
  tx: AnyTransactionClient,
  proposals: readonly Pick<
    Proposal,
    'id' | 'action' | 'organizationId' | 'projectId' | 'updates'
  >[],
): Promise<ReadonlyMap<string, FutureDependencyPresentation[]>> {
  const scopes = new Map<
    string,
    {
      organizationId: string;
      projectId: string;
      proposals: {
        id: string;
        dependencies: readonly FutureCompletionDependency[];
      }[];
    }
  >();
  for (const proposal of proposals) {
    if (proposal.action !== 'VERSIONED_UPDATE') continue;
    // Authored mutation content is validated by the proposal write boundary.
    const mutation = proposal.updates as unknown as FutureRevisionMutation;
    const dependencies =
      mutation.operation === 'REVISE' ? [...mutation.dependencies] : [];
    const key = `${proposal.organizationId}:${proposal.projectId}`;
    const scope = scopes.get(key) ?? {
      organizationId: proposal.organizationId,
      projectId: proposal.projectId,
      proposals: [],
    };
    scope.proposals.push({ id: proposal.id, dependencies });
    scopes.set(key, scope);
  }
  const result = new Map<string, FutureDependencyPresentation[]>();
  for (const scope of scopes.values()) {
    const dependencies = new Map(
      scope.proposals.flatMap((p) =>
        p.dependencies.map((d) => [d.targetEntityId, d] as const),
      ),
    );
    const presentation = await readDependencyPresentation(
      tx,
      scope.organizationId,
      scope.projectId,
      [...dependencies.values()],
      false,
    );
    const byId = new Map(presentation.map((p) => [p.targetEntityId, p]));
    for (const proposal of scope.proposals)
      result.set(
        proposal.id,
        proposal.dependencies.map((d) => byId.get(d.targetEntityId)!),
      );
  }
  return result;
}

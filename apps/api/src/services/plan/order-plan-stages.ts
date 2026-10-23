import { PlanDependenciesService } from './plan-dependencies.service';

export async function orderPlanStages<
  T extends {
    id: string;
    createdAt: Date;
  },
>(
  graph: PlanDependenciesService,
  organizationId: string,
  projectId: string,
  stages: T[],
): Promise<T[]> {
  if (stages.length < 2) return stages;
  const stageIds = new Set(stages.map((stage) => stage.id));
  const dependencies = (
    await graph.outgoing(organizationId, projectId, [...stageIds])
  ).filter((edge) => stageIds.has(edge.targetNodeId));
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const incoming = new Map(stages.map((stage) => [stage.id, 0]));
  const dependents = new Map(stages.map((stage) => [stage.id, [] as string[]]));
  for (const dependency of dependencies) {
    incoming.set(
      dependency.sourceNodeId,
      (incoming.get(dependency.sourceNodeId) ?? 0) + 1,
    );
    dependents.get(dependency.targetNodeId)?.push(dependency.sourceNodeId);
  }
  const compare = (left: T, right: T) =>
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.id.localeCompare(right.id);
  const ready = stages
    .filter((stage) => incoming.get(stage.id) === 0)
    .sort(compare);
  const ordered: T[] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (!next) break;
    ordered.push(next);
    for (const dependentId of dependents.get(next.id) ?? []) {
      const remaining = (incoming.get(dependentId) ?? 0) - 1;
      incoming.set(dependentId, remaining);
      if (remaining === 0) {
        const dependent = byId.get(dependentId);
        if (dependent) ready.push(dependent);
        ready.sort(compare);
      }
    }
  }
  if (ordered.length !== stages.length) {
    throw new Error('Canonical Plan dependency graph contains a cycle.');
  }
  return ordered;
}

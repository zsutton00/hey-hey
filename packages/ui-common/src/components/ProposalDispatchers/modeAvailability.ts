import { useEffect, useState } from "react";
import {
  AgentEdgeType,
  ProposalAction,
  ProposalEdgeTargetType,
  ProposalEdgeType,
} from "../../api";
import type {
  AgentEdgeResponseDto,
  ProposalEdgeDeclaration,
  TaskResponseDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useFeatureLookup } from "../../data/hooks/useFeatureHierarchy";

export interface ModeAvailabilityFeature {
  id: string;
  name: string;
}

interface ModeFeatureDependencyCandidate {
  id: string;
  persisted: boolean;
  proposed: boolean;
  name?: string;
}

export type ModeAvailabilityState =
  | { kind: "not-applicable" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; features: ModeAvailabilityFeature[] };

interface UseModeAvailabilityInput {
  organizationId: string;
  projectId: string;
  targetEntityId: string;
  action: typeof ProposalAction.Create | typeof ProposalAction.Update;
  /** The effective task type; undefined is used when an edge-only update has not resolved it yet. */
  modeTypeKey: string | undefined;
  proposalEdges: ProposalEdgeDeclaration[] | undefined;
}

const isModeTaskType = (typeKey: string | undefined): boolean =>
  typeKey === "MODE";

export const collectModeFeatureDependencyCandidates = (
  modeId: string,
  persistedEdges: AgentEdgeResponseDto[],
  proposalEdges: ProposalEdgeDeclaration[]
): ModeFeatureDependencyCandidate[] => {
  const candidates = new Map<string, ModeFeatureDependencyCandidate>();

  for (const edge of persistedEdges) {
    if (
      edge.type === AgentEdgeType.DependsOn &&
      edge.sourceNodeId === modeId &&
      edge.targetNodeType === "FEATURE"
    ) {
      const candidate = candidates.get(edge.targetNodeId) ?? {
        id: edge.targetNodeId,
        persisted: false,
        proposed: false,
      };
      const name = edge.targetNodeName?.trim();
      candidates.set(edge.targetNodeId, {
        ...candidate,
        persisted: true,
        ...(candidate.name || !name ? {} : { name }),
      });
    }
  }

  for (const edge of proposalEdges) {
    if (
      edge.edgeType === ProposalEdgeType.DependsOn &&
      edge.targetEntityType === ProposalEdgeTargetType.Task
    ) {
      const candidate = candidates.get(edge.targetEntityId) ?? {
        id: edge.targetEntityId,
        persisted: false,
        proposed: false,
      };
      candidates.set(edge.targetEntityId, {
        ...candidate,
        proposed: true,
      });
    }
  }

  return [...candidates.values()];
};

export const projectModeAvailabilityFeatures = (
  candidates: readonly ModeFeatureDependencyCandidate[],
  resolvedTasks: ReadonlyMap<string, Pick<TaskResponseDto, "type" | "name">>
): ModeAvailabilityFeature[] =>
  candidates.flatMap((candidate) => {
    let name = candidate.name;

    if (candidate.proposed || !name) {
      const task = resolvedTasks.get(candidate.id);
      if (!task) {
        throw new Error("A mode dependency could not be resolved.");
      }
      if (task.type !== "FEATURE") {
        if (candidate.persisted) {
          throw new Error(
            "A persisted Feature dependency no longer resolves as a Feature."
          );
        }
        return [];
      }
      name = task.name.trim();
    }

    if (!name) {
      throw new Error("A Feature dependency has no available name.");
    }

    return [{ id: candidate.id, name }];
  });

const loadTask = async (
  organizationId: string,
  projectId: string,
  taskId: string,
  includeEdges = false
): Promise<TaskResponseDto> => {
  const response = await unifiedApiClient.getTask({
    organizationId,
    projectId,
    taskId,
    ...(includeEdges
      ? {
          includeEdges: true,
          edgeTypes: [AgentEdgeType.DependsOn],
        }
      : {}),
  });
  const task = response.data.data;
  if (
    !task ||
    task.id !== taskId ||
    typeof task.type !== "string" ||
    typeof task.name !== "string"
  ) {
    throw new Error("The task could not be loaded.");
  }
  return task;
};

export const useModeAvailability = ({
  organizationId,
  projectId,
  targetEntityId,
  action,
  modeTypeKey,
  proposalEdges,
}: UseModeAvailabilityInput): ModeAvailabilityState => {
  const proposalEdgesKey = JSON.stringify(proposalEdges ?? []);
  const featureLookup = useFeatureLookup(organizationId, projectId);
  const [state, setState] = useState<ModeAvailabilityState>(() =>
    modeTypeKey !== undefined && !isModeTaskType(modeTypeKey)
      ? { kind: "not-applicable" }
      : { kind: "loading" }
  );

  useEffect(() => {
    let cancelled = false;

    if (modeTypeKey !== undefined && !isModeTaskType(modeTypeKey)) {
      setState({ kind: "not-applicable" });
      return () => {
        cancelled = true;
      };
    }

    // Wait for the cached hierarchy so hits avoid a per-feature read.
    if (featureLookup.isLoading) {
      setState({ kind: "loading" });
      return () => {
        cancelled = true;
      };
    }

    const loadAvailability = async () => {
      setState({ kind: "loading" });

      try {
        let persistedEdges: AgentEdgeResponseDto[] = [];

        if (action === ProposalAction.Update) {
          const mode = await loadTask(
            organizationId,
            projectId,
            targetEntityId,
            true
          );
          if (mode.id !== targetEntityId || mode.type !== "MODE") {
            if (!cancelled) setState({ kind: "not-applicable" });
            return;
          }
          persistedEdges = mode.edges ?? [];
        }

        const dependencyCandidates = collectModeFeatureDependencyCandidates(
          targetEntityId,
          persistedEdges,
          proposalEdges ?? []
        );
        const targetsToResolve = dependencyCandidates
          .filter((candidate) => candidate.proposed || !candidate.name)
          .map((candidate) => candidate.id);
        const resolvedTasksById = new Map<
          string,
          Pick<TaskResponseDto, "type" | "name">
        >();
        const misses: string[] = [];
        for (const id of targetsToResolve) {
          const feature = featureLookup.get(id);
          if (feature) {
            resolvedTasksById.set(id, { type: "FEATURE", name: feature.name });
          } else {
            misses.push(id);
          }
        }
        const loadedTasks = await Promise.all(
          misses.map((id) => loadTask(organizationId, projectId, id))
        );
        for (const task of loadedTasks) resolvedTasksById.set(task.id, task);

        if (!cancelled) {
          setState({
            kind: "ready",
            features: projectModeAvailabilityFeatures(
              dependencyCandidates,
              resolvedTasksById
            ),
          });
        }
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    };

    void loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [
    action,
    featureLookup,
    modeTypeKey,
    organizationId,
    projectId,
    proposalEdgesKey,
    targetEntityId,
  ]);

  return state;
};

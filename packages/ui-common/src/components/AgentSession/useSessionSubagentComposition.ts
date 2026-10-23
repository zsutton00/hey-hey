import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentSession } from "../../data/hooks/useAgentSession";
import { useServices } from "../../data/hooks/useServices";
import { filterCodingSessionServices } from "./runtime/coding/useAgentSetup";
import type { SubagentServiceScope } from "../SmarterTextAreaCard/slashCommands/SubagentServicesContext";
import { cancelSubagentInteraction } from "./operations/AgentOperationProvider";
import {
  resolveSubagentReadiness,
  type SubagentComposerCapability,
  type SubagentReadinessInput,
} from "./subagentComposerState";

const EMPTY_IDS: readonly string[] = [];

interface InteractionProgress {
  interactionId: string;
  cancelling: boolean;
  error: string | null;
}

function useScopedInteractionProgress(key: string) {
  const scopeRef = useRef({ key, pending: false, cancelling: false });
  if (scopeRef.current.key !== key)
    scopeRef.current = { key, pending: false, cancelling: false };
  const scope = scopeRef.current;
  const [progress, setProgress] = useState<{
    scope: typeof scope;
    value: InteractionProgress;
  } | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = progress?.scope === scope ? progress.value : null;
  const isCurrent = () => mounted.current && scopeRef.current === scope;
  const update = (value: InteractionProgress | null) => {
    if (isCurrent()) setProgress(value ? { scope, value } : null);
  };
  return { scope, current, update, isCurrent };
}

export function useSessionSubagentComposition(
  input: Omit<SubagentReadinessInput, "session">,
  onStopRun?: () => void
) {
  const { organizationId, projectId, agentSessionId, conversationId } = input;
  const query = useAgentSession(organizationId, projectId, agentSessionId);
  const readiness = resolveSubagentReadiness({
    ...input,
    session: query.error ? null : query.agentSession,
  });
  const progress = useScopedInteractionProgress(
    JSON.stringify([organizationId, projectId, agentSessionId, conversationId])
  );
  const { scope, current, update } = progress;
  const servicesQuery = useServices(organizationId, {
    projectId,
    enabled: readiness.kind === "ready",
  });
  const sourceServiceIds = query.agentSession?.serviceIds ?? EMPTY_IDS;
  const serviceScope = useMemo<SubagentServiceScope>(
    () => ({
      options: filterCodingSessionServices(
        servicesQuery.services,
        projectId
      ).map((service) => ({ id: service.id, name: service.name })),
      sourceServiceIds,
    }),
    [projectId, servicesQuery.services, sourceServiceIds]
  );
  const capability: SubagentComposerCapability =
    readiness.kind === "unavailable"
      ? readiness
      : {
          kind: "ready",
          services: serviceScope,
          submit: async (intent, interactionId) => {
            if (scope.pending)
              throw new Error("A child request is already pending.");
            scope.pending = true;
            try {
              await readiness.requestSubagent({
                organizationId,
                projectId,
                agentSessionId,
                runId: readiness.runId,
                interactionId,
                intent,
                // An unedited selection means the source session's Services.
                serviceIds: intent.serviceIds ?? [...sourceServiceIds],
                onAccepted:
                  intent.mode === "foreground"
                    ? () =>
                        update({
                          interactionId,
                          cancelling: false,
                          error: null,
                        })
                    : undefined,
              });
            } finally {
              scope.pending = false;
              update(null);
            }
          },
        };
  const stop = () => {
    if (!current) {
      onStopRun?.();
      return;
    }
    if (scope.cancelling) return;
    scope.cancelling = true;
    update({ ...current, cancelling: true, error: null });
    void cancelSubagentInteraction({
      organizationId,
      projectId,
      interactionId: current.interactionId,
    })
      .then(() => {
        if (!progress.isCurrent()) return;
        update(null);
        onStopRun?.();
      })
      .catch((error: unknown) =>
        update({
          ...current,
          cancelling: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to cancel the child request.",
        })
      )
      .finally(() => {
        scope.cancelling = false;
      });
  };
  return {
    capability,
    waiting: current !== null,
    cancelling: current?.cancelling ?? false,
    cancellationError: current?.error ?? null,
    stop: current || onStopRun ? stop : undefined,
  };
}

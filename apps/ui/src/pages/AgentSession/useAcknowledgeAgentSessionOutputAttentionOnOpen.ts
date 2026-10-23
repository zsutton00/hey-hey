import { AgentSessionOutputAttentionState } from "@hey-hey/ui-common/api";
import {
  useAcknowledgeAgentSessionOutputAttention,
  useAgentSessionOutputAttentions,
} from "@hey-hey/ui-common/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logger } from "../../utils/logger";

const ACKNOWLEDGMENT_RETRY_DELAYS_MS = [0, 250, 1_000] as const;

const isDocumentVisible = (): boolean =>
  typeof document !== "undefined" &&
  document.visibilityState === "visible";

type AcknowledgmentRuntime = {
  agentSessionId: string | null | undefined;
  disposed: boolean;
  initialPending: boolean;
  pendingReadyRevision: number | null;
  acknowledgedReadyRevision: number | null;
  processing: boolean;
};

export const useAcknowledgeAgentSessionOutputAttentionOnOpen = (input: {
  organizationId: string | null | undefined;
  projectId: string | null | undefined;
  agentSessionId: string | null | undefined;
  enabled: boolean;
}): void => {
  const acknowledge = useAcknowledgeAgentSessionOutputAttention(
    input.organizationId ?? undefined,
    input.projectId ?? undefined,
    input.agentSessionId ?? undefined,
  );
  const subscribedAgentSessionIds = useMemo(
    () => (input.agentSessionId ? [input.agentSessionId] : []),
    [input.agentSessionId],
  );
  const attentionById = useAgentSessionOutputAttentions(
    input.organizationId ?? undefined,
    input.projectId ?? undefined,
    subscribedAgentSessionIds,
    { enabled: input.enabled },
  );
  const attention = input.agentSessionId
    ? attentionById[input.agentSessionId]
    : undefined;
  const [visible, setVisible] = useState(isDocumentVisible);
  const acknowledgeRef = useRef(acknowledge);
  const enabledRef = useRef(input.enabled);
  const runtimeRef = useRef<AcknowledgmentRuntime>({
    agentSessionId: input.agentSessionId,
    disposed: false,
    initialPending: true,
    pendingReadyRevision: null,
    acknowledgedReadyRevision: null,
    processing: false,
  });

  acknowledgeRef.current = acknowledge;
  enabledRef.current = input.enabled;

  if (runtimeRef.current.agentSessionId !== input.agentSessionId) {
    runtimeRef.current.disposed = true;
    runtimeRef.current = {
      agentSessionId: input.agentSessionId,
      disposed: false,
      initialPending: true,
      pendingReadyRevision: null,
      acknowledgedReadyRevision: null,
      processing: false,
    };
  }

  const processAcknowledgments = useCallback(
    (runtime: AcknowledgmentRuntime): void => {
      if (runtime.processing || runtime.disposed || !enabledRef.current) return;
      runtime.processing = true;

      const run = async (): Promise<void> => {
        while (!runtime.disposed && enabledRef.current) {
          const isInitialOpen = runtime.initialPending;
          if (!isInitialOpen && !isDocumentVisible()) break;

          const readyRevision = runtime.pendingReadyRevision;

          if (!isInitialOpen) {
            if (readyRevision === null) break;
            if (
              runtime.acknowledgedReadyRevision !== null &&
              readyRevision <= runtime.acknowledgedReadyRevision
            ) {
              runtime.pendingReadyRevision = null;
              continue;
            }
          }

          let lastError: unknown;
          let succeeded = false;
          for (const delayMs of ACKNOWLEDGMENT_RETRY_DELAYS_MS) {
            if (delayMs > 0) {
              await new Promise((resolve) =>
                window.setTimeout(resolve, delayMs),
              );
            }
            if (runtime.disposed || !enabledRef.current) break;
            try {
              await acknowledgeRef.current();
              succeeded = true;
              break;
            } catch (error: unknown) {
              lastError = error;
            }
          }

          if (!succeeded) {
            if (!runtime.disposed && enabledRef.current) {
              logger.warn(
                "data_hooks",
                "Failed to acknowledge Agent Session output attention on canonical open",
                { agentSessionId: runtime.agentSessionId, error: lastError },
              );
            }
            break;
          }

          if (isInitialOpen) {
            runtime.initialPending = false;
          }
          if (readyRevision !== null) {
            runtime.acknowledgedReadyRevision = readyRevision;
            if (runtime.pendingReadyRevision === readyRevision) {
              runtime.pendingReadyRevision = null;
            }
          }
        }

        runtime.processing = false;
      };

      void run();
    },
    [],
  );

  useEffect(() => {
    const runtime = runtimeRef.current;
    runtime.disposed = false;

    return () => {
      runtime.disposed = true;
    };
  }, [input.agentSessionId]);

  useEffect(() => {
    const handleVisibilityChange = () => setVisible(isDocumentVisible());

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!input.enabled || !input.agentSessionId) {
      return;
    }

    const runtime = runtimeRef.current;
    if (attention?.state !== AgentSessionOutputAttentionState.MessageReady) {
      runtime.pendingReadyRevision = null;
    } else {
      runtime.pendingReadyRevision = Math.max(
        runtime.pendingReadyRevision ?? Number.NEGATIVE_INFINITY,
        attention.revision,
      );
    }

    if (runtime.initialPending || visible) {
      processAcknowledgments(runtime);
    }
  }, [
    attention?.revision,
    attention?.state,
    input.agentSessionId,
    input.enabled,
    processAcknowledgments,
    visible,
  ]);
};

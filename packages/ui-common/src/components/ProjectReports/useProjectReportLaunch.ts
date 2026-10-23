import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AgentSessionConfigProjectReportV1,
  ProjectReportRequestDto,
  RunCreatePayloadProjectReport,
  RunCreatePayloadReleaseNotes,
} from "../../api";
import { reconcileAcceptedAgentLaunch } from "../../data/agentLaunchReconciliation";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";
import { getErrorMessage } from "../../utils/errorUtils";
import { useAgentSessionInteractionAccessResolver } from "../AgentSession/operations/useAgentSessionInteractionAccess";

/**
 * Starts the API-prepared attempt through the existing authorized operation flow.
 * Release notes launch with the accepted repository selection; project reports
 * launch with no repository scope.
 */
export function useProjectReportLaunch() {
  const accessResolver = useAgentSessionInteractionAccessResolver();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const operationIds = useRef(new Map<string, string>());
  const [isPending, setIsPending] = useState(false);
  const [failedRequest, setFailedRequest] =
    useState<ProjectReportRequestDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(
    async (request: ProjectReportRequestDto) => {
      const attempt = request.attempts.at(-1);
      if (!attempt || attempt.status !== "QUEUED" || inFlight.current) return;
      inFlight.current = true;
      setIsPending(true);
      setError(null);
      setFailedRequest(null);
      try {
        if (!attempt.agentSessionId || !attempt.conversationId) {
          throw new Error(
            "The report attempt has no prepared session and conversation.",
          );
        }
        const selection = request.submission.launch;
        const access = accessResolver.getAccess(selection.machineId);
        if (!access.isDeviceEnabled)
          throw new Error(access.unavailable.message);
        const operationId =
          operationIds.current.get(attempt.id) ?? crypto.randomUUID();
        operationIds.current.set(attempt.id, operationId);
        const config = {
          type: "PROJECT_REPORT",
          version: "v1",
          requestId: request.id,
          attemptId: attempt.id,
          model: selection.model,
          effort: selection.effort,
          ...(supportsFastMode(selection.provider, selection.model) &&
          selection.fastMode !== undefined
            ? { fastMode: selection.fastMode }
            : {}),
        } satisfies AgentSessionConfigProjectReportV1;
        const promptType =
          request.kind === "RELEASE_NOTES" ? "release_notes" : "project_report";
        const payload = {
          promptType,
          request: {
            requestId: request.id,
            attemptId: attempt.id,
            projectId: request.projectId,
          },
        } satisfies RunCreatePayloadProjectReport | RunCreatePayloadReleaseNotes;
        const serviceIds = [...(request.submission.serviceIds ?? [])].sort();
        if (request.kind === "RELEASE_NOTES" && serviceIds.length === 0) {
          throw new Error("This release notes request has no saved repository selection.");
        }
        const result = await access.interactions.startSession({
          operationId,
          organizationId: request.organizationId,
          projectId: request.projectId,
          agentSessionId: attempt.agentSessionId,
          conversationId: attempt.conversationId,
          intent: {
              attachments: [],
            handlerPromptType: promptType,
            payload,
            ...(request.kind === "RELEASE_NOTES"
              ? { serviceIds, launchServiceId: serviceIds[0] }
              : {}),
            config,
            provider: selection.provider,
            model: selection.model,
            reasoningEffort: selection.effort,
            ...(supportsFastMode(selection.provider, selection.model) &&
            selection.fastMode !== undefined
              ? { fastMode: selection.fastMode }
              : {}),
            contextMetadata: {
              capturedAt: request.createdAt,
              userComments: [],
              fileReferences: { resolved: [], unresolved: [] },
              organizationId: request.organizationId,
              projectId: request.projectId,
              agentSessionId: attempt.agentSessionId,
            },
          },
        });
        if (result.state !== "accepted" && result.state !== "succeeded") {
          throw new Error(
            result.state === "cancelled"
              ? "Report launch was cancelled."
              : result.message,
          );
        }
        reconcileAcceptedAgentLaunch(queryClient, {
          organizationId: request.organizationId,
          projectId: request.projectId,
          agentSessionId: attempt.agentSessionId,
          conversationId: attempt.conversationId,
        });
      } catch (caught) {
        setFailedRequest(request);
        setError(
          getErrorMessage(caught, "The report run could not be started."),
        );
      } finally {
        inFlight.current = false;
        setIsPending(false);
      }
    },
    [accessResolver, queryClient],
  );

  return {
    launch,
    isPending,
    error,
    retry: () => (failedRequest ? launch(failedRequest) : Promise.resolve()),
  };
}

import type { AgenticSession } from '../../session/types';
import type { GetMessage200Response } from '../../shared/api/generated/api';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';

/**
 * Reads the assistant message a follow-up replies to so the follow-up
 * orientation can quote the actual exchange. Degrades to `null` on any
 * failure — the orientation then falls back to the prior promptType label.
 */
export const fetchPriorAssistantMessage = async (
  run: AgenticSession,
  triggerParentMessageId: string,
  deps: PromptTypeHandlerDeps,
): Promise<string | null> => {
  const { organizationId, projectId } = run.contextMetadata ?? {};
  if (!organizationId || !projectId) {
    deps.logger.warn('coding-freeform.prepare.missing_org_or_project', {
      runId: run.agentic_session_id,
      hasOrganizationId: Boolean(organizationId),
      hasProjectId: Boolean(projectId),
    });
    return null;
  }

  let accessToken: string;
  try {
    accessToken = await deps.auth.getAccessToken();
  } catch (error) {
    deps.logger.warn('coding-freeform.prepare.auth_failed', {
      runId: run.agentic_session_id,
      error,
    });
    return null;
  }

  const path = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/messages/${encodeURIComponent(triggerParentMessageId)}`;

  try {
    const res = await deps.fetchImpl(`${deps.apiBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      deps.logger.warn('coding-freeform.prepare.parent_fetch_failed', {
        runId: run.agentic_session_id,
        triggerParentMessageId,
        status: res.status,
      });
      return null;
    }
    const body = (await res.json()) as GetMessage200Response;
    const message = body.data;
    if (!message || message.type !== 'SYSTEM') return null;

    const data = message.data as { type?: string; response?: unknown } | undefined;
    if (!data || data.type !== 'AGENT') return null;

    const response = typeof data.response === 'string' ? data.response.trim() : '';
    if (response.length === 0) return null;

    return response;
  } catch (error) {
    deps.logger.warn('coding-freeform.prepare.parent_fetch_error', {
      runId: run.agentic_session_id,
      triggerParentMessageId,
      error,
    });
    return null;
  }
};

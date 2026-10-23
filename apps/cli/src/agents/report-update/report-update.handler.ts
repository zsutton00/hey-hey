import type {
  LocalReportUpdatePromptPayload,
  LocalReportUpdateResponse,
} from '../../shared/agent-bridge-contract/index';
import type {
  PromptTypeHandler,
  PromptTypeHandlerDeps,
  PrepareResult,
  OnCompleteContext,
  OnCompleteDeps,
} from '../prompt-type-handler';
import type { AgenticSession } from '../../session/types';
import type { AssistantCompleteEvent } from '../../run/types';
import { type UpdateReportDto } from '../../shared/api/index';
import { buildReportUpdatePrompt } from '../prompts/report-update';
import { parseReportUpdateResponseFromText } from '../response-parser';
import type { OtherReportPayload } from '../../shared/api/generated';

const SESSION_CONTEXT_KEY = 'reportUpdateTargetId';

const parseResponse = (text: string): LocalReportUpdateResponse | null => {
  const result = parseReportUpdateResponseFromText(text);
  return result.ok ? result.value : null;
};

const patchReport = async (
  organizationId: string,
  reportId: string,
  dto: UpdateReportDto,
  deps: OnCompleteDeps,
): Promise<boolean> => {
  const accessToken = await deps.auth.getAccessToken();
  const endpoint = `${deps.apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/reports/${encodeURIComponent(reportId)}`;
  const response = await deps.fetchImpl(endpoint, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dto),
  });
  if (!response.ok) {
    const body = await response.text();
    deps.logger.error('report-update.patch.failed', {
      reportId,
      status: response.status,
      body,
    });
    return false;
  }
  return true;
};

export const reportUpdateHandler: PromptTypeHandler<LocalReportUpdatePromptPayload> = {
  id: 'report_update',
  promptType: 'report_update',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'none',
  expectedResponseTypes: ['report_update_v1'],
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],

  async prepare(
    _run: AgenticSession,
    payload: LocalReportUpdatePromptPayload,
    _deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalReportUpdatePromptPayload>> {
    // Stash the report id in the run's sessionContext so `onComplete` can
    // target the correct report without trusting fields in the LLM response.
    return {
      payload,
      sessionContext: { [SESSION_CONTEXT_KEY]: payload.reportId },
    };
  },

  buildPrompt(payload: LocalReportUpdatePromptPayload): string {
    return buildReportUpdatePrompt({
      reportType: payload.reportType,
      ...(payload.title ? { title: payload.title } : {}),
      text: payload.text,
      entities: payload.entities.map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
        relation: e.relation,
      })),
      changedEntities: payload.changedEntities.map((e) => ({
        entityType: e.entityType,
        entityId: e.entityId,
      })),
      events: payload.events ?? [],
    });
  },

  buildStartingMessage(): string | null {
    return null;
  },

  async onComplete(
    event: AssistantCompleteEvent,
    ctx: OnCompleteContext,
    deps: OnCompleteDeps,
  ): Promise<void> {
    const parsed = parseResponse(event.summary);
    if (!parsed) {
      deps.logger.warn('report-update.on_complete.parse_failed', {
        runId: ctx.runId,
      });
      return;
    }

    const run = await deps.runStore.getRun(ctx.runId);
    const sessionContext = run?.sessionContext;
    const raw = sessionContext?.[SESSION_CONTEXT_KEY];
    const reportId = typeof raw === 'string' && raw.length > 0 ? raw : null;
    if (!reportId) {
      deps.logger.error('report-update.on_complete.missing_report_id', {
        runId: ctx.runId,
      });
      return;
    }

    const dto: UpdateReportDto = {
      payload: {
        ...(parsed.title ? { title: parsed.title } : {}),
        text: parsed.text,
      } as OtherReportPayload,
    };

    const ok = await patchReport(ctx.organizationId, reportId, dto, deps);
    if (!ok) return;

    deps.logger.debug('report-update.patch.succeeded', {
      runId: ctx.runId,
      reportId,
    });
  },
};

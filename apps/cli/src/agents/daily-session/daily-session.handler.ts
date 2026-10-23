import type { AssistantCompleteEvent } from '../../run/types';
import type { OtherReportPayload } from '../../shared/api/generated';
import type { CreateReportDto, CreateReportEntityDto } from '../../shared/api/index';
import {
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  SystemMessageDataTypeEnum,
} from '../../shared/api/index';
import type { LocalDailySessionPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import type {
  LocalDailySessionResponse,
  LocalReportEntityRef,
} from '../../shared/agent-bridge-contract/index';
import { LocalReportEntityRelation } from '../../shared/agent-bridge-contract/index';
import type {
  OnCompleteContext,
  OnCompleteDeps,
  UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { parseDailySessionResponseFromText } from '../response-parser';
import { buildDailySessionPrompt } from './daily-session-prompt';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../../shared/logging/daily-session';
import { prepareDailySessionInput } from './prepare-daily-session-input';
import type { DailySessionEnrichedPayload } from './types';

const parseResponse = (text: string): LocalDailySessionResponse | null => {
  const result = parseDailySessionResponseFromText(text);
  if (!result.ok) return null;
  return result.value;
};

const LOCAL_TO_PLATFORM_REPORT_TYPE: Record<string, OtherReportPayload['reportType']> = {
  GOAL_PROGRESS: ReportType.GoalProgress,
  RISK_ALERT: ReportType.RiskAlert,
  SESSION_SUMMARY: ReportType.SessionSummary,
};

const mapEntityRelation = (relation: string): ReportEntityRelation =>
  relation === LocalReportEntityRelation.Primary
    ? ReportEntityRelation.Primary
    : ReportEntityRelation.Context;

const VALID_ENTITY_TYPES = new Set<string>(Object.values(ReportRelatedEntityType));

const mapEntities = (refs: LocalReportEntityRef[] | undefined): CreateReportEntityDto[] => {
  if (!refs?.length) return [];
  return refs
    .filter((ref) => VALID_ENTITY_TYPES.has(ref.entityType))
    .map((ref) => ({
      entityType: ref.entityType as CreateReportEntityDto['entityType'],
      entityId: ref.entityId,
      relation: mapEntityRelation(ref.relation),
    }));
};

interface CreatedReport {
  id: string;
}

const postReport = async (
  dto: CreateReportDto,
  organizationId: string,
  deps: OnCompleteDeps,
): Promise<CreatedReport | null> => {
  const accessToken = await deps.auth.getAccessToken();
  const endpoint = `${deps.apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/reports`;
  const response = await deps.fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dto),
  });

  if (!response.ok) {
    const body = await response.text();
    deps.logger.error('daily-session.report.create_failed', {
      status: response.status,
      body,
      reportType: dto.reportType,
    });
    return null;
  }

  const json = (await response.json()) as Record<string, unknown>;
  const data = json['data'] as Record<string, unknown> | undefined;
  const id = (data?.['id'] ?? json['id']) as string | undefined;
  if (!id) {
    deps.logger.warn('daily-session.report.missing_id_in_response', {
      reportType: dto.reportType,
    });
    return null;
  }
  return { id };
};

const createDailySessionReports = async (
  parsed: LocalDailySessionResponse,
  ctx: OnCompleteContext,
  deps: OnCompleteDeps,
): Promise<string | null> => {
  const parentEntities: CreateReportEntityDto[] = [
    {
      entityType: ReportRelatedEntityType.AgentSession,
      entityId: ctx.runId,
      relation: ReportEntityRelation.Context,
    },
  ];

  const parentDto: CreateReportDto = {
    projectId: ctx.projectId,
    reportType: ReportType.DailySession,
    audience: ReportAudience.ProjectVisible,
    payload: {
      reportType: ReportType.DailySession,
      summary: parsed.response,
    },
    schemaVersion: 1,
    sourceExecutionId: ctx.runId,
    entities: parentEntities,
  };

  const parent = await postReport(parentDto, ctx.organizationId, deps);
  if (!parent) return null;

  deps.logger.info('daily-session.report.parent_created', {
    reportId: parent.id,
    runId: ctx.runId,
  });

  deps.reportIndex.registerReport(
    parent.id,
    parentEntities.map((e) => ({ entityType: e.entityType, entityId: e.entityId })),
  );

  for (const report of parsed.reports) {
    const platformType = LOCAL_TO_PLATFORM_REPORT_TYPE[report.reportType];
    if (!platformType) {
      deps.logger.warn('daily-session.report.unknown_type', {
        reportType: report.reportType,
      });
      continue;
    }

    const childEntities: CreateReportEntityDto[] = [
      ...mapEntities(report.entities),
      {
        entityType: ReportRelatedEntityType.AgentSession,
        entityId: ctx.runId,
        relation: ReportEntityRelation.Context,
      },
    ];

    const childDto: CreateReportDto = {
      projectId: ctx.projectId,
      reportType: platformType,
      audience: ReportAudience.ProjectVisible,
      payload: {
        reportType: platformType,
        ...(report.title ? { title: report.title } : {}),
        text: report.text,
      } as OtherReportPayload,
      schemaVersion: 1,
      sourceExecutionId: ctx.runId,
      parentReportId: parent.id,
      entities: childEntities,
    };

    try {
      const child = await postReport(childDto, ctx.organizationId, deps);
      if (child) {
        deps.logger.info('daily-session.report.child_created', {
          reportId: child.id,
          parentReportId: parent.id,
          reportType: platformType,
        });
        deps.reportIndex.registerReport(
          child.id,
          childEntities.map((e) => ({ entityType: e.entityType, entityId: e.entityId })),
        );
      }
    } catch (error) {
      deps.logger.error('daily-session.report.child_failed', {
        parentReportId: parent.id,
        reportType: platformType,
        error,
      });
    }
  }

  return parent.id;
};

const buildMessageData = (parsed: LocalDailySessionResponse) => ({
  type: SystemMessageDataTypeEnum.Agent,
  response: parsed.response,
  title: 'Daily Session',
  detectedIntent: 'daily_session',
  intentConfidence: 1,
  ragEnabled: false,
});

export const dailySessionHandler: UserLaunchablePromptTypeHandler<LocalDailySessionPromptPayload> =
  {
    id: 'daily_session',
    promptType: 'daily_session',
    service: 'optional',
    launchEntity: 'none',
    implementationReadiness: 'none',
    graphResearchGuidance: true,
    epistemicCalibration: true,
    expectedResponseTypes: ['daily_session_v1'],
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    // Fresh, single-evaluation turn — no transcript carries into a next firing.
    providerSessionLifetime: 'turn',

    addUserMessage(payload: LocalDailySessionPromptPayload): string | null {
      const text = payload.userMessage?.trim();
      return text ? `\n\n## User Message\n\n${text}` : null;
    },
    reports: [
      {
        reportType: ReportType.DailySession,
        audience: ReportAudience.ProjectVisible,
        required: true,
      },
      {
        reportType: ReportType.GoalProgress,
        audience: ReportAudience.ProjectVisible,
        required: true,
      },
      {
        reportType: ReportType.RiskAlert,
        audience: ReportAudience.ProjectVisible,
        required: true,
      },
      {
        reportType: ReportType.SessionSummary,
        audience: ReportAudience.ProjectVisible,
        required: true,
      },
    ],

    async prepare(run, payload, deps) {
      return prepareDailySessionInput(run, payload, deps);
    },

    buildPrompt(payload: LocalDailySessionPromptPayload): string {
      const enriched = (payload as DailySessionEnrichedPayload)._enriched;
      const logger = (payload as DailySessionEnrichedPayload)._logger;
      let prompt: string;
      if (enriched) {
        prompt = buildDailySessionPrompt(enriched, { logger });
      } else {
        // Fallback: prepare was skipped (auth failure, missing context).
        // Build a minimal prompt with just the user message.
        prompt = buildDailySessionPrompt({
          activitySnapshot: [],
          computedDelta: {
            statusChanges: [],
            itemCompletions: [],
            newSignals: [],
            computedAt: new Date().toISOString(),
          },
          ...(payload.userMessage ? { userMessage: payload.userMessage } : {}),
        });
      }

      logger?.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'handler_prompt_built',
        promptLength: prompt.length,
        hasTriggerDelta: !!enriched?.triggerDelta,
        hasUserMessage: !!payload.userMessage,
        activityCount: enriched?.activitySnapshot.length ?? 0,
      });

      return prompt;
    },

    buildStartingMessage(): string | null {
      return 'Starting your daily session...';
    },

    async onComplete(
      event: AssistantCompleteEvent,
      ctx: OnCompleteContext,
      deps: OnCompleteDeps,
    ): Promise<void> {
      const parsed = parseResponse(event.summary);
      if (!parsed) {
        deps.logger.warn(DAILY_SESSION_MONITOR_LOG_EVENT, {
          stage: 'handler_completion_parse_failed',
          runId: ctx.runId,
          messageId: ctx.messageId,
          summaryPreview: event.summary.slice(0, 500),
        });
        return;
      }
      if (parsed.reports.length === 0) {
        deps.logger.warn(DAILY_SESSION_MONITOR_LOG_EVENT, {
          stage: 'handler_completion_no_reports',
          runId: ctx.runId,
          messageId: ctx.messageId,
        });
        return;
      }

      const parentReportId = await createDailySessionReports(parsed, ctx, deps);
      if (!parentReportId) {
        deps.logger.warn(DAILY_SESSION_MONITOR_LOG_EVENT, {
          stage: 'handler_completion_parent_report_missing',
          runId: ctx.runId,
          messageId: ctx.messageId,
        });
        return;
      }

      try {
        await deps.poster.update(
          ctx.organizationId,
          ctx.projectId,
          ctx.messageId,
          {
            data: { ...buildMessageData(parsed), reportId: parentReportId },
          },
          ctx.stamp,
        );
      } catch (error) {
        deps.logger.error(DAILY_SESSION_MONITOR_LOG_EVENT, {
          stage: 'handler_completion_message_update_failed',
          messageId: ctx.messageId,
          reportId: parentReportId,
          error,
        });
      }

      deps.platformWebSocketManager.emitDailySessionUpdate({
        projectId: ctx.projectId,
        sessionId: ctx.runId,
        updateType: 'briefing_ready',
      });
    },
  };

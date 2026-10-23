import { ReportType } from '../shared/api/index';
import type { ImplementReportPayload } from '../shared/api/generated/api';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import type { PassThroughSubmissionToolDeclaration } from '../agents/submission-tools/types';
import type { ServerLogger } from '../server/logger';
import type { ReportChainEntry } from './types';
import type { Run } from './run';
import {
  groupFileChangeProjectionsByService,
  type FileChangeProjection,
  type ServiceFileChangeProjection,
} from './file-change-facts';

const CHANGED_WORKSPACE_IMPLEMENT_REPORT_PROMPT_TYPES = new Set<string>([
  LocalPromptType.FreeForm,
  LocalPromptType.CodingFreeform,
  LocalPromptType.Quick,
]);

const OPEN_IMPLEMENT_REPORT_SUMMARY =
  "Open completed the requested work and changed the service workspace, so this report records the material file changes for downstream review. The paths in filesChanged come from the Run's per-turn touched-file tracking. No separate implementation decisions were inferred; follow-up phases should inspect the diff for code detail and continue from the normal report chain.";

const TASK_ONLY_IMPLEMENT_REPORT_SUMMARY =
  "Task Only completed the requested work and changed the service workspace, so this report records the material file changes for downstream review without adding project grounding, feature synchronization, or structured plan creation. The paths in filesChanged come from the Run's per-turn touched-file tracking. No separate implementation decisions were inferred; follow-up phases should inspect the diff for code detail and continue from the normal report chain.";

export type ChangedWorkspaceImplementReportResult =
  | { status: 'emitted'; reports: readonly ServiceFileChangeProjection[] }
  | {
      status: 'skipped';
      reason:
        | 'unsupported-prompt'
        | 'no-files-changed'
        | 'implement-report-already-emitted'
        | 'missing-create-report-tool';
    };

export interface EmitChangedWorkspaceImplementReportInput {
  run: Run;
  logger: ServerLogger;
  promptType: string;
  fileChanges: readonly FileChangeProjection[];
  reportsSinceTurnStart: ReadonlyArray<Readonly<ReportChainEntry>>;
  createReportTool: PassThroughSubmissionToolDeclaration | null;
}

const isChangedWorkspaceImplementReportPromptType = (promptType: string): boolean =>
  CHANGED_WORKSPACE_IMPLEMENT_REPORT_PROMPT_TYPES.has(promptType);

const summaryForPromptType = (promptType: string): string =>
  promptType === LocalPromptType.Quick
    ? TASK_ONLY_IMPLEMENT_REPORT_SUMMARY
    : OPEN_IMPLEMENT_REPORT_SUMMARY;

export const emitChangedWorkspaceImplementReportIfNeeded = async (
  input: EmitChangedWorkspaceImplementReportInput,
): Promise<ChangedWorkspaceImplementReportResult> => {
  const { run, logger, promptType, reportsSinceTurnStart } = input;
  const serviceReports = groupFileChangeProjectionsByService(input.fileChanges);
  const filesChangedCount = serviceReports.reduce(
    (count, service) => count + service.filesChanged.length,
    0,
  );

  logger.debug('local.run.open_implement_report.evaluate', {
    runId: run.runId,
    promptType,
    serviceCount: serviceReports.length,
    filesChangedCount,
    reportsSinceTurnStart: reportsSinceTurnStart.length,
  });

  if (!isChangedWorkspaceImplementReportPromptType(promptType)) {
    logger.debug('local.run.open_implement_report.skipped', {
      runId: run.runId,
      promptType,
      reason: 'unsupported-prompt',
    });
    return { status: 'skipped', reason: 'unsupported-prompt' };
  }

  if (serviceReports.length === 0) {
    logger.debug('local.run.open_implement_report.skipped', {
      runId: run.runId,
      promptType,
      reason: 'no-files-changed',
    });
    return { status: 'skipped', reason: 'no-files-changed' };
  }

  const emittedImplementServiceIds = new Set<string>();
  let hasUnscopedImplementReport = false;
  for (const entry of reportsSinceTurnStart) {
    if (entry.reportType !== ReportType.Implement) continue;
    if (entry.serviceId) {
      emittedImplementServiceIds.add(entry.serviceId);
    } else {
      hasUnscopedImplementReport = true;
    }
  }

  if (hasUnscopedImplementReport) {
    logger.info('local.run.open_implement_report.skipped', {
      runId: run.runId,
      promptType,
      reason: 'implement-report-already-emitted',
      serviceIds: serviceReports.map((entry) => entry.serviceId),
    });
    return { status: 'skipped', reason: 'implement-report-already-emitted' };
  }

  const pendingServiceReports = serviceReports.filter(
    (entry) => !emittedImplementServiceIds.has(entry.serviceId),
  );

  if (pendingServiceReports.length === 0) {
    logger.info('local.run.open_implement_report.skipped', {
      runId: run.runId,
      promptType,
      reason: 'implement-report-already-emitted',
      serviceIds: serviceReports.map((entry) => entry.serviceId),
    });
    return { status: 'skipped', reason: 'implement-report-already-emitted' };
  }

  if (input.createReportTool === null) {
    logger.error('local.run.open_implement_report.create_report_tool_missing', {
      runId: run.runId,
      promptType,
      serviceIds: pendingServiceReports.map((entry) => entry.serviceId),
    });
    return { status: 'skipped', reason: 'missing-create-report-tool' };
  }

  for (const serviceReport of pendingServiceReports) {
    const payload: ImplementReportPayload = {
      reportType: ReportType.Implement,
      summary: summaryForPromptType(promptType),
      filesChanged: serviceReport.filesChanged,
      decisions: [],
    };

    const entities = [
      ...(run.taskId !== null
        ? [{ entityType: 'TASK', entityId: run.taskId, relation: 'PRIMARY' as const }]
        : []),
      {
        entityType: 'AGENT_SESSION',
        entityId: run.session.agentic_session_id,
        relation: 'CONTEXT' as const,
      },
      {
        entityType: 'SERVICE',
        entityId: serviceReport.serviceId,
        relation: 'CONTEXT' as const,
      },
    ];

    logger.info('local.run.open_implement_report.emit.start', {
      runId: run.runId,
      promptType,
      serviceId: serviceReport.serviceId,
      filesChanged: serviceReport.filesChanged,
    });

    await input.createReportTool.execute({
      runId: run.runId,
      run,
      args: {
        reportType: ReportType.Implement,
        audience: 'PROJECT_VISIBLE',
        payload,
        entities,
      },
    });

    logger.info('local.run.open_implement_report.emit.succeeded', {
      runId: run.runId,
      promptType,
      serviceId: serviceReport.serviceId,
      filesChanged: serviceReport.filesChanged,
    });
  }

  return { status: 'emitted', reports: pendingServiceReports };
};

const isOpenImplementReportPromptType = isChangedWorkspaceImplementReportPromptType;
export const emitOpenImplementReportIfNeeded = emitChangedWorkspaceImplementReportIfNeeded;

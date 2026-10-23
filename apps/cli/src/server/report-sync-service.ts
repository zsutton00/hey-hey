/**
 * Report Sync Service
 *
 * Syncs structured reports (rollup proposal) to the platform Reports API.
 * Executes response-dispatch side effects produced when a structured agent
 * response is detected.
 *
 * This module owns:
 * - Report payload construction (pure helpers)
 * - Platform API calls (create reports)
 * - Side effect executor (dispatches ResponseDispatchSideEffect → API call)
 */

import {
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  type CreateReportDto,
  type RollupProposalReportPayload,
} from '../shared/api/index';
import type { LocalRollupProposalResponse } from '../shared/agent-bridge-contract/index';
import { LocalAgentApiError } from '../shared/agent-bridge-contract/errors';
import type { OAuthClient } from '../auth/index';
import type { RunStore } from '../run-store/run-store';
import type { AgenticSession } from '../session/index';
import type { ResponseDispatchSideEffect } from '../agents/response-dispatch';
import type { ServerLogger } from './logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportSyncServiceOptions {
  oauthClient: OAuthClient;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  runStore: RunStore;
  logger: ServerLogger;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const readNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null;

const parseJsonObject = (value: string): Record<string, unknown> | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return toRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReportSyncService {
  public constructor(private readonly options: ReportSyncServiceOptions) {}

  public async syncRollupProposalReport(input: {
    runId: string;
    run: AgenticSession;
    rollupProposal: LocalRollupProposalResponse;
    taskId: string;
  }): Promise<void> {
    const { oauthClient, apiBaseUrl, fetchImpl, logger } = this.options;
    logger.debug('report_sync.rollup_proposal.started', {
      runId: input.runId,
      localRunId: input.run.agentic_session_id,
      taskId: input.taskId,
    });

    const organizationId = input.run.contextMetadata?.organizationId;
    if (!organizationId) {
      logger.warn('report_sync.rollup_proposal.no_org', {
        runId: input.runId,
        localRunId: input.run.agentic_session_id,
      });
      return;
    }

    const tokenResult = await oauthClient.getAccessToken();
    if (!tokenResult.success) {
      throw new LocalAgentApiError(
        'INVALID_REQUEST',
        `Cannot create rollup proposal report: ${tokenResult.error}`,
        401,
      );
    }
    const accessToken = tokenResult.data;

    const agentSessionId = input.run.agentic_session_id;
    const triggeredBy = agentSessionId;
    const triggeredAt = new Date().toISOString();

    const entities: NonNullable<CreateReportDto['entities']> = [
      {
        entityType: ReportRelatedEntityType.Task,
        entityId: input.taskId,
        relation: ReportEntityRelation.Primary,
      },
      {
        entityType: ReportRelatedEntityType.AgentSession,
        entityId: agentSessionId,
        relation: ReportEntityRelation.Context,
      },
    ];

    const parentCount = input.rollupProposal.parentFeatureProposalIds.length;
    const relatedCount = input.rollupProposal.relatedFeatureProposalIds.length;
    const rollupPayload: RollupProposalReportPayload = {
      reportType: ReportType.RollupProposal,
      summary: `Rollup proposal for task ${input.taskId}: ${parentCount} parent feature proposal${parentCount === 1 ? '' : 's'} and ${relatedCount} related feature proposal${relatedCount === 1 ? '' : 's'} produced from this coding session. Downstream reviewers should reconcile each listed proposal against the parent or related feature it edits before approving the rollup.`,
      taskId: input.taskId,
      triggeredBy,
      triggeredAt,
      parentFeatures: input.rollupProposal.parentFeatureProposalIds,
      relatedFeatures: input.rollupProposal.relatedFeatureProposalIds,
    };

    const createPayload: CreateReportDto = {
      reportType: ReportType.RollupProposal,
      audience: ReportAudience.ProjectVisible,
      payload: rollupPayload,
      schemaVersion: 1,
      sourceExecutionId: agentSessionId,
      entities,
    };

    const reportsEndpoint = `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}/reports`;

    // Check for existing report to avoid duplicates.
    const lookupParams = new URLSearchParams({
      reportType: ReportType.RollupProposal,
      entityType: ReportRelatedEntityType.AgentSession,
      entityId: agentSessionId,
      relation: ReportEntityRelation.Context,
      limit: '1',
    });
    const lookupResponse = await fetchImpl(`${reportsEndpoint}?${lookupParams.toString()}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const rawLookupBody = await lookupResponse.text();
    const lookupBody = parseJsonObject(rawLookupBody);
    if (!lookupResponse.ok) {
      const remoteError = readNonEmptyString(lookupBody?.['error']);
      const message =
        remoteError ??
        (rawLookupBody.trim().length > 0
          ? rawLookupBody.trim()
          : `Rollup proposal report lookup failed with status ${String(lookupResponse.status)}.`);
      throw new LocalAgentApiError('INTERNAL', message, lookupResponse.status);
    }
    const existingReports = Array.isArray(lookupBody?.['data']) ? lookupBody['data'] : [];
    if (existingReports.length > 0) {
      logger.debug('report_sync.rollup_proposal.skipped_duplicate', {
        runId: input.runId,
        localRunId: input.run.agentic_session_id,
      });
      return;
    }

    const syncResponse = await fetchImpl(reportsEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createPayload),
    });

    const rawSyncBody = await syncResponse.text();
    const syncBody = parseJsonObject(rawSyncBody);
    if (!syncResponse.ok) {
      const remoteError = readNonEmptyString(syncBody?.['error']);
      const message =
        remoteError ??
        (rawSyncBody.trim().length > 0
          ? rawSyncBody.trim()
          : `Rollup proposal report creation failed with status ${String(syncResponse.status)}.`);
      throw new LocalAgentApiError('INTERNAL', message, syncResponse.status);
    }

    const syncData = toRecord(syncBody?.['data']);
    const reportId = readNonEmptyString(syncData?.['id']);

    logger.debug('report_sync.rollup_proposal.succeeded', {
      runId: input.runId,
      localRunId: input.run.agentic_session_id,
      reportId: reportId ?? 'unknown',
    });
  }

  public async executeSideEffect(input: {
    runId: string;
    effect: ResponseDispatchSideEffect;
  }): Promise<void> {
    switch (input.effect.type) {
      case 'sync_rollup_proposal_report': {
        const latestRun = await this.options.runStore.getRunWithEvents(input.runId);
        if (!latestRun) {
          this.options.logger.warn('report_sync.side_effect.run_missing', {
            runId: input.runId,
            localRunId: input.runId,
            effectType: input.effect.type,
          });
          return;
        }
        await this.syncRollupProposalReport({
          runId: input.runId,
          run: latestRun,
          rollupProposal: input.effect.rollupProposal,
          taskId: input.effect.taskId,
        });
        return;
      }
    }
  }
}

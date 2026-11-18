import { Configuration, ReportsApi } from '@hey-hey/contracts/api';
import type { ImplementReportEdit } from '@hey-hey/contracts/api/models';
import type { OAuthClient } from '../auth/oauth-client';
import { NOOP_LOGGER, type ServerLogger } from './logger';

const PAGE_SIZE = 100;
/** Bounds one membership check; a Run with more recorded reports fails closed. */
const MAX_PAGES = 50;

export interface RecordedEditScope {
  organizationId: string;
  projectId: string;
  /** The Run's id, which is also its Agent Session's id. */
  agentSessionId: string;
  serviceId: string;
}

/** The durable record could not be consulted, so membership is unknown. */
export class RecordedEditLedgerUnavailableError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(`The recorded edits could not be checked: ${reason}.`, options);
    this.name = 'RecordedEditLedgerUnavailableError';
  }
}

const sameRanges = (
  left: ImplementReportEdit['beforeRanges'],
  right: ImplementReportEdit['beforeRanges'],
): boolean =>
  left.length === right.length &&
  left.every(
    (range, index) =>
      range.startLine === right[index]?.startLine && range.endLine === right[index]?.endLine,
  );

/** Every field the read depends on must match; a client cannot re-pair versions or paths. */
export const isSameRecordedEdit = (
  left: ImplementReportEdit,
  right: ImplementReportEdit,
): boolean =>
  left.path === right.path &&
  left.turnId === right.turnId &&
  left.occurredAt === right.occurredAt &&
  left.beforeObjectId === right.beforeObjectId &&
  left.afterObjectId === right.afterObjectId &&
  left.approximate === right.approximate &&
  left.versionsRecorded === right.versionsRecorded &&
  sameRanges(left.beforeRanges, right.beforeRanges) &&
  sameRanges(left.afterRanges, right.afterRanges);

/**
 * The stored IMPLEMENT reports are the durable record of a Run's edits; they outlive the
 * local file-change projection. A recorded edit may be read only if it appears in one of the
 * Run's reports for the addressed Service.
 */
export class RecordedEditLedger {
  public constructor(
    private readonly oauthClient: Pick<OAuthClient, 'getAccessToken'>,
    private readonly apiBaseUrl: string,
    private readonly logger: ServerLogger = NOOP_LOGGER,
  ) {}

  public async contains(scope: RecordedEditScope, edit: ImplementReportEdit): Promise<boolean> {
    const token = await this.oauthClient.getAccessToken();
    if (!token.success) {
      throw new RecordedEditLedgerUnavailableError(`not authenticated (${token.error})`);
    }
    const client = new ReportsApi(
      new Configuration({ accessToken: token.data, basePath: this.apiBaseUrl }),
    );
    try {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await client.listProjectChanges({
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          agentSessionId: scope.agentSessionId,
          serviceId: scope.serviceId,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        });
        const changes = response.data.data;
        for (const record of changes.records) {
          const payload = record.report.payload;
          if (
            payload.reportType === 'IMPLEMENT' &&
            (payload.edits ?? []).some((stored) => isSameRecordedEdit(stored, edit))
          ) {
            return true;
          }
        }
        if (!changes.hasMore) {
          return false;
        }
      }
    } catch (error) {
      this.logger.warn('local.recorded_edit_ledger.lookup_failed', {
        runId: scope.agentSessionId,
        serviceId: scope.serviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new RecordedEditLedgerUnavailableError('the report lookup failed', { cause: error });
    }
    this.logger.warn('local.recorded_edit_ledger.page_limit_reached', {
      runId: scope.agentSessionId,
      serviceId: scope.serviceId,
      maxPages: MAX_PAGES,
    });
    throw new RecordedEditLedgerUnavailableError('the Run has too many recorded reports');
  }
}

import { ReportsApi } from '@hey-hey/contracts/api';
import {
  ReportRelatedEntityType,
  ReportType,
  ReportSortBy,
  ReportSortOrder,
  type ReadRestriction,
  type ReportDto,
} from '@hey-hey/contracts/api/models';
import { RunEntityReferenceEntityTypeEnum as RunEntityType } from '@hey-hey/contracts/agent-bridge';
import type { RunEntityReference } from '@hey-hey/contracts/agent-bridge';
import { Configuration } from '@hey-hey/contracts/api/configuration';
import { restrictedConfiguration } from '../shared/api/read-restriction';
import type { ServerLogger } from '../server/logger';
import type { SelectableReport } from './entity-prompt-template-reports';

export interface EntityReportReadScope {
  organizationId: string;
  projectId: string;
  accessToken: string;
  readRestriction?: ReadRestriction | undefined;
}

export interface EntityReportReaderOptions {
  apiBaseUrl: string;
  logger: ServerLogger;
  /** Overrides the platform client; tests supply a stub at this network boundary. */
  createClient?: (configuration: Configuration) => Pick<ReportsApi, 'listReports' | 'getReport'>;
}

const isReportType = (value: string): value is ReportType =>
  Object.values<string>(ReportType).includes(value);

const reportEntityTypeFor = (
  entityType: RunEntityReference['entityType'],
): ReportRelatedEntityType | null => {
  switch (entityType) {
    case RunEntityType.Task:
      return ReportRelatedEntityType.Task;
    case RunEntityType.Project:
      return ReportRelatedEntityType.Project;
    case RunEntityType.DesignDoc:
      return ReportRelatedEntityType.DesignDoc;
    case RunEntityType.AgentSession:
      return ReportRelatedEntityType.AgentSession;
    default:
      return null;
  }
};

/**
 * Reads saved reports attached to one focal entity. Listing is newest first and
 * restricted to reports eligible as project knowledge, so the first page always
 * holds the newest report of a type no matter how many exist.
 */
export class EntityReportReader {
  private readonly apiBaseUrl: string;
  private readonly logger: ServerLogger;
  private readonly createClient: NonNullable<EntityReportReaderOptions['createClient']>;

  public constructor(options: EntityReportReaderOptions) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.logger = options.logger;
    this.createClient =
      options.createClient ?? ((configuration): ReportsApi => new ReportsApi(configuration));
  }

  public async listNewest(
    scope: EntityReportReadScope,
    focalEntity: RunEntityReference,
    reportType: string,
  ): Promise<SelectableReport[]> {
    const entityType = reportEntityTypeFor(focalEntity.entityType);
    if (entityType === null) {
      return [];
    }

    // A template can name a type the platform does not know; no such report exists.
    if (!isReportType(reportType)) {
      this.logger.debug('entity_report_reader.unknown_report_type', { reportType });
      return [];
    }

    this.logger.debug('entity_report_reader.list_started', {
      focalEntityType: focalEntity.entityType,
      reportType,
    });
    const response = await this.client(scope).listReports({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      reportType,
      entityType,
      entityId: focalEntity.entityId,
      ragEnabled: true,
      sortBy: ReportSortBy.CreatedAt,
      sortOrder: ReportSortOrder.Desc,
    });

    const reports = response.data.data ?? [];
    this.logger.debug('entity_report_reader.list_completed', {
      focalEntityType: focalEntity.entityType,
      reportType,
      count: reports.length,
    });

    return reports.map((report) => ({
      reportId: report.id,
      reportType: report.reportType,
      createdAt: report.createdAt,
    }));
  }

  public async readBody(scope: EntityReportReadScope, reportId: string): Promise<ReportDto> {
    this.logger.debug('entity_report_reader.body_started', { reportId });
    const response = await this.client(scope).getReport({
      organizationId: scope.organizationId,
      reportId,
    });

    const report = response.data.data;
    if (!report) {
      throw new Error(`Report ${reportId} was not returned.`);
    }

    return report;
  }

  private client(scope: EntityReportReadScope): Pick<ReportsApi, 'listReports' | 'getReport'> {
    return this.createClient(
      restrictedConfiguration(
        { accessToken: scope.accessToken, basePath: this.apiBaseUrl },
        scope.readRestriction,
      ),
    );
  }
}

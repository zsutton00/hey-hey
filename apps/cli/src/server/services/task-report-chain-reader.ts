import type { ReportChainEntry } from '../../run/types';
import type { PlatformAuthContext } from '../platform-auth-context';
import type { ServerLogger } from '../logger';
import { fetchTaskReportChain } from '../reports/fetch-task-report-chain';

export interface TaskReportChainReaderDependencies {
  authContext: PlatformAuthContext;
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: ServerLogger;
}

/** Reads the durable report history used to seed a task-scoped Run. */
export class TaskReportChainReader {
  public constructor(private readonly dependencies: TaskReportChainReaderDependencies) {}

  public async read(taskId: string): Promise<ReportChainEntry[]> {
    const auth = await this.dependencies.authContext.resolve();
    if (!auth) {
      this.dependencies.logger.warn('report-chain.seed.auth-unavailable', { taskId });
      return [];
    }
    return fetchTaskReportChain(
      {
        organizationId: auth.organizationId,
        projectId: auth.projectId,
        accessToken: auth.accessToken,
        apiBaseUrl: this.dependencies.apiBaseUrl,
        fetchImpl: this.dependencies.fetchImpl,
        logger: this.dependencies.logger,
      },
      taskId,
    );
  }
}

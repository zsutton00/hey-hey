import { Configuration, TasksApi } from '@hey-hey/contracts/api';

/**
 * Reads each Eval Case's creation time once per eval run. A failed read is cached too, so every
 * attempt of that case fails with the same reason and no attempt searches without a cutoff.
 */
export class EvalCaseCreatedAt {
  private readonly reads = new Map<string, Promise<string>>();
  private readonly client: TasksApi;

  public constructor(
    private readonly scope: { organizationId: string; projectId: string },
    connection: { accessToken: string; apiBaseUrl: string },
  ) {
    this.client = new TasksApi(
      new Configuration({ accessToken: connection.accessToken, basePath: connection.apiBaseUrl }),
    );
  }

  public read(evalCaseId: string): Promise<string> {
    let read = this.reads.get(evalCaseId);
    if (!read) {
      read = this.fetch(evalCaseId);
      this.reads.set(evalCaseId, read);
    }

    return read;
  }

  private async fetch(evalCaseId: string): Promise<string> {
    try {
      const response = await this.client.organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet(
        {
          organizationId: this.scope.organizationId,
          projectId: this.scope.projectId,
          taskId: evalCaseId,
        },
      );
      const createdAt = response.data.data?.createdAt;
      if (!createdAt || Number.isNaN(Date.parse(createdAt))) {
        throw new Error('the platform returned no creation time');
      }

      return createdAt;
    } catch (error) {
      throw new Error(
        `Could not read the creation time of Eval Case ${evalCaseId}, so its search cutoff is unknown: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }
}

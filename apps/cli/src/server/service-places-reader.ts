import type {
  CliReadServicePlacesEntry,
  CliReadWorkspaceServicePlacesListEnvelopeBody,
} from '@hey-hey/contracts/agent-bridge';
import { isGitRepository, readWorktreeInventory, searchLocalBranches } from '../git/worktree';
import { RepoMappingNotFoundError } from '../repo/errors';
import type { RepoMappingStore } from '../repo';
import { toServiceId } from '../repo';
import type { ServerLogger } from './logger';

export const SERVICE_PLACE_BRANCH_SEARCH_LIMIT = 20;

/**
 * Reads where each Service can work on this machine: main folder branch,
 * registered worktrees and a bounded branch search. Read-only: nothing is
 * checked out or created. One Service's failure becomes its own error entry.
 */
export class ServicePlacesReader {
  public constructor(
    private readonly repositories: RepoMappingStore,
    private readonly logger: ServerLogger,
  ) {}

  public async read(
    body: Pick<CliReadWorkspaceServicePlacesListEnvelopeBody, 'serviceIds' | 'branchQuery'>,
  ): Promise<CliReadServicePlacesEntry[]> {
    return Promise.all(
      body.serviceIds.map((serviceId) => this.readService(serviceId, body.branchQuery ?? '')),
    );
  }

  private async readService(
    serviceId: string,
    branchQuery: string,
  ): Promise<CliReadServicePlacesEntry> {
    const entry = await this.buildEntry(serviceId, branchQuery);

    this.logger.debug('service-places.service.read', {
      serviceId,
      status: entry.status,
      ...(entry.status === 'error'
        ? { code: entry.code, reason: entry.message }
        : {
            worktreeCount: entry.worktrees.length,
            branchMatchCount: entry.branchMatches.length,
            branchMatchesTruncated: entry.branchMatchesTruncated,
          }),
    });

    return entry;
  }

  private async buildEntry(
    serviceId: string,
    branchQuery: string,
  ): Promise<CliReadServicePlacesEntry> {
    let repositoryPath: string;
    try {
      repositoryPath = await this.repositories.resolvePathForService(toServiceId(serviceId));
    } catch (error) {
      if (error instanceof RepoMappingNotFoundError) {
        return {
          serviceId,
          status: 'error',
          code: 'NO_REPOSITORY_PATH',
          message: 'This Service has no repository path on this machine.',
        };
      }

      return readFailed(serviceId, error);
    }

    try {
      if (!(await isGitRepository(repositoryPath))) {
        return {
          serviceId,
          status: 'error',
          code: 'NOT_A_GIT_REPOSITORY',
          message: 'The Service folder on this machine is not a git repository.',
        };
      }

      const [inventory, search] = await Promise.all([
        readWorktreeInventory(repositoryPath),
        searchLocalBranches(repositoryPath, branchQuery, SERVICE_PLACE_BRANCH_SEARCH_LIMIT),
      ]);

      return {
        serviceId,
        status: 'ok',
        mainFolder: {
          path: inventory.mainFolder.worktreePath,
          branch: inventory.mainFolder.branch,
        },
        worktrees: inventory.linkedWorktrees,
        branchMatches: search.branches,
        branchMatchesTruncated: search.truncated,
      };
    } catch (error) {
      return readFailed(serviceId, error);
    }
  }
}

const readFailed = (serviceId: string, error: unknown): CliReadServicePlacesEntry => ({
  serviceId,
  status: 'error',
  code: 'READ_FAILED',
  message: `Reading this Service's places failed: ${error instanceof Error ? error.message : String(error)}`,
});

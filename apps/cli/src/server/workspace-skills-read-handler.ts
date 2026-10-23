import { CodexSkillCatalog } from '../agents/providers/codex/codex-skill-catalog';
import { RepoMappingStore, resolveCanonicalDirectory, toServiceId } from '../repo';
import type {
  CliReadWorkspaceSkillsListEnvelopeBody,
  CliReadResponseDto,
} from '../shared/agent-bridge-contract/generated/api';
import type { ServerLogger } from './logger';

/** Owns catalog discovery independently of Run restoration and provider sessions. */
export class WorkspaceSkillsReadHandler {
  private readonly catalog = new CodexSkillCatalog();
  constructor(
    private readonly repositories: RepoMappingStore,
    private readonly logger: ServerLogger,
  ) {}

  async read(
    body: CliReadWorkspaceSkillsListEnvelopeBody,
    userId: string,
  ): Promise<CliReadResponseDto> {
    if (body.provider !== 'codex') {
      return {
        requestId: body.requestId,
        operation: body.operation,
        status: 'error',
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Installed Skills are currently available for Codex only.',
        },
      };
    }
    const authorityId = JSON.stringify([
      body.organizationId,
      body.projectId,
      body.machineId,
      userId,
      body.provider,
      body.catalogContext,
    ]);
    let cwd: string | null = null;
    if (body.catalogContext.policy === 'service_workspace') {
      try {
        cwd = await resolveCanonicalDirectory(
          await this.repositories.resolvePathForService(toServiceId(body.catalogContext.serviceId)),
        );
      } catch {
        return {
          requestId: body.requestId,
          operation: body.operation,
          status: 'error',
          error: {
            code: 'INVALID_WORKSPACE',
            message: 'The selected Service has no accessible directory on this machine.',
          },
        };
      }
    }
    this.logger.debug('workspace.skills.read.started', {
      requestId: body.requestId,
      policy: body.catalogContext.policy,
    });
    try {
      const result = await this.catalog.list(
        cwd === null
          ? { policy: 'non_repository', authorityId }
          : { policy: 'service_workspace', cwd, authorityId },
      );
      this.logger.debug('workspace.skills.read.completed', {
        requestId: body.requestId,
        skillCount: result.skills.length,
      });
      return { requestId: body.requestId, operation: body.operation, status: 'success', result };
    } catch (error) {
      const timeout = error instanceof Error && error.message.includes('timed out');
      this.logger.warn('workspace.skills.read.failed', { requestId: body.requestId, timeout });
      return {
        requestId: body.requestId,
        operation: body.operation,
        status: 'error',
        error: {
          code: timeout ? 'TIMEOUT' : 'PROVIDER_FAILURE',
          message: timeout
            ? 'Skill discovery timed out. Try again.'
            : 'Codex could not read the installed Skill catalog. Try again.',
        },
      };
    }
  }
}

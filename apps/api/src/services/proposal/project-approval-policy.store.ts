import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ProjectId } from 'src/types';
import type { ProjectApprovalPolicyRule } from 'src/generated';

export interface StoredProjectApprovalPolicy {
  revision: number;
  rules: unknown;
}

@Injectable()
export class ProjectApprovalPolicyStore {
  private readonly logger = new Logger(ProjectApprovalPolicyStore.name);
  constructor(private readonly prisma: PrismaService) {}

  async read(projectId: ProjectId): Promise<StoredProjectApprovalPolicy> {
    const rows = await this.prisma.db.$queryRaw<StoredProjectApprovalPolicy[]>`
      SELECT revision, rules FROM project_approval_policy_configurations
      WHERE project_id = ${projectId}`;
    return rows[0] ?? { revision: 0, rules: null };
  }

  async write(
    projectId: ProjectId,
    expectedRevision: number,
    rules: ProjectApprovalPolicyRule[] | null,
  ): Promise<StoredProjectApprovalPolicy> {
    return this.prisma.db.$transaction(async (tx) => {
      // Lock the always-present project, including before the first policy row.
      const projects = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM projects WHERE id = ${projectId} AND deleted_at IS NULL FOR UPDATE`;
      if (projects.length === 0) {
        throw new NotFoundException('Project not found');
      }
      const rows = await tx.$queryRaw<StoredProjectApprovalPolicy[]>`
        SELECT revision, rules FROM project_approval_policy_configurations WHERE project_id = ${projectId}`;
      const currentRevision = rows[0]?.revision ?? 0;
      if (currentRevision !== expectedRevision) {
        this.logger.warn('Project approval policy revision conflict', {
          projectId,
          expectedRevision,
          currentRevision,
        });
        throw new ConflictException({
          code: 'PROJECT_APPROVAL_POLICY_REVISION_CONFLICT',
          message: 'Reread the policy before saving',
          expectedRevision,
          currentRevision,
        });
      }
      const revision = currentRevision + 1;
      // Serialize only at the SQL JSON boundary. SQL NULL denotes no override.
      const document = rules === null ? null : JSON.stringify(rules);
      await tx.$executeRaw`
        INSERT INTO project_approval_policy_configurations (project_id, revision, rules, updated_at)
        VALUES (${projectId}, ${revision}, ${document}::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (project_id) DO UPDATE SET revision = EXCLUDED.revision,
          rules = EXCLUDED.rules, updated_at = EXCLUDED.updated_at`;
      this.logger.log('Project approval policy persisted', {
        projectId,
        revision,
        hasProjectOverride: rules !== null,
      });
      return { revision, rules };
    });
  }
}

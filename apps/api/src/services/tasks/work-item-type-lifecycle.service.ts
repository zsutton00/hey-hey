import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma, WorkItemType } from '@prisma/client';
import type { WorkItemTypeDefinitionDto } from '../../generated/model/workItemTypeDefinitionDto';
import type { OrganizationId, ProjectId } from '../../types';
import { WorkItemTypeRegistryService } from './work-item-type-registry.service';

export interface WorkItemTypeLifecyclePostCommit {
  runPostCommit: () => Promise<void>;
}

export interface ResolvedWorkItemTypeLifecycleRow {
  row: WorkItemType;
  definition: WorkItemTypeDefinitionDto;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function definitionsMatch(
  expected: WorkItemTypeDefinitionDto,
  retained: WorkItemTypeDefinitionDto,
): boolean {
  return stableSerialize(expected) === stableSerialize(retained);
}

/**
 * Owns lifecycle transitions for project-owned work-item type rows. The
 * registry remains the read snapshot and invalidation publisher; this service
 * is the only approval-side owner of ACTIVE/ARCHIVED state changes.
 */
@Injectable()
export class WorkItemTypeLifecycleService {
  private readonly logger = new Logger(WorkItemTypeLifecycleService.name);

  constructor(
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  async resolveInTransaction(
    tx: Prisma.TransactionClient,
    typeKey: string,
    projectId: ProjectId,
  ): Promise<ResolvedWorkItemTypeLifecycleRow | null> {
    const row = await tx.workItemType.findFirst({
      where: { typeKey, projectId },
    });
    this.logger.debug('Resolved project-owned work-item type lifecycle row', {
      typeKey,
      projectId,
      rowId: row?.id ?? null,
      lifecycleStatus: row?.lifecycleStatus ?? null,
    });
    if (!row) {
      return null;
    }

    const definition = this.workItemTypeRegistry.materializeDefinition(row);
    if (!definition) {
      throw new BadRequestException(
        `Work-item type '${typeKey}' has an invalid retained definition.`,
      );
    }
    return { row, definition };
  }

  async archiveInTransaction(
    tx: Prisma.TransactionClient,
    typeKey: string,
    projectId: ProjectId,
    organizationId: OrganizationId,
  ): Promise<WorkItemTypeLifecyclePostCommit> {
    const resolved = await this.resolveInTransaction(tx, typeKey, projectId);
    if (!resolved) {
      this.logger.debug('Rejected archive: project-owned target is missing', {
        typeKey,
        projectId,
      });
      throw new BadRequestException(
        `Active work-item type '${typeKey}' is not available in this project.`,
      );
    }
    if (resolved.row.lifecycleStatus !== 'active') {
      this.logger.debug('Rejected archive: target is not active', {
        typeKey,
        projectId,
        rowId: resolved.row.id,
        lifecycleStatus: resolved.row.lifecycleStatus,
      });
      throw new ConflictException(
        `Work-item type '${typeKey}' is no longer active in this project.`,
      );
    }

    const result = await tx.workItemType.updateMany({
      where: {
        id: resolved.row.id,
        projectId,
        lifecycleStatus: 'active',
      },
      // Lifecycle transitions must not replace definition or provenance data.
      data: { lifecycleStatus: 'archived' },
    });
    this.logger.debug('Applied guarded ACTIVE-to-ARCHIVED transition', {
      typeKey,
      projectId,
      rowId: resolved.row.id,
      updatedRows: result.count,
    });
    if (result.count !== 1) {
      throw new ConflictException(
        `Work-item type '${typeKey}' changed before it could be archived.`,
      );
    }

    return this.postCommitInvalidation(
      organizationId,
      typeKey,
      projectId,
      'archive',
    );
  }

  async restoreInTransaction(
    tx: Prisma.TransactionClient,
    typeKey: string,
    definition: WorkItemTypeDefinitionDto,
    projectId: ProjectId,
    organizationId: OrganizationId,
  ): Promise<WorkItemTypeLifecyclePostCommit> {
    const resolved = await this.resolveInTransaction(tx, typeKey, projectId);
    if (!resolved) {
      this.logger.debug('Rejected restore: project-owned target is missing', {
        typeKey,
        projectId,
      });
      throw new BadRequestException(
        `Archived work-item type '${typeKey}' is not available in this project.`,
      );
    }
    if (resolved.row.lifecycleStatus !== 'archived') {
      this.logger.debug('Rejected restore: target is not archived', {
        typeKey,
        projectId,
        rowId: resolved.row.id,
        lifecycleStatus: resolved.row.lifecycleStatus,
      });
      throw new ConflictException(
        `Work-item type '${typeKey}' is no longer archived in this project.`,
      );
    }
    if (!definitionsMatch(definition, resolved.definition)) {
      this.logger.debug('Rejected restore: submitted definition is stale', {
        typeKey,
        projectId,
        rowId: resolved.row.id,
      });
      throw new ConflictException(
        `Work-item type '${typeKey}' does not match its retained definition.`,
      );
    }

    const result = await tx.workItemType.updateMany({
      where: {
        id: resolved.row.id,
        projectId,
        lifecycleStatus: 'archived',
      },
      // Restore the retained row in place. Never insert a replacement or
      // rewrite definition/provenance/revision columns here.
      data: { lifecycleStatus: 'active' },
    });
    this.logger.debug('Applied guarded ARCHIVED-to-ACTIVE transition', {
      typeKey,
      projectId,
      rowId: resolved.row.id,
      updatedRows: result.count,
    });
    if (result.count !== 1) {
      throw new ConflictException(
        `Work-item type '${typeKey}' changed before it could be restored.`,
      );
    }

    return this.postCommitInvalidation(
      organizationId,
      typeKey,
      projectId,
      'restore',
    );
  }

  private postCommitInvalidation(
    organizationId: OrganizationId,
    typeKey: string,
    projectId: ProjectId,
    transition: 'archive' | 'restore',
  ): WorkItemTypeLifecyclePostCommit {
    return {
      runPostCommit: async () => {
        this.logger.debug('Publishing work-item type registry invalidation', {
          typeKey,
          organizationId,
          transition,
        });
        await this.workItemTypeRegistry.publishConfigChanged(
          organizationId,
          typeKey,
          projectId,
        );
      },
    };
  }
}

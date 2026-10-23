import {
  ENTITY_RESOURCES,
  ProjectResourceAccessService,
} from '../../auth/services/project-resource-access.service';
import { ForbiddenException } from '@nestjs/common';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EntityStar, EntityType, Prisma } from '@prisma/client';
import { EntityStarDto } from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';
import { ensureStringDate } from 'src/utils/date.util';
import { OrganizationId, UserId } from 'src/types';

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;

@Injectable()
export class EntityStarService {
  private readonly logger = new Logger(EntityStarService.name);

  constructor(
    private readonly projectResources: ProjectResourceAccessService,
    private readonly prisma: PrismaService,
    private readonly entityRegistryService: EntityRegistryService,
  ) {}

  async createOrGetStar(params: {
    organizationId: OrganizationId;
    userId: UserId;
    entityType: EntityType;
    entityId: string;
  }): Promise<EntityStarDto> {
    const entityName = await this.requireEntityName(
      params.organizationId,
      params.entityType,
      params.entityId,
    );

    try {
      const star = await this.prisma.db.entityStar.upsert({
        where: {
          organizationId_userId_entityType_entityId: {
            organizationId: params.organizationId,
            userId: params.userId,
            entityType: params.entityType,
            entityId: params.entityId,
          },
        },
        create: {
          organizationId: params.organizationId,
          userId: params.userId,
          entityType: params.entityType,
          entityId: params.entityId,
        },
        update: {},
      });

      return this.toDto(star, entityName);
    } catch (error) {
      this.logger.error('Failed to create entity star', {
        error: (error as Error).message,
        organizationId: params.organizationId,
        userId: params.userId,
        entityType: params.entityType,
        entityId: params.entityId,
      });
      throw new BadRequestException(
        `Failed to create entity star: ${(error as Error).message}`,
      );
    }
  }

  async listStars(params: {
    organizationId: OrganizationId;
    userId: UserId;
    entityType?: EntityType;
    limit?: number;
    offset?: number;
  }): Promise<EntityStarDto[]> {
    const limit = Math.min(params.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const offset = params.offset ?? 0;

    const where: Prisma.EntityStarWhereInput = {
      organizationId: params.organizationId,
      userId: params.userId,
    };

    if (params.entityType) {
      where.entityType = params.entityType;
    }

    // Resolve persisted ownership from identity-only rows before pagination or name reads.
    const candidates = await this.prisma.db.entityStar.findMany({
      where,
      select: { id: true, entityId: true, entityType: true },
    });
    const accessibleIds: string[] = [];
    for (const candidate of candidates) {
      const kind = ENTITY_RESOURCES[candidate.entityType];
      if (kind) {
        try {
          await this.projectResources.assertResource(
            params.userId,
            params.organizationId,
            kind,
            candidate.entityId,
          );
        } catch (error) {
          if (error instanceof ForbiddenException) continue;
          throw error;
        }
      }
      accessibleIds.push(candidate.id);
    }
    where.id = { in: accessibleIds };

    const stars = await this.prisma.db.entityStar.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    if (stars.length === 0) {
      return [];
    }

    const entities = await this.entityRegistryService.getEntitiesByIds({
      organizationId: params.organizationId,
      entities: stars.map((star) => ({
        entityId: star.entityId,
        entityType: star.entityType,
      })),
    });

    const entityMap = new Map(
      entities.map((entity) => [
        this.entityKey(entity.entityType, entity.entityId),
        entity.entityName,
      ]),
    );

    return stars
      .filter((star) =>
        entityMap.has(this.entityKey(star.entityType, star.entityId)),
      )
      .map((star) =>
        this.toDto(
          star,
          entityMap.get(this.entityKey(star.entityType, star.entityId)),
        ),
      );
  }

  async removeStar(params: {
    organizationId: OrganizationId;
    userId: UserId;
    entityType: EntityType;
    entityId: string;
  }): Promise<void> {
    await this.prisma.db.entityStar.deleteMany({
      where: {
        organizationId: params.organizationId,
        userId: params.userId,
        entityType: params.entityType,
        entityId: params.entityId,
      },
    });
  }

  private async requireEntityName(
    organizationId: OrganizationId,
    entityType: EntityType,
    entityId: string,
  ): Promise<string | undefined> {
    const entities = await this.entityRegistryService.getEntitiesByIds({
      organizationId,
      entities: [{ entityId, entityType }],
    });

    if (!entities[0]) {
      throw new NotFoundException(
        `Entity ${entityType} ${entityId} not found for organization ${organizationId}`,
      );
    }

    return entities[0].entityName;
  }

  private entityKey(entityType: EntityType, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  private toDto(
    star: EntityStar,
    entityName: string | undefined,
  ): EntityStarDto {
    return {
      id: star.id,
      organizationId: star.organizationId as OrganizationId,
      userId: star.userId as UserId,
      entityType: star.entityType,
      entityId: star.entityId,
      entityName: entityName ?? undefined,
      createdAt: ensureStringDate(star.createdAt),
    };
  }
}

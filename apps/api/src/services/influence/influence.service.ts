import { Injectable, Logger } from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId } from '../../types';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';

export type InfluenceEntityType =
  | 'artifact'
  | 'initiative'
  | 'task'
  | 'message'
  | 'design_doc';

export interface CreateInfluenceDto {
  influencedType: InfluenceEntityType;
  influencedId: string;
  influencingId: string;
  reasoning: string;
  reasonType: string;
  confidence?: number;
  organizationId: OrganizationId;
}

const registryToInfluenceType: Partial<
  Record<EntityType, InfluenceEntityType>
> = {
  [EntityType.ARTIFACT]: 'artifact',
  [EntityType.INITIATIVE]: 'initiative',
  [EntityType.TASK]: 'task',
  [EntityType.MESSAGE]: 'message',
  [EntityType.DESIGN_DOC]: 'design_doc',
};

@Injectable()
export class InfluenceService {
  private readonly logger = new Logger(InfluenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entityRegistryService: EntityRegistryService,
  ) {}

  /**
   * Create multiple influence relationships
   */
  async createMany(
    influences: CreateInfluenceDto[],
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    if (influences.length === 0) {
      this.logger.debug('[createMany] No influences to create');
      return 0;
    }

    this.logger.debug('[createMany] Creating influence records', {
      count: influences.length,
    });

    const influencingIds = Array.from(
      new Set(influences.map((influence) => influence.influencingId)),
    );
    const client =
      tx ?? (this.prisma.db as unknown as Prisma.TransactionClient);
    const registryTypeMap = await this.entityRegistryService.lookupEntityTypes(
      influencingIds,
      tx,
    );

    const payload = influences.map((influence) => ({
      influencedType: influence.influencedType,
      influencedId: influence.influencedId,
      influencingType: this.toInfluenceType(
        registryTypeMap[influence.influencingId],
      ),
      influencingId: influence.influencingId,
      reasoning: influence.reasoning,
      reasonType: influence.reasonType,
      confidence: influence.confidence,
      organizationId: influence.organizationId,
    }));

    const result = await client.influence.createMany({
      data: payload,
      skipDuplicates: true,
    });

    this.logger.log(`[createMany] Created ${result.count} influence records`);
    return result.count;
  }

  /**
   * Get all influences on a specific entity
   * (What influenced this entity)
   */
  async getInfluencesOn(
    entityType: InfluenceEntityType,
    entityId: string,
    organizationId: OrganizationId,
  ) {
    this.logger.debug('[getInfluencesOn] Fetching influences', {
      entityType,
      entityId,
      organizationId,
    });

    return this.prisma.db.influence.findMany({
      where: {
        influencedType: entityType,
        influencedId: entityId,
        organizationId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all influences by a specific entity
   * (What did this entity influence)
   */
  async getInfluencesBy(
    entityType: InfluenceEntityType,
    entityId: string,
    organizationId: OrganizationId,
  ) {
    this.logger.debug('[getInfluencesBy] Fetching influences', {
      entityType,
      entityId,
      organizationId,
    });

    return this.prisma.db.influence.findMany({
      where: {
        influencingType: entityType,
        influencingId: entityId,
        organizationId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Delete all influences for an entity (for cascade deletes)
   */
  async deleteInfluencesForEntity(
    entityType: InfluenceEntityType,
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<number> {
    this.logger.debug('[deleteInfluencesForEntity] Deleting influences', {
      entityType,
      entityId,
      organizationId,
    });

    const result = await this.prisma.db.influence.deleteMany({
      where: {
        OR: [
          { influencedType: entityType, influencedId: entityId },
          { influencingType: entityType, influencingId: entityId },
        ],
        organizationId,
      },
    });

    this.logger.log(
      `[deleteInfluencesForEntity] Deleted ${result.count} influence records`,
    );
    return result.count;
  }

  /**
   * Validate logic replaced by registry lookups. Remaining only for backwards compat
   */
  private toInfluenceType(entityType?: EntityType): InfluenceEntityType {
    const mapped = entityType ? registryToInfluenceType[entityType] : undefined;
    if (!mapped) {
      throw new Error(
        `Entity type ${entityType ?? 'unknown'} is not registered for influences`,
      );
    }
    return mapped;
  }
}

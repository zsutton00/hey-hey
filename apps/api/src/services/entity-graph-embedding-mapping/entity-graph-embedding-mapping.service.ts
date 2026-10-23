import { Injectable } from '@nestjs/common';
import {
  EntityGraphEmbeddingMapping,
  EntityType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId } from '../../types';

export interface MappingIdentifiers {
  organizationId: OrganizationId;
  entityType: EntityType;
  entityId: string;
}

export class EntityGraphEmbeddingMappingLookupError extends Error {
  constructor(
    message: string,
    public readonly details: { graphNodeId?: string; embeddingId?: string },
  ) {
    super(message);
  }
}

@Injectable()
export class EntityGraphEmbeddingMappingService {
  constructor(private readonly prisma: PrismaService) {}

  private getClient(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    if (tx) {
      return tx;
    }

    return this.prisma.db as unknown as Prisma.TransactionClient;
  }

  private requireValue(value: string | undefined, fieldName: string): string {
    if (!value || !value.trim()) {
      throw new Error(`${fieldName} is required`);
    }

    return value.trim();
  }

  private assertHasExternalId(params: {
    graphNodeId?: string;
    embeddingId?: string;
  }): void {
    const hasGraphNodeId = !!params.graphNodeId?.trim();
    const hasEmbeddingId = !!params.embeddingId?.trim();

    if (!hasGraphNodeId && !hasEmbeddingId) {
      throw new Error('graphNodeId or embeddingId is required');
    }
  }

  async upsertMapping(
    params: MappingIdentifiers & {
      graphNodeId?: string;
      embeddingId?: string;
      mappingVersion?: number;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<EntityGraphEmbeddingMapping> {
    const client = this.getClient(tx);
    const organizationId = this.requireValue(
      params.organizationId,
      'organizationId',
    );
    const entityId = this.requireValue(params.entityId, 'entityId');
    this.assertHasExternalId(params);

    const graphNodeId = params.graphNodeId?.trim();
    const embeddingId = params.embeddingId?.trim();
    const mappingVersion = params.mappingVersion ?? 1;

    const update: Prisma.EntityGraphEmbeddingMappingUpdateInput = {
      ...(graphNodeId ? { graphNodeId } : {}),
      ...(embeddingId ? { embeddingId } : {}),
      ...(params.mappingVersion ? { mappingVersion } : {}),
    };

    return client.entityGraphEmbeddingMapping.upsert({
      where: {
        organizationId_entityType_entityId: {
          organizationId,
          entityType: params.entityType,
          entityId,
        },
      },
      create: {
        organizationId,
        entityType: params.entityType,
        entityId,
        graphNodeId: graphNodeId ?? null,
        embeddingId: embeddingId ?? null,
        mappingVersion,
      },
      update,
    });
  }

  async registerGraphNodeId(
    params: MappingIdentifiers & {
      graphNodeId: string;
      mappingVersion?: number;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<EntityGraphEmbeddingMapping> {
    return this.upsertMapping(
      {
        ...params,
        graphNodeId: this.requireValue(params.graphNodeId, 'graphNodeId'),
      },
      tx,
    );
  }

  async registerEmbeddingId(
    params: MappingIdentifiers & {
      embeddingId: string;
      mappingVersion?: number;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<EntityGraphEmbeddingMapping> {
    return this.upsertMapping(
      {
        ...params,
        embeddingId: this.requireValue(params.embeddingId, 'embeddingId'),
      },
      tx,
    );
  }

  async getByEntityId(
    params: MappingIdentifiers,
    tx?: Prisma.TransactionClient,
  ): Promise<EntityGraphEmbeddingMapping | null> {
    const client = this.getClient(tx);
    const organizationId = this.requireValue(
      params.organizationId,
      'organizationId',
    );
    const entityId = this.requireValue(params.entityId, 'entityId');

    return client.entityGraphEmbeddingMapping.findUnique({
      where: {
        organizationId_entityType_entityId: {
          organizationId,
          entityType: params.entityType,
          entityId,
        },
      },
    });
  }

  async getByGraphNodeId(
    graphNodeId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EntityGraphEmbeddingMapping | null> {
    const client = this.getClient(tx);
    const normalizedGraphNodeId = this.requireValue(graphNodeId, 'graphNodeId');
    const matches = await client.entityGraphEmbeddingMapping.findMany({
      where: { graphNodeId: normalizedGraphNodeId },
    });

    if (matches.length > 1) {
      throw new EntityGraphEmbeddingMappingLookupError(
        'Multiple mappings found for graphNodeId',
        { graphNodeId: normalizedGraphNodeId },
      );
    }

    return matches[0] ?? null;
  }

  async getByEmbeddingId(
    embeddingId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<EntityGraphEmbeddingMapping | null> {
    const client = this.getClient(tx);
    const normalizedEmbeddingId = this.requireValue(embeddingId, 'embeddingId');
    const matches = await client.entityGraphEmbeddingMapping.findMany({
      where: { embeddingId: normalizedEmbeddingId },
    });

    if (matches.length > 1) {
      throw new EntityGraphEmbeddingMappingLookupError(
        'Multiple mappings found for embeddingId',
        { embeddingId: normalizedEmbeddingId },
      );
    }

    return matches[0] ?? null;
  }
}

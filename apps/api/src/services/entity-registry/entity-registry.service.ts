import { Injectable } from '@nestjs/common';
import { EntityRegistry, EntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId } from 'src/types';
import { EntitySearchResult } from 'src/generated';
import { NON_ARTIFACT_ENTITY_TYPES } from './entity-registry.constants';

interface EntityRegistryErrorDetails {
  missingIds?: string[];
  ambiguousIds?: string[];
}

export class EntityRegistryLookupError extends Error {
  constructor(
    message: string,
    public readonly details: EntityRegistryErrorDetails,
  ) {
    super(message);
  }
}

type EntitySearchResultWithStatus = EntitySearchResult & {
  status: string | null;
};

const TYPO_TOLERANCE_TOKEN_SIMILARITY_THRESHOLD = 0.18;

export enum EntityTitleMatchTier {
  ExactTitle = 1,
  ExactPrefix = 2,
  OrderedTokenPrefix = 3,
  TokenSubset = 4,
  TypoTolerant = 5,
  TrigramFallback = 6,
  NoMatch = 99,
}

export function normalizeEntityNameForSearch(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSearchTokens(text: string): string[] {
  return normalizeEntityNameForSearch(text)
    .split(' ')
    .filter((token) => token.length > 0);
}

export function hasOrderedTokenPrefixMatch(
  query: string,
  title: string,
): boolean {
  const queryTokens = splitSearchTokens(query);
  const titleTokens = splitSearchTokens(title);

  if (queryTokens.length === 0 || queryTokens.length > titleTokens.length) {
    return false;
  }

  return queryTokens.every((token, index) =>
    titleTokens[index]!.startsWith(token),
  );
}

export function hasTokenSubsetMatch(query: string, title: string): boolean {
  const queryTokens = splitSearchTokens(query);
  const titleTokens = splitSearchTokens(title);

  if (queryTokens.length === 0 || titleTokens.length === 0) {
    return false;
  }

  return queryTokens.every((queryToken) =>
    titleTokens.some((titleToken) => titleToken.startsWith(queryToken)),
  );
}

export function hasBoundedTypoTokenMatch(
  query: string,
  title: string,
): boolean {
  const queryTokens = splitSearchTokens(query);
  const titleTokens = splitSearchTokens(title);

  if (queryTokens.length === 0 || titleTokens.length === 0) {
    return false;
  }

  return queryTokens.every((queryToken) =>
    titleTokens.some(
      (titleToken) =>
        titleToken.startsWith(queryToken) ||
        isWithinBoundedTypoTolerance(queryToken, titleToken),
    ),
  );
}

export function rankEntityTitleMatch(
  query: string,
  title: string,
): EntityTitleMatchTier {
  const normalizedQuery = normalizeEntityNameForSearch(query);
  const normalizedTitle = normalizeEntityNameForSearch(title);

  if (!normalizedQuery || !normalizedTitle) {
    return EntityTitleMatchTier.NoMatch;
  }

  if (normalizedTitle === normalizedQuery) {
    return EntityTitleMatchTier.ExactTitle;
  }

  if (normalizedTitle.startsWith(normalizedQuery)) {
    return EntityTitleMatchTier.ExactPrefix;
  }

  if (hasOrderedTokenPrefixMatch(normalizedQuery, normalizedTitle)) {
    return EntityTitleMatchTier.OrderedTokenPrefix;
  }

  if (hasTokenSubsetMatch(normalizedQuery, normalizedTitle)) {
    return EntityTitleMatchTier.TokenSubset;
  }

  if (hasBoundedTypoTokenMatch(normalizedQuery, normalizedTitle)) {
    return EntityTitleMatchTier.TypoTolerant;
  }

  return EntityTitleMatchTier.TrigramFallback;
}

function isWithinBoundedTypoTolerance(queryToken: string, titleToken: string) {
  if (queryToken.length < 3 || titleToken.length < 3) {
    return false;
  }

  const maxDistance =
    Math.max(queryToken.length, titleToken.length) >= 7 ? 2 : 1;

  return damerauLevenshteinDistance(queryToken, titleToken) <= maxDistance;
}

function damerauLevenshteinDistance(left: string, right: string): number {
  const distances = Array.from({ length: left.length + 1 }, () =>
    Array(right.length + 1).fill(0),
  );

  for (let i = 0; i <= left.length; i += 1) {
    distances[i]![0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    distances[0]![j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;

      distances[i]![j] = Math.min(
        distances[i - 1]![j]! + 1,
        distances[i]![j - 1]! + 1,
        distances[i - 1]![j - 1]! + substitutionCost,
      );

      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        distances[i]![j] = Math.min(
          distances[i]![j]!,
          distances[i - 2]![j - 2]! + substitutionCost,
        );
      }
    }
  }

  return distances[left.length]![right.length]!;
}

@Injectable()
export class EntityRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  private getClient(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    if (tx) {
      return tx;
    }

    return this.prisma.db as unknown as Prisma.TransactionClient;
  }

  private normalizeNameForSearch(name: string): string {
    return normalizeEntityNameForSearch(name);
  }

  async searchEntities(
    organizationId: OrganizationId,
    query: string,
    limit = 10,
    offset = 0,
    entityTypes: EntityType[] = NON_ARTIFACT_ENTITY_TYPES,
  ): Promise<EntitySearchResultWithStatus[]> {
    const searchText = this.normalizeNameForSearch(query);
    const allowedEntityTypes =
      entityTypes?.length > 0 ? entityTypes : NON_ARTIFACT_ENTITY_TYPES;

    // Tune fallback thresholds by query length to reduce noise on short inputs.
    const similarityThreshold =
      searchText.length >= 6 ? 0.2 : searchText.length >= 4 ? 0.15 : 0.1;
    const wordSimilarityThreshold =
      searchText.length >= 6 ? 0.12 : searchText.length >= 4 ? 0.1 : 0.1;

    // Ensure limit is within a reasonable range to prevent abuse
    const safeLimit = Math.min(limit, 100);

    const entityTypeArray = Prisma.sql`ARRAY[${Prisma.join(
      allowedEntityTypes.map((type) => Prisma.sql`${type}::"EntityType"`),
    )}]`;

    const searchQuery = Prisma.sql`
      WITH query_input AS (
        SELECT
          ${searchText}::text AS query_text,
          string_to_array(${searchText}::text, ' ') AS query_tokens
      ),
      base AS (
        SELECT
          entity_registry.entity_id as "entityId",
          entity_registry.entity_type as "entityType",
          entity_registry.entity_name as "entityName",
          CASE
            WHEN entity_registry.entity_type = 'INITIATIVE'::"EntityType" THEN initiatives.status::text
            WHEN entity_registry.entity_type = 'TASK'::"EntityType" THEN tasks.status::text
            WHEN entity_registry.entity_type = 'PROJECT'::"EntityType" THEN projects.status::text
            WHEN entity_registry.entity_type = 'CONVERSATION'::"EntityType" THEN conversations.status::text
            WHEN entity_registry.entity_type = 'MESSAGE'::"EntityType" AND message_conversations.id IS NOT NULL THEN messages.status::text
            WHEN entity_registry.entity_type = 'DESIGN_DOC'::"EntityType" THEN design_docs.status::text
            WHEN entity_registry.entity_type = 'SERVICE'::"EntityType" THEN services.status::text
            WHEN entity_registry.entity_type = 'ARTIFACT'::"EntityType" THEN artifacts.status::text
            ELSE NULL
          END as status,
          trim(
            regexp_replace(
              regexp_replace(
                lower(coalesce(entity_registry.entity_name, entity_registry.name_search_text, '')),
                '[^[:alnum:]]+',
                ' ',
                'g'
              ),
              '\\s+',
              ' ',
              'g'
            )
          ) AS normalized_title,
          query_input.query_text,
          query_input.query_tokens
        FROM entity_registry
        CROSS JOIN query_input
        LEFT JOIN initiatives
          ON initiatives.id = entity_registry.entity_id
          AND entity_registry.entity_type = 'INITIATIVE'::"EntityType"
          AND initiatives.organization_id = entity_registry.organization_id
        LEFT JOIN tasks
          ON tasks.id = entity_registry.entity_id
          AND entity_registry.entity_type = 'TASK'::"EntityType"
          AND tasks.organization_id = entity_registry.organization_id
        LEFT JOIN projects
          ON projects.id = entity_registry.entity_id
          AND entity_registry.entity_type = 'PROJECT'::"EntityType"
          AND projects.organization_id = entity_registry.organization_id
        LEFT JOIN conversations
          ON conversations.id = entity_registry.entity_id
          AND entity_registry.entity_type = 'CONVERSATION'::"EntityType"
          AND conversations.organization_id = entity_registry.organization_id
        LEFT JOIN messages
          ON messages.id = entity_registry.entity_id
          AND entity_registry.entity_type = 'MESSAGE'::"EntityType"
        LEFT JOIN conversations AS message_conversations
          ON message_conversations.id = messages.conversation_id
          AND message_conversations.organization_id = entity_registry.organization_id
        LEFT JOIN design_docs
          ON design_docs.id = entity_registry.entity_id
          AND entity_registry.entity_type = 'DESIGN_DOC'::"EntityType"
          AND design_docs.organization_id = entity_registry.organization_id
        LEFT JOIN services
          ON services.id = entity_registry.entity_id
          AND entity_registry.entity_type = 'SERVICE'::"EntityType"
          AND services.organization_id = entity_registry.organization_id
        LEFT JOIN artifacts
          ON artifacts.id = entity_registry.entity_id
          AND entity_registry.entity_type = 'ARTIFACT'::"EntityType"
          AND artifacts.organization_id = entity_registry.organization_id
        WHERE
          entity_registry.organization_id = ${organizationId}
          AND entity_registry.deleted_at IS NULL
          AND entity_registry.name_search_text IS NOT NULL
          AND entity_registry.entity_type = ANY(${entityTypeArray})
      ),
      eligible AS (
        SELECT base.*
        FROM base
        WHERE base.status IS DISTINCT FROM 'ARCHIVED'
      ),
      tokenized AS (
        SELECT
          eligible.*,
          string_to_array(eligible.normalized_title, ' ') AS title_tokens,
          similarity(eligible.normalized_title, eligible.query_text) as trigram_similarity,
          word_similarity(eligible.query_text, eligible.normalized_title) as word_similarity
        FROM eligible
      ),
      ranked AS (
        SELECT
          tokenized.*,
          CASE
            WHEN tokenized.normalized_title = tokenized.query_text THEN ${EntityTitleMatchTier.ExactTitle}
            WHEN starts_with(tokenized.normalized_title, tokenized.query_text) THEN ${EntityTitleMatchTier.ExactPrefix}
            WHEN array_length(tokenized.query_tokens, 1) <= array_length(tokenized.title_tokens, 1)
              AND NOT EXISTS (
                SELECT 1
                FROM unnest(tokenized.query_tokens) WITH ORDINALITY AS query_token(token, token_index)
                WHERE query_token.token = ''
                  OR NOT EXISTS (
                    SELECT 1
                    FROM unnest(tokenized.title_tokens) WITH ORDINALITY AS title_token(token, token_index)
                    WHERE title_token.token_index = query_token.token_index
                      AND starts_with(title_token.token, query_token.token)
                  )
              )
              THEN ${EntityTitleMatchTier.OrderedTokenPrefix}
            WHEN NOT EXISTS (
              SELECT 1
              FROM unnest(tokenized.query_tokens) AS query_token(token)
              WHERE query_token.token = ''
                OR NOT EXISTS (
                  SELECT 1
                  FROM unnest(tokenized.title_tokens) AS title_token(token)
                  WHERE starts_with(title_token.token, query_token.token)
                )
            )
              THEN ${EntityTitleMatchTier.TokenSubset}
            WHEN NOT EXISTS (
              SELECT 1
              FROM unnest(tokenized.query_tokens) AS query_token(token)
              WHERE query_token.token = ''
                OR NOT EXISTS (
                  SELECT 1
                  FROM unnest(tokenized.title_tokens) AS title_token(token)
                  WHERE starts_with(title_token.token, query_token.token)
                    OR (
                      length(query_token.token) >= 3
                      AND length(title_token.token) >= 3
                      AND similarity(title_token.token, query_token.token) >= ${TYPO_TOLERANCE_TOKEN_SIMILARITY_THRESHOLD}
                    )
                )
            )
              THEN ${EntityTitleMatchTier.TypoTolerant}
            WHEN tokenized.word_similarity >= ${wordSimilarityThreshold}
              OR tokenized.trigram_similarity >= ${similarityThreshold}
              THEN ${EntityTitleMatchTier.TrigramFallback}
            ELSE ${EntityTitleMatchTier.NoMatch}
          END AS match_tier
        FROM tokenized
      )
      SELECT
        ranked."entityId",
        ranked."entityType",
        ranked."entityName",
        ranked.status,
        GREATEST(ranked.word_similarity, ranked.trigram_similarity) as similarity
      FROM ranked
      WHERE
        ranked.match_tier < ${EntityTitleMatchTier.NoMatch}
        AND (
          length(ranked.query_text) > 2
          OR ranked.match_tier <= ${EntityTitleMatchTier.ExactPrefix}
        )
      ORDER BY
        ranked.match_tier ASC,
        GREATEST(ranked.word_similarity, ranked.trigram_similarity) DESC,
        ranked.trigram_similarity DESC,
        ranked."entityName" ASC
      LIMIT ${safeLimit}
      OFFSET ${offset};
    `;

    const results =
      await this.prisma.db.$queryRaw<EntitySearchResultWithStatus[]>(
        searchQuery,
      );

    return results;
  }

  async registerEntity(
    params: {
      organizationId: OrganizationId;
      entityId: string;
      entityType: EntityType;
      name: string;
      deletedAt?: Date;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = this.getClient(tx);
    const searchText = this.normalizeNameForSearch(params.name);

    await client.entityRegistry.upsert({
      where: {
        organizationId_entityId_entityType: {
          organizationId: params.organizationId,
          entityId: params.entityId,
          entityType: params.entityType,
        },
      },
      create: {
        organizationId: params.organizationId,
        entityId: params.entityId,
        entityType: params.entityType,
        entityName: params.name,
        nameSearchText: searchText,
        deletedAt: params.deletedAt || null,
      },
      update: {
        entityName: params.name,
        nameSearchText: searchText,
        deletedAt: params.deletedAt || null,
      },
    });
  }

  async recordEntityDeletion(
    params: {
      organizationId: OrganizationId;
      entityId: string;
      entityType: EntityType;
      deletedAt?: Date;
      name?: string;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const { organizationId, entityId, entityType, deletedAt, name } = params;
    const client = this.getClient(tx);
    const effectiveDeletedAt = deletedAt ?? new Date();

    if (name) {
      const searchText = this.normalizeNameForSearch(name);

      await client.entityRegistry.upsert({
        where: {
          organizationId_entityId_entityType: {
            organizationId,
            entityId,
            entityType,
          },
        },
        create: {
          organizationId,
          entityId,
          entityType,
          entityName: name,
          nameSearchText: searchText,
          deletedAt: effectiveDeletedAt,
        },
        update: {
          entityName: name,
          nameSearchText: searchText,
          deletedAt: effectiveDeletedAt,
        },
      });
    } else {
      await client.entityRegistry.updateMany({
        where: {
          organizationId,
          entityId,
          entityType,
        },
        data: {
          deletedAt: effectiveDeletedAt,
        },
      });
    }

    await client.attentionEvent.deleteMany({
      where: {
        organizationId,
        entityId,
        entityType,
      },
    });
  }

  async registerEntities(
    params: Array<{
      organizationId: OrganizationId;
      entityId: string;
      entityType: EntityType;
      name: string;
    }>,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (params.length === 0) {
      return;
    }

    const client = this.getClient(tx);
    const uniquePairs = new Map<
      string,
      {
        organizationId: OrganizationId;
        entityId: string;
        entityType: EntityType;
        name: string;
      }
    >();

    params.forEach((param) => {
      const key = `${param.organizationId}:${param.entityId}:${param.entityType}`;
      uniquePairs.set(key, param);
    });

    const records = Array.from(uniquePairs.values());

    // Use upsert instead of createMany to ensure names are updated for existing rows
    // This prevents stale names in bulk operations and backfill scenarios
    for (const record of records) {
      const searchText = this.normalizeNameForSearch(record.name);

      await client.entityRegistry.upsert({
        where: {
          organizationId_entityId_entityType: {
            organizationId: record.organizationId,
            entityId: record.entityId,
            entityType: record.entityType,
          },
        },
        create: {
          organizationId: record.organizationId,
          entityId: record.entityId,
          entityType: record.entityType,
          entityName: record.name,
          nameSearchText: searchText,
        },
        update: {
          entityName: record.name,
          nameSearchText: searchText,
          deletedAt: null,
        },
      });
    }
  }

  async markEntityDeleted(
    params: {
      organizationId: OrganizationId;
      entityId: string;
      entityType: EntityType;
      deletedAt?: Date;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = this.getClient(tx);
    await client.entityRegistry.updateMany({
      where: {
        organizationId: params.organizationId,
        entityId: params.entityId,
        entityType: params.entityType,
      },
      data: {
        deletedAt: params.deletedAt ?? new Date(),
      },
    });
  }

  async lookupEntityTypes(
    entityIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<Record<string, EntityType>> {
    const uniqueIds = Array.from(new Set(entityIds));

    if (uniqueIds.length === 0) {
      return {};
    }

    const client = this.getClient(tx);
    const records = await client.entityRegistry.findMany({
      where: {
        entityId: { in: uniqueIds },
        deletedAt: null,
      },
    });

    const typeMap: Record<string, EntityType> = {};
    const ambiguousIds: string[] = [];

    for (const record of records) {
      const existing = typeMap[record.entityId];
      if (existing && existing !== record.entityType) {
        ambiguousIds.push(record.entityId);
        continue;
      }
      typeMap[record.entityId] = record.entityType;
    }

    const missingIds = uniqueIds.filter((id) => !typeMap[id]);

    if (ambiguousIds.length || missingIds.length) {
      throw new EntityRegistryLookupError('Entity registry lookup failed', {
        ambiguousIds: ambiguousIds.length ? ambiguousIds : undefined,
        missingIds: missingIds.length ? missingIds : undefined,
      });
    }

    return typeMap;
  }

  async getEntitiesByIds(params: {
    organizationId: OrganizationId;
    entities: Array<{ entityId: string; entityType?: EntityType }>;
    tx?: Prisma.TransactionClient;
  }): Promise<
    Array<{ entityId: string; entityType: EntityType; entityName?: string }>
  > {
    const uniqueIds = Array.from(
      new Set(params.entities.map((entity) => entity.entityId)),
    );

    if (uniqueIds.length === 0) {
      return [];
    }

    const client = this.getClient(params.tx);
    const entityTypes = params.entities
      .map((entity) => entity.entityType)
      .filter((entityType): entityType is EntityType => Boolean(entityType));
    const whereClause: Prisma.EntityRegistryWhereInput = {
      organizationId: params.organizationId,
      entityId: { in: uniqueIds },
      deletedAt: null,
    };

    if (entityTypes.length > 0) {
      whereClause.entityType = { in: Array.from(new Set(entityTypes)) };
    }

    const records = await client.entityRegistry.findMany({
      where: whereClause,
    });

    return records.map((record: EntityRegistry) => ({
      entityId: record.entityId,
      entityType: record.entityType,
      entityName: record.entityName ?? undefined,
    }));
  }
}

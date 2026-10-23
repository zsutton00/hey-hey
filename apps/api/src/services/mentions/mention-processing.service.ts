import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EntityType, Prisma } from '@prisma/client';
import { OrganizationId } from 'src/types';
import { AnyTransactionClient } from 'src/prisma/prisma.service';
import { extractMentions } from 'src/utils/mentionFormatting';
import {
  EntityRegistryLookupError,
  EntityRegistryService,
} from 'src/services/entity-registry/entity-registry.service';
import { normalizeMentionTypeAlias } from 'src/services/mentions/mention-type-aliases';

export interface MentionToken {
  entityId: string;
  entityType: string;
}

export interface ResolvedMention {
  entityId: string;
  entityType: EntityType;
}

/**
 * Shared mention extraction + validation. Owned by both the message path and
 * the proposal-enactment path so neither forks its own copy of the registry
 * lookup logic.
 */
@Injectable()
export class MentionProcessingService {
  private readonly logger = new Logger(MentionProcessingService.name);

  constructor(private readonly entityRegistryService: EntityRegistryService) {}

  extractMentionTokens(content: string | null | undefined): MentionToken[] {
    if (!content) {
      return [];
    }
    return extractMentions(content).map((mention) => ({
      entityId: mention.entityId,
      entityType: mention.entityType,
    }));
  }

  /**
   * Map a raw mention-token type string to a canonical EntityType. Public so
   * the alias normalizer (sibling task: feature/goal/bug → TASK) can wrap it
   * without forking the switch.
   */
  mapMentionEntityType(rawType: string): EntityType | null {
    const normalized = normalizeMentionTypeAlias(rawType);
    switch (normalized) {
      case 'artifact':
        return EntityType.ARTIFACT;
      case 'initiative':
        return EntityType.INITIATIVE;
      case 'project':
        return EntityType.PROJECT;
      case 'task':
        return EntityType.TASK;
      case 'message':
        return EntityType.MESSAGE;
      case 'conversation':
        return EntityType.CONVERSATION;
      case 'design-doc':
        return EntityType.DESIGN_DOC;
      case 'agent-session':
        return EntityType.AGENT_SESSION;
      default:
        return null;
    }
  }

  /**
   * Validate raw mention tokens against the entity registry. Skips
   * unresolvable ids (warns), skips type mismatches (warns), and throws
   * BadRequest on ambiguous ids — same semantics MessageService used before
   * this was lifted out.
   */
  async validateMentions(
    mentionTokens: MentionToken[],
    organizationId: OrganizationId,
    tx: AnyTransactionClient,
  ): Promise<ResolvedMention[]> {
    if (mentionTokens.length === 0) {
      return [];
    }

    this.logger.log('Validating mentions', {
      organizationId,
      tokenCount: mentionTokens.length,
    });

    const normalizedTokens = mentionTokens;
    const uniqueEntityIds = Array.from(
      new Set(normalizedTokens.map((m) => m.entityId)),
    );

    let registryTypes: Record<string, EntityType>;
    try {
      registryTypes = await this.entityRegistryService.lookupEntityTypes(
        uniqueEntityIds,
        tx as Prisma.TransactionClient,
      );
    } catch (err) {
      if (err instanceof EntityRegistryLookupError) {
        if (err.details.ambiguousIds?.length) {
          throw new BadRequestException(
            `Invalid mentions for organization ${organizationId}: ambiguous: ${err.details.ambiguousIds.join(', ')}`,
          );
        }
        this.logger.warn('Skipping unresolvable mentions', {
          missingIds: err.details.missingIds,
          organizationId,
        });
        const missingSet = new Set(err.details.missingIds ?? []);
        const filteredIds = uniqueEntityIds.filter((id) => !missingSet.has(id));
        if (filteredIds.length === 0) {
          return [];
        }
        registryTypes = await this.entityRegistryService.lookupEntityTypes(
          filteredIds,
          tx as Prisma.TransactionClient,
        );
      } else {
        throw err;
      }
    }

    const deduped = new Map<string, ResolvedMention>();

    for (const token of normalizedTokens) {
      const expectedType = this.mapMentionEntityType(token.entityType);
      if (!expectedType) {
        this.logger.warn('Skipping unsupported mention type', {
          rawType: token.entityType,
          entityId: token.entityId,
        });
        continue;
      }

      const actualType = registryTypes[token.entityId];
      if (!actualType) {
        continue;
      }

      if (actualType !== expectedType) {
        this.logger.warn('Mention type mismatch', {
          entityId: token.entityId,
          expectedType,
          actualType,
        });
        continue;
      }

      const existing = deduped.get(token.entityId);
      if (existing && existing.entityType !== expectedType) {
        this.logger.warn('Conflicting mention types for entity', {
          entityId: token.entityId,
        });
        continue;
      }

      deduped.set(token.entityId, {
        entityId: token.entityId,
        entityType: expectedType,
      });
    }

    return Array.from(deduped.values());
  }

  /**
   * Convenience: extract + validate in one call, given raw content. Used by
   * the proposal-enactment path which works directly with section markdown.
   */
  async extractAndValidate(
    content: string | null | undefined,
    organizationId: OrganizationId,
    tx: AnyTransactionClient,
  ): Promise<ResolvedMention[]> {
    const tokens = this.extractMentionTokens(content);
    if (tokens.length === 0) {
      return [];
    }
    return this.validateMentions(tokens, organizationId, tx);
  }
}

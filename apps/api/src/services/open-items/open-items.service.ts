import { WebsocketGateway } from '../../core/websockets/websocket.gateway';
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  ActivateOpenItemRequest,
  AssignOpenItemsToGroupRequest,
  CreateOpenItemGroupRequest,
  DeleteOpenItemGroupRequest,
  MigrateOpenItemsRequest,
  MoveOpenItemGroupMemberRequest,
  MoveOpenItemGroupRequest,
  MoveOpenItemRequest,
  OpenItemRef,
  OpenItemsCollection,
  OpenItemsMutationResult,
  OpenItemsPresentCollection,
  RemoveOpenItemRequest,
  RemoveOpenItemsRequest,
  RenameOpenItemGroupRequest,
  ResetOpenItemsRequest,
  SetOpenItemGroupDisclosureRequest,
  SetOpenItemNoteRequest,
  SetOpenItemPinRequest,
  SetOpenItemGoalFilterRequest,
  SetOpenItemGoalDisclosureRequest,
  UngroupOpenItemsRequest,
} from 'src/generated';
import { v4 as uuidv4 } from 'uuid';
import * as domain from './open-items.domain';
import type {
  OpenItemsMutationEnvironment,
  OpenItemsOutcome,
  OpenItemsState,
} from './open-items.domain';
import { OpenItemsConflictException } from './open-items.errors';
import {
  LockedOpenItemsCollection,
  OpenItemsRepository,
  OpenItemsScope,
} from './open-items.repository';

type OpenItemsOperation =
  | 'activateOpenItem'
  | 'setOpenItemNote'
  | 'setOpenItemPin'
  | 'setOpenItemGoalFilter'
  | 'setOpenItemGoalDisclosure'
  | 'moveOpenItem'
  | 'removeOpenItem'
  | 'removeOpenItems'
  | 'createOpenItemGroup'
  | 'renameOpenItemGroup'
  | 'deleteOpenItemGroup'
  | 'setOpenItemGroupDisclosure'
  | 'moveOpenItemGroup'
  | 'assignOpenItemsToGroup'
  | 'ungroupOpenItems'
  | 'moveOpenItemGroupMember'
  | 'migrateOpenItems'
  | 'resetOpenItems';

interface MutationSpec {
  operation: OpenItemsOperation;
  idempotencyKey: string;
  /** Path identities plus body; together they define request identity. */
  request: unknown;
  /** Activation, migration, and reset may create the collection. */
  createIfAbsent: boolean;
  apply: (
    state: OpenItemsState,
    env: OpenItemsMutationEnvironment,
    collection: LockedOpenItemsCollection,
  ) => OpenItemsOutcome;
}

/**
 * Key-order-independent serialization of a JSON request, hashed to identify
 * whether a reused idempotency key carries the same request. Array order is
 * preserved because it is meaningful in these requests.
 */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const openItemsFingerprint = (operation: string, request: unknown) =>
  createHash('sha256')
    .update(`${operation}\n${canonicalJson(request)}`)
    .digest('hex');

@Injectable()
export class OpenItemsService {
  private readonly logger = new Logger(OpenItemsService.name);

  constructor(
    private readonly repository: OpenItemsRepository,
    private readonly gateway: WebsocketGateway,
  ) {}

  async getOpenItems(scope: OpenItemsScope): Promise<OpenItemsCollection> {
    const state = await this.repository.readState(scope);
    if (!state) {
      this.logger.debug(`getOpenItems: ABSENT for ${this.describe(scope)}`);
      return { state: 'ABSENT' };
    }
    this.logger.debug(
      `getOpenItems: PRESENT revision ${state.revision} with ${state.items.length} item(s), ${state.groups.length} group(s) for ${this.describe(scope)}`,
    );
    return domain.toPresentCollection(state);
  }

  activateOpenItem(scope: OpenItemsScope, request: ActivateOpenItemRequest) {
    return this.mutate(scope, {
      operation: 'activateOpenItem',
      idempotencyKey: request.idempotencyKey,
      request,
      createIfAbsent: true,
      apply: (state, env) => domain.activateOpenItem(state, env, request),
    });
  }

  setOpenItemNote(
    scope: OpenItemsScope,
    ref: OpenItemRef,
    request: SetOpenItemNoteRequest,
  ) {
    return this.mutate(scope, {
      operation: 'setOpenItemNote',
      idempotencyKey: request.idempotencyKey,
      request: { ref, request },
      createIfAbsent: false,
      apply: (state, env) => domain.setOpenItemNote(state, env, ref, request),
    });
  }

  setOpenItemPin(
    scope: OpenItemsScope,
    ref: OpenItemRef,
    request: SetOpenItemPinRequest,
  ) {
    return this.mutate(scope, {
      operation: 'setOpenItemPin',
      idempotencyKey: request.idempotencyKey,
      request: { ref, request },
      createIfAbsent: false,
      apply: (state, env) => domain.setOpenItemPin(state, env, ref, request),
    });
  }

  setOpenItemGoalFilter(
    scope: OpenItemsScope,
    ref: OpenItemRef,
    request: SetOpenItemGoalFilterRequest,
  ) {
    return this.mutate(scope, {
      operation: 'setOpenItemGoalFilter',
      idempotencyKey: request.idempotencyKey,
      request: { ref, request },
      createIfAbsent: false,
      apply: (state, env) =>
        domain.setOpenItemGoalFilter(state, env, ref, request),
    });
  }

  setOpenItemGoalDisclosure(
    scope: OpenItemsScope,
    ref: OpenItemRef,
    request: SetOpenItemGoalDisclosureRequest,
  ) {
    return this.mutate(scope, {
      operation: 'setOpenItemGoalDisclosure',
      idempotencyKey: request.idempotencyKey,
      request: { ref, request },
      createIfAbsent: false,
      apply: (state, env) =>
        domain.setOpenItemGoalDisclosure(state, env, ref, request),
    });
  }

  moveOpenItem(
    scope: OpenItemsScope,
    ref: OpenItemRef,
    request: MoveOpenItemRequest,
  ) {
    return this.mutate(scope, {
      operation: 'moveOpenItem',
      idempotencyKey: request.idempotencyKey,
      request: { ref, request },
      createIfAbsent: false,
      apply: (state, env) => domain.moveOpenItem(state, env, ref, request),
    });
  }

  removeOpenItem(
    scope: OpenItemsScope,
    ref: OpenItemRef,
    request: RemoveOpenItemRequest,
  ) {
    return this.mutate(scope, {
      operation: 'removeOpenItem',
      idempotencyKey: request.idempotencyKey,
      request: { ref, request },
      createIfAbsent: false,
      apply: (state, env) => domain.removeOpenItem(state, env, ref, request),
    });
  }

  removeOpenItems(scope: OpenItemsScope, request: RemoveOpenItemsRequest) {
    return this.mutate(scope, {
      operation: 'removeOpenItems',
      idempotencyKey: request.idempotencyKey,
      request,
      createIfAbsent: false,
      apply: (state, env) => domain.removeOpenItems(state, env, request),
    });
  }

  createOpenItemGroup(
    scope: OpenItemsScope,
    request: CreateOpenItemGroupRequest,
  ) {
    return this.mutate(scope, {
      operation: 'createOpenItemGroup',
      idempotencyKey: request.idempotencyKey,
      request,
      createIfAbsent: false,
      apply: (state, env) => domain.createOpenItemGroup(state, env, request),
    });
  }

  renameOpenItemGroup(
    scope: OpenItemsScope,
    groupId: string,
    request: RenameOpenItemGroupRequest,
  ) {
    return this.mutate(scope, {
      operation: 'renameOpenItemGroup',
      idempotencyKey: request.idempotencyKey,
      request: { groupId, request },
      createIfAbsent: false,
      apply: (state, env) =>
        domain.renameOpenItemGroup(state, env, groupId, request),
    });
  }

  deleteOpenItemGroup(
    scope: OpenItemsScope,
    groupId: string,
    request: DeleteOpenItemGroupRequest,
  ) {
    return this.mutate(scope, {
      operation: 'deleteOpenItemGroup',
      idempotencyKey: request.idempotencyKey,
      request: { groupId, request },
      createIfAbsent: false,
      apply: (state, env) =>
        domain.deleteOpenItemGroup(state, env, groupId, request),
    });
  }

  setOpenItemGroupDisclosure(
    scope: OpenItemsScope,
    groupId: string,
    request: SetOpenItemGroupDisclosureRequest,
  ) {
    return this.mutate(scope, {
      operation: 'setOpenItemGroupDisclosure',
      idempotencyKey: request.idempotencyKey,
      request: { groupId, request },
      createIfAbsent: false,
      apply: (state, env) =>
        domain.setOpenItemGroupDisclosure(state, env, groupId, request),
    });
  }

  moveOpenItemGroup(
    scope: OpenItemsScope,
    groupId: string,
    request: MoveOpenItemGroupRequest,
  ) {
    return this.mutate(scope, {
      operation: 'moveOpenItemGroup',
      idempotencyKey: request.idempotencyKey,
      request: { groupId, request },
      createIfAbsent: false,
      apply: (state, env) =>
        domain.moveOpenItemGroup(state, env, groupId, request),
    });
  }

  assignOpenItemsToGroup(
    scope: OpenItemsScope,
    groupId: string,
    request: AssignOpenItemsToGroupRequest,
  ) {
    return this.mutate(scope, {
      operation: 'assignOpenItemsToGroup',
      idempotencyKey: request.idempotencyKey,
      request: { groupId, request },
      createIfAbsent: false,
      apply: (state, env) =>
        domain.assignOpenItemsToGroup(state, env, groupId, request),
    });
  }

  ungroupOpenItems(scope: OpenItemsScope, request: UngroupOpenItemsRequest) {
    return this.mutate(scope, {
      operation: 'ungroupOpenItems',
      idempotencyKey: request.idempotencyKey,
      request,
      createIfAbsent: false,
      apply: (state, env) => domain.ungroupOpenItems(state, env, request),
    });
  }

  moveOpenItemGroupMember(
    scope: OpenItemsScope,
    groupId: string,
    ref: OpenItemRef,
    request: MoveOpenItemGroupMemberRequest,
  ) {
    return this.mutate(scope, {
      operation: 'moveOpenItemGroupMember',
      idempotencyKey: request.idempotencyKey,
      request: { groupId, ref, request },
      createIfAbsent: false,
      apply: (state, env) =>
        domain.moveOpenItemGroupMember(state, env, groupId, ref, request),
    });
  }

  migrateOpenItems(
    scope: OpenItemsScope,
    request: MigrateOpenItemsRequest,
  ): Promise<OpenItemsPresentCollection> {
    return this.mutate(scope, {
      operation: 'migrateOpenItems',
      idempotencyKey: request.idempotencyKey,
      request,
      createIfAbsent: true,
      apply: (state, env, collection) => {
        if (!collection.created) {
          this.logger.debug(
            `migrateOpenItems: collection ${collection.id} already exists at revision ${collection.revision}; existing collection wins`,
          );
          throw OpenItemsConflictException.of(
            'COLLECTION_ALREADY_EXISTS',
            'An Open Items collection already exists; migration only applies to an absent collection.',
            collection.revision,
          );
        }
        return domain.migrateOpenItems(state, env, request);
      },
    });
  }

  resetOpenItems(
    scope: OpenItemsScope,
    request: ResetOpenItemsRequest,
  ): Promise<OpenItemsPresentCollection> {
    return this.mutate(scope, {
      operation: 'resetOpenItems',
      idempotencyKey: request.idempotencyKey,
      request,
      createIfAbsent: true,
      apply: (state, env, collection) =>
        domain.resetOpenItems(state, env, request, collection.created),
    });
  }

  /**
   * Runs one mutation in one transaction: lock (or create) the collection,
   * replay a recorded idempotency result, apply the pure domain operation,
   * persist its changes, advance the collection revision, clean up expired
   * rows, and record the canonical result under the idempotency key.
   */
  private mutate(
    scope: OpenItemsScope,
    spec: MutationSpec & { operation: 'migrateOpenItems' | 'resetOpenItems' },
  ): Promise<OpenItemsPresentCollection>;
  private mutate(
    scope: OpenItemsScope,
    spec: MutationSpec,
  ): Promise<OpenItemsMutationResult>;
  private async mutate(
    scope: OpenItemsScope,
    spec: MutationSpec,
  ): Promise<OpenItemsMutationResult | OpenItemsPresentCollection> {
    const { operation, idempotencyKey } = spec;
    const requestFingerprint = openItemsFingerprint(operation, spec.request);
    this.logger.debug(
      `${operation}: start for ${this.describe(scope)} key=${idempotencyKey}`,
    );
    const log = (message: string) =>
      this.logger.debug(`${operation} [${idempotencyKey}]: ${message}`);

    let committedRevision: number | null = null;
    try {
      const result = await this.repository.transaction(async (tx) => {
        const collection = await this.repository.lockCollection(
          tx,
          scope,
          spec.createIfAbsent,
        );
        if (!collection) {
          log('rejected: collection is absent');
          throw OpenItemsConflictException.of(
            'COLLECTION_ABSENT',
            'No Open Items collection exists; read the collection before mutating it.',
            null,
          );
        }

        if (!collection.created) {
          const recorded = await this.repository.findIdempotencyRecord(
            tx,
            collection.id,
            idempotencyKey,
          );
          if (recorded) {
            if (
              recorded.operation !== operation ||
              recorded.requestFingerprint !== requestFingerprint
            ) {
              log(
                `rejected: key was recorded for a different ${recorded.operation === operation ? 'request' : `operation (${recorded.operation})`}`,
              );
              throw OpenItemsConflictException.of(
                'IDEMPOTENCY_KEY_REUSED',
                'This idempotency key was already used for a different request.',
                collection.revision,
              );
            }
            log('replaying recorded result without reapplying');
            return this.replay(operation, recorded.result);
          }
        }

        const state = await this.repository.loadState(tx, collection, {
          includeRemoved: true,
        });
        const now = new Date();
        const env: OpenItemsMutationEnvironment = {
          nextRevision: collection.revision + 1,
          now,
          newId: uuidv4,
          log,
        };
        const outcome = spec.apply(state, env, collection);

        if (outcome.kind === 'unchanged') {
          // Record no-op results without advancing the freshness token.
          await this.repository.recordIdempotencyResult(
            tx,
            collection.id,
            idempotencyKey,
            { operation, requestFingerprint, result: outcome.result },
            now,
          );
          log(`no change; collection revision stays ${collection.revision}`);
          return outcome.result;
        }

        await this.repository.applyChanges(tx, collection.id, outcome.changes);
        await this.repository.advanceRevision(
          tx,
          collection.id,
          env.nextRevision,
          now,
        );
        await this.repository.cleanup(tx, collection.id, now);
        await this.repository.recordIdempotencyResult(
          tx,
          collection.id,
          idempotencyKey,
          { operation, requestFingerprint, result: outcome.result },
          now,
        );
        log(
          `committed collection revision ${env.nextRevision} (was ${collection.revision})`,
        );
        committedRevision = env.nextRevision;
        return outcome.result;
      });
      if (committedRevision !== null)
        this.gateway.publishOpenItemsChanged(
          scope.userId,
          scope.projectId,
          committedRevision,
        );
      return result;
    } catch (error) {
      if (
        error instanceof OpenItemsConflictException &&
        error.body.currentCollectionRevision === 0
      ) {
        // Revision 0 means absent: every committed mutation increments the
        // revision, so only this rolled-back transaction's new row is at 0.
        log(`rolled back ${error.body.code}; collection remains absent`);
        throw new OpenItemsConflictException({
          ...error.body,
          currentCollectionRevision: null,
        });
      }
      if (error instanceof Error) {
        log(
          `${committedRevision === null ? 'rolled back' : 'post-commit publication failed'}: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Item and group operations report replays through `replayed`. Migration
   * and reset return the recorded collection unchanged: their result schema
   * has no replay flag, and the recorded snapshot is the canonical outcome of
   * that request.
   */
  private replay(
    operation: OpenItemsOperation,
    recorded: unknown,
  ): OpenItemsMutationResult | OpenItemsPresentCollection {
    if (operation === 'migrateOpenItems' || operation === 'resetOpenItems') {
      return recorded as OpenItemsPresentCollection;
    }
    return { ...(recorded as OpenItemsMutationResult), replayed: true };
  }

  private describe(scope: OpenItemsScope) {
    return `user ${scope.userId} project ${scope.projectId} org ${scope.organizationId}`;
  }
}

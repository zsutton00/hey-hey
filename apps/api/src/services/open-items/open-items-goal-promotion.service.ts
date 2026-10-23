import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import type {
  CreateTaskDto,
  OpenItemRef,
  PromoteGroupToGoalRequest,
  PromoteGroupToGoalResult,
} from '../../generated';
import type { TaskId } from '../../types';
import { TaskService } from '../tasks/task.service';
import { GoalTracksService } from '../tasks/goal-tracks.service';
import { WebsocketGateway } from '../../core/websockets/websocket.gateway';
import { OpenItemsRepository, OpenItemsScope } from './open-items.repository';
import { openItemsFingerprint } from './open-items.service';
import {
  OpenItemsConflictException,
  OpenItemsValidationException,
} from './open-items.errors';
import { publishGroupPromotion } from './open-items.domain';

const OPERATION = 'promoteGroupToGoal';

/** Stored only for retry identity, never a hidden entity publication state. */
type PromotionRecord =
  | {
      phase: 'TRACKING';
      goal: OpenItemRef;
      goalName: string;
      members: OpenItemRef[];
    }
  | { phase: 'COMPLETED'; result: PromoteGroupToGoalResult };

@Injectable()
export class OpenItemsGoalPromotionService {
  constructor(
    private readonly repository: OpenItemsRepository,
    private readonly tasks: TaskService,
    private readonly tracks: GoalTracksService,
    private readonly gateway: WebsocketGateway,
  ) {}

  async promoteGroupToGoal(
    scope: OpenItemsScope,
    request: PromoteGroupToGoalRequest,
    userToken: string | null,
  ): Promise<PromoteGroupToGoalResult> {
    const requestFingerprint = openItemsFingerprint(OPERATION, request);
    // Goal creation and its retry identity commit together. No collection
    // rows/revisions change here, and no graph HTTP runs in this transaction.
    const attempt = await this.repository.transaction(
      async (tx: Prisma.TransactionClient) => {
        const collection = await this.repository.lockCollection(
          tx,
          scope,
          false,
        );
        if (!collection) {
          throw OpenItemsConflictException.of(
            'COLLECTION_ABSENT',
            'No Open Items collection exists.',
            null,
          );
        }
        const recorded = await this.repository.findIdempotencyRecord(
          tx,
          collection.id,
          request.idempotencyKey,
        );
        if (recorded) {
          this.assertSameIntent(
            recorded,
            requestFingerprint,
            collection.revision,
          );
          return {
            collectionId: collection.id,
            record: recorded.result as PromotionRecord,
          };
        }
        const state = await this.repository.loadState(tx, collection, {
          includeRemoved: false,
        });
        if (!state.groups.some((group) => group.id === request.groupId)) {
          throw OpenItemsValidationException.of(
            'GROUP_NOT_FOUND',
            'The group no longer exists.',
            [{ path: '/groupId', message: 'must identify an existing group' }],
          );
        }
        const members = state.items
          .filter((item) => item.groupId === request.groupId)
          .map(({ entityType, entityId }) => ({ entityType, entityId }));
        const create = {
          name: request.goalName,
          type: 'GOAL',
          ...(request.targetDate === undefined
            ? {}
            : { dueDate: request.targetDate }),
        } satisfies CreateTaskDto;
        const goal = await this.tasks.createInTransaction(
          tx,
          scope.organizationId,
          null,
          create,
          scope.projectId,
        );
        const record: PromotionRecord = {
          phase: 'TRACKING',
          goal: { entityType: 'TASK', entityId: goal.id },
          goalName: goal.name,
          members,
        };
        await this.repository.recordIdempotencyResult(
          tx,
          collection.id,
          request.idempotencyKey,
          {
            operation: OPERATION,
            requestFingerprint,
            result: record,
          },
          new Date(),
        );
        return { collectionId: collection.id, record };
      },
    );
    if (attempt.record.phase === 'COMPLETED') {
      return { ...attempt.record.result, replayed: true };
    }
    const { goal, goalName, members } = attempt.record;
    const eligible = await this.tracks.eligibleGoalMembers(
      scope.organizationId,
      scope.projectId,
      members,
    );
    for (const member of eligible) {
      // Existing attach behavior reuses a TRACKS edge on a same-intent retry.
      await this.tracks.attachToGoal(
        scope.organizationId,
        scope.projectId,
        goal.entityId as TaskId,
        {
          targetEntityId: member.entityId,
          targetEntityType: member.entityType,
        },
        null,
        userToken,
      );
    }
    let committedRevision: number | null = null;
    const result = await this.repository.transaction(
      async (tx: Prisma.TransactionClient) => {
        const collection = await this.repository.lockCollection(
          tx,
          scope,
          false,
        );
        if (!collection) {
          throw OpenItemsConflictException.of(
            'COLLECTION_ABSENT',
            'No Open Items collection exists.',
            null,
          );
        }
        const recorded = await this.repository.findIdempotencyRecord(
          tx,
          collection.id,
          request.idempotencyKey,
        );
        if (!recorded)
          throw new Error('Promotion idempotency record is missing.');
        this.assertSameIntent(
          recorded,
          requestFingerprint,
          collection.revision,
        );
        const current = recorded.result as PromotionRecord;
        if (current.phase === 'COMPLETED')
          return { ...current.result, replayed: true };
        const state = await this.repository.loadState(tx, collection, {
          includeRemoved: true,
        });
        const now = new Date();
        const nextRevision = collection.revision + 1;
        const outcome = publishGroupPromotion(
          state,
          {
            nextRevision,
            now,
            newId: uuidv4,
            log: () => {},
          },
          request.groupId,
          goal,
          goalName,
          eligible,
        );
        const tracked = new Set(eligible.map((member) => member.entityId));
        const result = {
          collection: outcome.result,
          goal,
          untrackedMembers: state.items
            .filter(
              (item) =>
                item.removedAt === null &&
                item.groupId === request.groupId &&
                !tracked.has(item.entityId),
            )
            .map(({ entityType, entityId }) => ({ entityType, entityId })),
          replayed: false,
        } satisfies PromoteGroupToGoalResult;
        await this.repository.applyChanges(tx, collection.id, outcome.changes);
        await this.repository.advanceRevision(
          tx,
          collection.id,
          nextRevision,
          now,
        );
        await this.repository.replaceIdempotencyResult(
          tx,
          collection.id,
          request.idempotencyKey,
          {
            phase: 'COMPLETED',
            result,
          } satisfies PromotionRecord,
        );
        committedRevision = nextRevision;
        return result;
      },
    );
    if (committedRevision !== null) {
      this.gateway.publishOpenItemsChanged(
        scope.userId,
        scope.projectId,
        committedRevision,
      );
    }
    return result;
  }

  private assertSameIntent(
    record: { operation: string; requestFingerprint: string },
    fingerprint: string,
    revision: number,
  ) {
    if (
      record.operation !== OPERATION ||
      record.requestFingerprint !== fingerprint
    ) {
      throw OpenItemsConflictException.of(
        'IDEMPOTENCY_KEY_REUSED',
        'This idempotency key was already used for a different request.',
        revision,
      );
    }
  }
}

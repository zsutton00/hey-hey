import { ConflictException, Injectable, Logger } from '@nestjs/common';
import type {
  PrivateBetaAccessProgramCloseResultDto,
  PrivateBetaSelfServiceAdmissionMode,
  PrivateBetaSelfServiceAdmissionModeDto,
  PrivateBetaSelfServiceAdmissionModeUpdateResultDto,
} from '../generated';
import {
  type AnyTransactionClient,
  PrismaService,
} from '../prisma/prisma.service';
import type { UserId } from '../types';

const PRIVATE_BETA_PROGRAM_ID = 'private-beta';

type LockedProgramState = {
  closedAt: Date | null;
  closedByUserId: string | null;
  selfServiceAdmissionMode: PrivateBetaSelfServiceAdmissionMode;
  selfServiceAdmissionUpdatedAt: Date;
  selfServiceAdmissionUpdatedByUserId: string | null;
};

@Injectable()
export class PrivateBetaAccessProgramService {
  private readonly logger = new Logger(PrivateBetaAccessProgramService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSelfServiceAdmissionMode(): Promise<PrivateBetaSelfServiceAdmissionModeDto> {
    const state = await this.prisma.db.privateBetaAccessProgramState.findUnique(
      {
        where: { id: PRIVATE_BETA_PROGRAM_ID },
        select: {
          selfServiceAdmissionMode: true,
          selfServiceAdmissionUpdatedAt: true,
          selfServiceAdmissionUpdatedByUserId: true,
        },
      },
    );
    if (!state) {
      throw new Error('Private-beta program state is not initialized');
    }
    return this.toAdmissionModeDto(state);
  }

  async updateSelfServiceAdmissionMode(
    mode: PrivateBetaSelfServiceAdmissionMode,
    operatorId: UserId,
  ): Promise<PrivateBetaSelfServiceAdmissionModeUpdateResultDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockState(tx, 'UPDATE');
      if (state.selfServiceAdmissionMode === mode) {
        this.logger.debug('Private-beta admission mode update replayed', {
          operatorId,
          mode,
        });
        return {
          ...this.toAdmissionModeDto(state),
          alreadyCurrent: true,
        } satisfies PrivateBetaSelfServiceAdmissionModeUpdateResultDto;
      }

      const updatedAt = new Date();
      const updated = await tx.privateBetaAccessProgramState.update({
        where: { id: PRIVATE_BETA_PROGRAM_ID },
        data: {
          selfServiceAdmissionMode: mode,
          selfServiceAdmissionUpdatedAt: updatedAt,
          selfServiceAdmissionUpdatedByUserId: operatorId,
        },
        select: {
          selfServiceAdmissionMode: true,
          selfServiceAdmissionUpdatedAt: true,
          selfServiceAdmissionUpdatedByUserId: true,
        },
      });
      this.logger.log('Private-beta self-service admission mode changed', {
        operatorId,
        previousMode: state.selfServiceAdmissionMode,
        mode,
      });
      return {
        ...this.toAdmissionModeDto(updated),
        alreadyCurrent: false,
      } satisfies PrivateBetaSelfServiceAdmissionModeUpdateResultDto;
    });
  }

  async close(
    operatorId: UserId,
  ): Promise<PrivateBetaAccessProgramCloseResultDto> {
    this.logger.debug('Private-beta close request entered service', {
      operatorId,
    });

    return this.prisma.db.$transaction(async (tx) => {
      const state = await this.lockState(tx, 'UPDATE');
      if (state.closedAt !== null) {
        if (state.closedByUserId === null) {
          throw new Error('Closed private-beta state is missing its operator');
        }
        this.logger.debug('Private-beta close replay returned durable state', {
          operatorId,
          closedByUserId: state.closedByUserId,
        });
        return this.toCloseResult(state, true, 0);
      }

      const closedAt = new Date();
      const closed = await tx.privateBetaAccessProgramState.update({
        where: { id: PRIVATE_BETA_PROGRAM_ID },
        data: { closedAt, closedByUserId: operatorId },
        select: { closedAt: true, closedByUserId: true },
      });
      const revoked = await tx.passwordChangeCredential.updateMany({
        where: {
          privateBetaAccessRequestId: { not: null },
          consumedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: closedAt },
      });

      this.logger.log('Private-beta access durably closed', {
        operatorId,
        revokedCredentialCount: revoked.count,
      });
      return this.toCloseResult(closed, false, revoked.count);
    });
  }

  async assertOpenInTransaction(tx: AnyTransactionClient): Promise<void> {
    const state = await this.lockState(tx, 'SHARE');
    if (state.closedAt !== null) {
      this.logger.debug('Private-beta operation rejected after closure');
      throw new ConflictException('Private-beta access is closed');
    }
  }

  async isSelfServiceAdmissionOpenInTransaction(
    tx: AnyTransactionClient,
  ): Promise<boolean> {
    const state = await this.lockState(tx, 'SHARE');
    return state.closedAt === null && state.selfServiceAdmissionMode === 'OPEN';
  }

  private async lockState(
    tx: AnyTransactionClient,
    lock: 'SHARE' | 'UPDATE',
  ): Promise<LockedProgramState> {
    const rows =
      lock === 'UPDATE'
        ? await tx.$queryRaw<LockedProgramState[]>`
            SELECT
              state."closed_at" AS "closedAt",
              state."closed_by_user_id" AS "closedByUserId",
              state."self_service_admission_mode" AS "selfServiceAdmissionMode",
              state."self_service_admission_updated_at" AS "selfServiceAdmissionUpdatedAt",
              state."self_service_admission_updated_by_user_id" AS "selfServiceAdmissionUpdatedByUserId"
            FROM "private_beta_access_program_state" AS state
            WHERE state."id" = ${PRIVATE_BETA_PROGRAM_ID}
            FOR UPDATE
          `
        : await tx.$queryRaw<LockedProgramState[]>`
            SELECT
              state."closed_at" AS "closedAt",
              state."closed_by_user_id" AS "closedByUserId",
              state."self_service_admission_mode" AS "selfServiceAdmissionMode",
              state."self_service_admission_updated_at" AS "selfServiceAdmissionUpdatedAt",
              state."self_service_admission_updated_by_user_id" AS "selfServiceAdmissionUpdatedByUserId"
            FROM "private_beta_access_program_state" AS state
            WHERE state."id" = ${PRIVATE_BETA_PROGRAM_ID}
            FOR SHARE
          `;
    const state = rows[0];
    if (!state) {
      throw new Error('Private-beta program state is not initialized');
    }
    return state;
  }

  private toAdmissionModeDto(state: {
    selfServiceAdmissionMode: PrivateBetaSelfServiceAdmissionMode;
    selfServiceAdmissionUpdatedAt: Date;
    selfServiceAdmissionUpdatedByUserId: string | null;
  }): PrivateBetaSelfServiceAdmissionModeDto {
    return {
      mode: state.selfServiceAdmissionMode,
      updatedAt: state.selfServiceAdmissionUpdatedAt.toISOString(),
      updatedByUserId: state.selfServiceAdmissionUpdatedByUserId,
    } satisfies PrivateBetaSelfServiceAdmissionModeDto;
  }

  private toCloseResult(
    state: Pick<LockedProgramState, 'closedAt' | 'closedByUserId'>,
    alreadyClosed: boolean,
    revokedCredentialCount: number,
  ): PrivateBetaAccessProgramCloseResultDto {
    if (state.closedAt === null || state.closedByUserId === null) {
      throw new Error('Private-beta close result is incomplete');
    }
    return {
      status: 'CLOSED',
      closedAt: state.closedAt.toISOString(),
      closedByUserId: state.closedByUserId,
      alreadyClosed,
      revokedCredentialCount,
    } satisfies PrivateBetaAccessProgramCloseResultDto;
  }
}

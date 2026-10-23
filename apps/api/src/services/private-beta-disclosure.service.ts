import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  PrivateBetaDisclosureAcceptanceDto,
  PrivateBetaDisclosureAcceptanceInputDto,
  PrivateBetaDisclosureAcceptanceResponseDto,
  PrivateBetaDisclosureRequirementDto,
  PrivateBetaDisclosureStatusDto,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PRIVATE_BETA_DISCLOSURE_REQUIREMENTS } from './private-beta-disclosure.constants';

const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

const toAcceptanceDto = (record: {
  id: string;
  documentKind: PrivateBetaDisclosureAcceptanceDto['documentKind'];
  version: string;
  effectiveDate: Date;
  userId: string;
  organizationId: string;
  actionType: PrivateBetaDisclosureAcceptanceDto['actionType'];
  acceptedAt: Date;
}): PrivateBetaDisclosureAcceptanceDto => ({
  id: record.id,
  documentKind: record.documentKind,
  version: record.version,
  effectiveDate: toIsoDate(record.effectiveDate),
  userId: record.userId,
  organizationId: record.organizationId,
  actionType: record.actionType,
  acceptedAt: record.acceptedAt.toISOString(),
});

@Injectable()
export class PrivateBetaDisclosureService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(
    user: AuthenticatedUser,
  ): Promise<PrivateBetaDisclosureStatusDto> {
    const records =
      await this.prisma.db.privateBetaDisclosureAcceptance.findMany({
        where: {
          userId: user.userId,
          organizationId: user.currentOrgId,
        },
        orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
      });

    const recordedAcceptances = records.map(toAcceptanceDto);
    const isComplete = PRIVATE_BETA_DISCLOSURE_REQUIREMENTS.every(
      (requirement) =>
        recordedAcceptances.some(
          (record) =>
            record.documentKind === requirement.documentKind &&
            record.version === requirement.version &&
            record.effectiveDate === requirement.effectiveDate &&
            record.actionType === requirement.actionType,
        ),
    );

    return {
      requiredDocuments: PRIVATE_BETA_DISCLOSURE_REQUIREMENTS.map(
        (requirement) => ({ ...requirement }),
      ) as PrivateBetaDisclosureRequirementDto[],
      recordedAcceptances,
      isComplete,
    };
  }

  async submitAcceptance(
    user: AuthenticatedUser,
    input: PrivateBetaDisclosureAcceptanceInputDto,
  ): Promise<PrivateBetaDisclosureAcceptanceResponseDto> {
    const fields = input as unknown as Record<string, unknown>;
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      typeof fields.documentKind !== 'string' ||
      typeof fields.version !== 'string' ||
      typeof fields.effectiveDate !== 'string' ||
      typeof fields.actionType !== 'string'
    ) {
      throw new BadRequestException(
        'A private-beta disclosure acceptance is required.',
      );
    }

    const requirement = PRIVATE_BETA_DISCLOSURE_REQUIREMENTS.find(
      (candidate) => candidate.documentKind === input.documentKind,
    );
    if (!requirement) {
      throw new BadRequestException(
        'The private-beta disclosure document is not recognized.',
      );
    }

    if (input.actionType !== requirement.actionType) {
      throw new BadRequestException(
        `The ${requirement.documentKind.toLowerCase()} disclosure requires a ${requirement.actionType.toLowerCase()} action.`,
      );
    }

    if (
      input.version !== requirement.version ||
      input.effectiveDate !== requirement.effectiveDate
    ) {
      throw new ConflictException(
        'This disclosure changed. Refresh the current private-beta disclosures before submitting again.',
      );
    }

    const where = {
      userId: user.userId,
      organizationId: user.currentOrgId,
      documentKind: requirement.documentKind,
      version: requirement.version,
    } as const;
    const existing =
      await this.prisma.db.privateBetaDisclosureAcceptance.findUnique({
        where: {
          userId_organizationId_documentKind_version: where,
        },
      });
    if (existing) {
      return { accepted: true, acceptance: toAcceptanceDto(existing) };
    }

    try {
      const acceptance =
        await this.prisma.db.privateBetaDisclosureAcceptance.create({
          data: {
            userId: user.userId,
            organizationId: user.currentOrgId,
            documentKind: requirement.documentKind,
            version: requirement.version,
            effectiveDate: new Date(
              `${requirement.effectiveDate}T00:00:00.000Z`,
            ),
            actionType: requirement.actionType,
          },
        });

      return { accepted: true, acceptance: toAcceptanceDto(acceptance) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const acceptance =
          await this.prisma.db.privateBetaDisclosureAcceptance.findUnique({
            where: {
              userId_organizationId_documentKind_version: where,
            },
          });
        if (acceptance) {
          return { accepted: true, acceptance: toAcceptanceDto(acceptance) };
        }
      }
      throw error;
    }
  }
}

export {
  CreateProposalDto,
  CreateProposalRequestDto,
  UpdateProposalDto,
  ProposalResponseDto,
  ProposalOutOfDateStatus,
  ProposalType,
  ProposalAction,
  ProposalStatus,
  TargetEntityType,
} from 'src/generated';

export type { PaginatedProposalsResponse as PaginatedProposalsDto } from 'src/generated';

export type {
  ProposalPayload,
  CreateProposalInput,
  StampedCreateProposalDto,
  TypedProposalResponse,
  UpdatesFor,
} from './proposal.types';

import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemTypeRole,
} from 'src/generated';

export class RejectProposalDto {
  @ApiPropertyOptional({
    description:
      'Reason for rejecting the proposal. Optional for CREATE proposals; ' +
      'UPDATE and DELETE proposals require a non-blank reason.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class QueryProposalsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  completionDependencyId?: string;

  @ApiPropertyOptional({ enum: ProposalType })
  @IsOptional()
  @IsEnum(ProposalType)
  type?: ProposalType;

  @ApiPropertyOptional({ enum: ProposalAction })
  @IsOptional()
  @IsEnum(ProposalAction)
  action?: ProposalAction;

  @ApiPropertyOptional({ enum: ProposalStatus })
  @IsOptional()
  @IsEnum(ProposalStatus)
  status?: ProposalStatus;

  @ApiPropertyOptional({ enum: TargetEntityType })
  @IsOptional()
  @IsEnum(TargetEntityType)
  targetEntityType?: TargetEntityType;

  @ApiPropertyOptional({ enum: WorkItemTypeRole })
  @IsOptional()
  @IsEnum(WorkItemTypeRole)
  workItemRole?: WorkItemTypeRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  targetEntityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  validationSessionId?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  windowStart?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  windowEnd?: string;

  @ApiPropertyOptional({ type: Number, minimum: 0, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  limit?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export function resolveProposalWindow(
  query: Pick<QueryProposalsDto, 'windowStart' | 'windowEnd'>,
): { windowStart: Date; windowEnd: Date } | undefined {
  if (query.windowStart === undefined && query.windowEnd === undefined) {
    return undefined;
  }
  if (query.windowStart === undefined || query.windowEnd === undefined) {
    throw new BadRequestException(
      'Proposal window requires both windowStart and windowEnd',
    );
  }
  const windowStart = new Date(query.windowStart);
  const windowEnd = new Date(query.windowEnd);
  if (
    !Number.isFinite(windowStart.getTime()) ||
    !Number.isFinite(windowEnd.getTime()) ||
    windowStart >= windowEnd
  ) {
    throw new BadRequestException('windowStart must be before windowEnd');
  }
  return { windowStart, windowEnd };
}

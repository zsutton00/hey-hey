import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ValidationSession,
  ValidationSessionStatus as PrismaValidationSessionStatus,
  Prisma,
} from '@prisma/client';
import { AnyTransactionClient, PrismaService } from 'src/prisma/prisma.service';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
  ValidationSessionId,
} from 'src/types';
import {
  CreateValidationSessionDto,
  UpdateValidationSessionDto,
  ValidationSessionDto,
  ValidationSessionStatus,
} from 'src/generated';
import { ConversationService } from './conversation.service';

type ValidationSessionWithDates = ValidationSession & {
  createdAt: Date;
  updatedAt: Date;
};

const VALID_STATUSES: readonly ValidationSessionStatus[] = [
  'CREATED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
] as const;

const VALID_TRANSITIONS: Record<
  ValidationSessionStatus,
  readonly ValidationSessionStatus[]
> = {
  CREATED: ['RUNNING', 'FAILED'],
  RUNNING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: [],
};

@Injectable()
export class ValidationSessionService {
  private readonly logger = new Logger(ValidationSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
  ) {}

  async create(
    organizationId: OrganizationId,
    currentUserId: UserId,
    dto: CreateValidationSessionDto,
  ): Promise<ValidationSessionDto> {
    this.assertConversationIdNotProvided(dto);
    if (dto.status !== undefined) {
      this.assertValidStatus(dto.status);
    }

    const validationSessionId = randomUUID();
    const sessionTitle = dto.title || 'Validation Session';

    try {
      const created = await this.prisma.db.$transaction(async (tx) => {
        await this.assertProjectOwnership(organizationId, dto.projectId, tx);
        await this.assertTaskOwnership(
          organizationId,
          dto.taskId,
          dto.projectId,
          tx,
        );

        if (dto.serviceIds?.length) {
          await this.assertServicesOwnership(
            organizationId,
            dto.serviceIds,
            tx,
          );
        }

        const conversation =
          await this.conversationService.createValidationSessionConversationInTransaction(
            {
              tx,
              organizationId,
              projectId: dto.projectId,
              validationSessionId,
              userId: currentUserId,
              title: sessionTitle,
            },
          );

        const session = (await tx.validationSession.create({
          data: {
            id: validationSessionId,
            organization: { connect: { id: organizationId } },
            user: { connect: { id: currentUserId } },
            task: { connect: { id: dto.taskId } },
            conversation: { connect: { id: conversation.id } },
            title: sessionTitle,
            status: (dto.status as PrismaValidationSessionStatus) ?? undefined,
          },
        })) as ValidationSessionWithDates;

        if (dto.serviceIds?.length) {
          await tx.serviceValidationSession.createMany({
            data: dto.serviceIds.map((serviceId) => ({
              serviceId,
              validationSessionId: session.id,
            })),
          });
        }

        return session;
      });

      return this.toDto(created, dto.serviceIds);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error('Failed to create validation session', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Unable to create validation session: ${(error as Error).message}`,
      );
    }
  }

  async findOne(
    organizationId: OrganizationId,
    validationSessionId: string,
  ): Promise<ValidationSessionDto> {
    const session = await this.prisma.db.validationSession.findFirst({
      where: { id: validationSessionId, organizationId },
      include: { serviceRelations: { select: { serviceId: true } } },
    });

    if (!session) {
      throw new NotFoundException('Validation session not found');
    }

    const serviceIds = session.serviceRelations.map((r) => r.serviceId);
    return this.toDto(
      session as ValidationSessionWithDates,
      serviceIds.length > 0 ? serviceIds : undefined,
    );
  }

  async findMany(
    organizationId: OrganizationId,
    filters: {
      taskId?: string;
      status?: string;
      accessibleProjectIds?: string[];
    } = {},
  ): Promise<ValidationSessionDto[]> {
    const where: Prisma.ValidationSessionWhereInput = {
      organizationId,
      ...(filters.accessibleProjectIds
        ? { task: { projectId: { in: filters.accessibleProjectIds } } }
        : {}),
      ...(filters.taskId ? { taskId: filters.taskId } : {}),
      ...(filters.status
        ? {
            status: filters.status as PrismaValidationSessionStatus,
          }
        : {}),
    };

    const sessions = await this.prisma.db.validationSession.findMany({
      where,
      include: { serviceRelations: { select: { serviceId: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((session) => {
      const serviceIds = session.serviceRelations.map((r) => r.serviceId);
      return this.toDto(
        session as ValidationSessionWithDates,
        serviceIds.length > 0 ? serviceIds : undefined,
      );
    });
  }

  async update(
    organizationId: OrganizationId,
    validationSessionId: string,
    dto: UpdateValidationSessionDto,
  ): Promise<ValidationSessionDto> {
    try {
      const result = await this.prisma.db.$transaction(async (tx) => {
        const existing = await tx.validationSession.findFirst({
          where: { id: validationSessionId, organizationId },
        });

        if (!existing) {
          throw new NotFoundException('Validation session not found');
        }

        if (dto.status !== undefined) {
          this.assertValidStatus(dto.status);
          this.assertValidTransition(
            existing.status as ValidationSessionStatus,
            dto.status,
          );
        }

        if (dto.serviceIds !== undefined) {
          await this.assertServicesOwnership(
            organizationId,
            dto.serviceIds,
            tx,
          );

          await tx.serviceValidationSession.deleteMany({
            where: { validationSessionId },
          });

          if (dto.serviceIds.length > 0) {
            await tx.serviceValidationSession.createMany({
              data: dto.serviceIds.map((serviceId) => ({
                serviceId,
                validationSessionId,
              })),
            });
          }
        }

        const updated = (await tx.validationSession.update({
          where: { id: validationSessionId },
          data: {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.status !== undefined
              ? { status: dto.status as PrismaValidationSessionStatus }
              : {}),
          },
        })) as ValidationSessionWithDates;

        return { updated, serviceIds: dto.serviceIds };
      });

      if (result.serviceIds !== undefined) {
        return this.toDto(result.updated, result.serviceIds);
      }

      const freshSession = await this.findOne(
        organizationId,
        validationSessionId,
      );
      return freshSession;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }
      this.logger.error('Failed to update validation session', {
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Unable to update validation session: ${(error as Error).message}`,
      );
    }
  }

  private toDto(
    session: ValidationSessionWithDates,
    serviceIds?: string[],
  ): ValidationSessionDto {
    return {
      id: session.id as ValidationSessionId,
      organizationId: session.organizationId as OrganizationId,
      userId: session.userId,
      taskId: session.taskId as TaskId,
      conversationId: session.conversationId as ConversationId,
      title: session.title ?? undefined,
      status: session.status as ValidationSessionStatus,
      serviceIds,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    } satisfies ValidationSessionDto;
  }

  private assertConversationIdNotProvided(dto: unknown): void {
    const input = dto as { conversationId?: unknown };
    if (input.conversationId !== undefined) {
      throw new BadRequestException(
        'conversationId is managed by the system and cannot be provided',
      );
    }
  }

  private assertValidStatus(status: unknown): void {
    if (!VALID_STATUSES.includes(status as ValidationSessionStatus)) {
      throw new BadRequestException(
        `status must be one of: ${VALID_STATUSES.join(', ')}`,
      );
    }
  }

  private assertValidTransition(
    current: ValidationSessionStatus,
    next: ValidationSessionStatus,
  ): void {
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed.includes(next)) {
      throw new BadRequestException(
        `Cannot transition from ${current} to ${next}. Allowed transitions: ${allowed.join(', ') || 'none (terminal state)'}`,
      );
    }
  }

  private async assertProjectOwnership(
    organizationId: OrganizationId,
    projectId: ProjectId,
    dbClient: Pick<AnyTransactionClient, 'project'> = this.prisma.db,
  ): Promise<void> {
    const project = await dbClient.project.findFirst({
      where: { id: projectId, organizationId },
      select: { id: true },
    });

    if (!project) {
      throw new BadRequestException(
        'projectId must belong to the organization',
      );
    }
  }

  private async assertTaskOwnership(
    organizationId: OrganizationId,
    taskId: TaskId,
    projectId: ProjectId,
    dbClient: Pick<AnyTransactionClient, 'task'> = this.prisma.db,
  ): Promise<void> {
    const task = await dbClient.task.findFirst({
      where: { id: taskId, organizationId, projectId },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundException(
        'Task not found in the specified project and organization',
      );
    }
  }

  private async assertServicesOwnership(
    organizationId: OrganizationId,
    serviceIds: string[],
    dbClient: Pick<AnyTransactionClient, 'service'> = this.prisma.db,
  ): Promise<void> {
    const services = await dbClient.service.findMany({
      where: {
        id: { in: serviceIds },
        organizationId,
      },
      select: { id: true },
    });

    if (services.length !== serviceIds.length) {
      const found = new Set(services.map((s: { id: string }) => s.id));
      const missing = serviceIds.filter((sid) => !found.has(sid));
      throw new BadRequestException(
        `Service(s) not found in organization: ${missing.join(', ')}`,
      );
    }
  }
}

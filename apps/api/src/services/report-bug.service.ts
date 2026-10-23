import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import {
  type CreateTaskDto,
  type ReportBugRequestDto,
  type ReportBugResponseDto,
  TaskSource,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId, TaskId, UserId } from 'src/types';
import { WORK_ITEM_TYPE_KEYS } from './tasks/work-item-type-keys';
import { TaskService } from './tasks/task.service';

const REPORT_BUG_CONFIG_KEYS = {
  organizationId: 'REPORT_BUG_ORGANIZATION_ID',
  projectId: 'REPORT_BUG_PROJECT_ID',
  parentFeatureId: 'REPORT_BUG_PARENT_FEATURE_ID',
} as const;

const ALLOWED_REQUEST_FIELDS = new Set([
  'description',
  'productLocation',
  'correlationId',
  'diagnosticConsent',
]);

type ReportBugDestination = {
  organizationId: OrganizationId;
  projectId: ProjectId;
  parentFeatureId: TaskId;
};

@Injectable()
export class ReportBugService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly taskService: TaskService,
  ) {}

  async reportBug(
    input: ReportBugRequestDto,
    userId: UserId,
  ): Promise<ReportBugResponseDto> {
    const request = this.validateRequest(input);
    const destination = this.readConfiguredDestination();

    return this.prisma.$transaction(async (tx) => {
      await this.assertDestinationAvailable(tx, destination);

      const createTaskDto = {
        name: this.buildBugTitle(request.description),
        type: WORK_ITEM_TYPE_KEYS.Bug,
        parentTaskId: destination.parentFeatureId,
        source: TaskSource.User,
        sections: [{ key: 'description', content: request.description }],
      } satisfies CreateTaskDto;

      const bug = await this.taskService.createInTransaction(
        tx,
        destination.organizationId,
        null,
        createTaskDto,
        destination.projectId,
      );

      await tx.bugReportIntakeContext.create({
        data: {
          bugTaskId: bug.id,
          reportedByUserId: userId,
          productLocation: request.productLocation,
          correlationId: request.correlationId,
          diagnosticConsentAt: new Date(),
        },
      });

      return { bugId: bug.id } satisfies ReportBugResponseDto;
    });
  }

  private validateRequest(input: ReportBugRequestDto): {
    description: string;
    productLocation: string;
    correlationId: string | null;
  } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new BadRequestException('A report request body is required.');
    }

    const unknownField = Object.keys(
      input as unknown as Record<string, unknown>,
    ).find((field) => !ALLOWED_REQUEST_FIELDS.has(field));
    if (unknownField) {
      throw new BadRequestException(`Unexpected report field: ${unknownField}`);
    }

    const description =
      typeof input.description === 'string' ? input.description.trim() : '';
    if (!description || description.length > 10000) {
      throw new BadRequestException(
        'Description must contain between 1 and 10000 characters.',
      );
    }

    const productLocation =
      typeof input.productLocation === 'string' ? input.productLocation : '';
    if (!productLocation.trim() || productLocation.length > 500) {
      throw new BadRequestException(
        'Product location must contain between 1 and 500 characters.',
      );
    }

    if (input.diagnosticConsent !== true) {
      throw new BadRequestException('Diagnostic consent is required.');
    }

    if (
      input.correlationId !== undefined &&
      input.correlationId !== null &&
      typeof input.correlationId !== 'string'
    ) {
      throw new BadRequestException(
        'Correlation identifier must be a string when provided.',
      );
    }
    const correlationId = input.correlationId?.trim() || null;
    if (correlationId && correlationId.length > 128) {
      throw new BadRequestException(
        'Correlation identifier must not exceed 128 characters.',
      );
    }

    return { description, productLocation, correlationId };
  }

  private readConfiguredDestination(): ReportBugDestination {
    const organizationId = this.config.get<string>(
      REPORT_BUG_CONFIG_KEYS.organizationId,
    );
    const projectId = this.config.get<string>(REPORT_BUG_CONFIG_KEYS.projectId);
    const parentFeatureId = this.config.get<string>(
      REPORT_BUG_CONFIG_KEYS.parentFeatureId,
    );

    if (!organizationId || !projectId || !parentFeatureId) {
      throw new ServiceUnavailableException(
        'The report intake destination is not configured.',
      );
    }

    return {
      organizationId: organizationId as OrganizationId,
      projectId: projectId as ProjectId,
      parentFeatureId: parentFeatureId as TaskId,
    };
  }

  private async assertDestinationAvailable(
    tx: Prisma.TransactionClient,
    destination: ReportBugDestination,
  ): Promise<void> {
    const [organization, project, parentFeature] = await Promise.all([
      tx.organization.findFirst({
        where: { id: destination.organizationId, isActive: true },
        select: { id: true },
      }),
      tx.project.findFirst({
        where: {
          id: destination.projectId,
          organizationId: destination.organizationId,
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true },
      }),
      tx.task.findFirst({
        where: {
          id: destination.parentFeatureId,
          organizationId: destination.organizationId,
          projectId: destination.projectId,
          type: WORK_ITEM_TYPE_KEYS.Feature,
          archivedAt: null,
          status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
        },
        select: { id: true },
      }),
    ]);

    if (!organization || !project || !parentFeature) {
      throw new ServiceUnavailableException(
        'The configured report intake destination is unavailable.',
      );
    }
  }

  private buildBugTitle(description: string): string {
    const summary = description.replace(/\s+/g, ' ').slice(0, 110).trim();
    return `Reported problem: ${summary}`;
  }
}

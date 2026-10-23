import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type {
  CreateProjectReportRequestDto,
  ProjectReportContextBatchResponseDto,
  ProjectReportContextPageDto,
  ProjectReportSubject,
} from 'src/generated';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import {
  ProjectReportActivityService,
  projectReportSubjectKey,
  type ProjectReportSelection,
} from './project-report-activity.service';
import { ProjectReportPlacementService } from './project-report-placement.service';

const MAX_BATCH_SUBJECTS = 100;

type ContextReadInput = {
  organizationId: OrganizationId;
  projectId: ProjectId;
  userId: UserId;
  requestId: string;
  attemptId: string;
  submission: CreateProjectReportRequestDto;
};

@Injectable()
export class ProjectReportContextService {
  constructor(
    private readonly activity: ProjectReportActivityService,
    private readonly placement: ProjectReportPlacementService,
  ) {}

  async read(
    input: ContextReadInput & { subject: ProjectReportSubject },
  ): Promise<ProjectReportContextPageDto> {
    const selection = await this.select(input);
    return this.buildContext(
      input,
      selection,
      input.subject,
      new Date().toISOString(),
    );
  }

  /**
   * One selection and one placement walk for up to 100 subjects. Any subject
   * that is not included rejects the whole batch, matching the single read.
   */
  async readBatch(
    input: ContextReadInput & { subjects: ProjectReportSubject[] },
  ): Promise<ProjectReportContextBatchResponseDto> {
    const keys = input.subjects.map(projectReportSubjectKey);
    if (
      keys.length < 1 ||
      keys.length > MAX_BATCH_SUBJECTS ||
      new Set(keys).size !== keys.length
    ) {
      throw new BadRequestException(
        `A context batch must contain 1–${MAX_BATCH_SUBJECTS} unique subjects`,
      );
    }
    const selection = await this.select(input);
    const queriedAt = new Date().toISOString();
    const contexts = input.subjects.map((subject) =>
      this.buildContext(input, selection, subject, queriedAt),
    );
    const placements = await this.placement.resolve({
      organizationId: input.organizationId,
      projectId: input.projectId,
      subjects: input.subjects,
    });
    return {
      requestId: input.requestId,
      attemptId: input.attemptId,
      items: contexts.map((context) => ({
        context,
        placement: placements.get(projectReportSubjectKey(context.subject))!,
      })),
      queriedAt,
    } satisfies ProjectReportContextBatchResponseDto;
  }

  private select(input: ContextReadInput): Promise<ProjectReportSelection> {
    return this.activity.select({
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      scope: input.submission.scope,
      exclusions: input.submission.exclusions,
    });
  }

  private buildContext(
    input: ContextReadInput,
    selection: ProjectReportSelection,
    subject: ProjectReportSubject,
    queriedAt: string,
  ): ProjectReportContextPageDto {
    const key = projectReportSubjectKey(subject);
    const included = selection.subjects.find(
      (row) => projectReportSubjectKey(row.subject) === key && !row.excluded,
    );
    if (!included)
      throw new ConflictException(
        'Context subject is not included in this request',
      );
    const record = selection.records.find(
      (item) => projectReportSubjectKey(item) === key,
    )!;
    const authorizedKeys = new Set(
      selection.subjects.map((row) => projectReportSubjectKey(row.subject)),
    );
    const relatedSubjects = record.linkedEntities
      .filter((linked) => authorizedKeys.has(projectReportSubjectKey(linked)))
      .slice(0, 50)
      .map(
        (linked) =>
          ({
            entityType: linked.entityType,
            entityId: linked.entityId,
          }) satisfies ProjectReportSubject,
      );
    return {
      requestId: input.requestId,
      attemptId: input.attemptId,
      subject,
      kind: 'CURRENT_STATE_CONTEXT',
      title: record.title,
      ...(record.status ? { status: record.status } : {}),
      ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
      relatedSubjects,
      queriedAt,
    } satisfies ProjectReportContextPageDto;
  }
}

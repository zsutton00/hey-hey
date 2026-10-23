import { BadRequestException, PipeTransform } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type {
  CreateProjectReportRequestDto,
  ProjectReportContextBatchRequestDto,
  ProjectReportPreviewRequestDto,
  RetryProjectReportRequestDto,
} from 'src/generated';
import { projectReportSchemas } from 'src/generated/project-report.schemas';

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const create = ajv.compile<CreateProjectReportRequestDto>(
  projectReportSchemas.CreateProjectReportRequestDto,
);
const preview = ajv.compile<ProjectReportPreviewRequestDto>(
  projectReportSchemas.ProjectReportPreviewRequestDto,
);
const retry = ajv.compile<RetryProjectReportRequestDto>(
  projectReportSchemas.RetryProjectReportRequestDto,
);
const contextBatch = ajv.compile<ProjectReportContextBatchRequestDto>(
  projectReportSchemas.ProjectReportContextBatchRequestDto,
);

/** Controller boundary adapters; generated schemas own every structural constraint. */
export class CreateProjectReportRequestPipe
  implements PipeTransform<unknown, CreateProjectReportRequestDto>
{
  transform(value: unknown): CreateProjectReportRequestDto {
    if (!create(value))
      throw new BadRequestException('Invalid project report request');
    return value;
  }
}

export class ProjectReportPreviewPipe
  implements PipeTransform<unknown, ProjectReportPreviewRequestDto>
{
  transform(value: unknown): ProjectReportPreviewRequestDto {
    if (!preview(value))
      throw new BadRequestException('Invalid project report preview');
    return value;
  }
}

export class RetryProjectReportRequestPipe
  implements PipeTransform<unknown, RetryProjectReportRequestDto>
{
  transform(value: unknown): RetryProjectReportRequestDto {
    if (!retry(value))
      throw new BadRequestException('Invalid project report retry');
    return value;
  }
}

export class ProjectReportContextBatchPipe
  implements PipeTransform<unknown, ProjectReportContextBatchRequestDto>
{
  transform(value: unknown): ProjectReportContextBatchRequestDto {
    if (!contextBatch(value))
      throw new BadRequestException('Invalid project report context batch');
    return value;
  }
}

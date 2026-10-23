import { BadRequestException } from '@nestjs/common';
import {
  CreateProjectReportRequestPipe,
  ProjectReportPreviewPipe,
  RetryProjectReportRequestPipe,
} from '../project-report-request.validation';
import { projectReportRequest } from 'src/services/reports/__tests__/project-report.fixture';

describe('OpenAPI-derived project report request boundary', () => {
  const pipe = new CreateProjectReportRequestPipe();

  it('preserves the edited request, scope and graph-only launch configuration', () => {
    expect(pipe.transform(projectReportRequest)).toBe(projectReportRequest);
  });

  it('accepts only a nonempty unique UUID selection for release notes', () => {
    const serviceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const release = {
      ...projectReportRequest,
      kind: 'RELEASE_NOTES',
      serviceIds: [serviceId],
    };
    expect(pipe.transform(release)).toBe(release);
    for (const serviceIds of [
      undefined,
      [],
      [serviceId, serviceId],
      ['invalid'],
    ]) {
      expect(() => pipe.transform({ ...release, serviceIds })).toThrow(
        BadRequestException,
      );
    }
    expect(() =>
      pipe.transform({ ...projectReportRequest, serviceIds: [serviceId] }),
    ).toThrow(BadRequestException);
  });

  it.each([
    { ...projectReportRequest, question: '' },
    {
      ...projectReportRequest,
      scope: { ...projectReportRequest.scope, windowStart: 'yesterday' },
    },
    {
      ...projectReportRequest,
      exclusions: [{ entityId: 'invalid', entityType: 'TASK' }],
    },
    {
      ...projectReportRequest,
      launch: { ...projectReportRequest.launch, serviceId: 'invented' },
    },
    { ...projectReportRequest, messageId: 'not-a-conversation' },
  ])('rejects contract-invalid external input', (input) => {
    expect(() => pipe.transform(input)).toThrow(BadRequestException);
  });

  it('validates preview pagination without changing exclusions', () => {
    const preview = new ProjectReportPreviewPipe();
    const input = {
      scope: projectReportRequest.scope,
      exclusions: [],
      limit: 200,
      offset: 200,
    };
    expect(preview.transform(input)).toBe(input);
    expect(() => preview.transform({ ...input, limit: 201 })).toThrow(
      BadRequestException,
    );
  });

  it('requires the exact prior attempt for an idempotent retry', () => {
    const retry = new RetryProjectReportRequestPipe();
    const input = {
      idempotencyKey: 'retry-one',
      expectedAttemptId: '62d8d42c-a788-4356-8ce9-ebfeec603b31',
    };
    expect(retry.transform(input)).toBe(input);
    expect(() => retry.transform({ idempotencyKey: 'retry-one' })).toThrow(
      BadRequestException,
    );
  });
});

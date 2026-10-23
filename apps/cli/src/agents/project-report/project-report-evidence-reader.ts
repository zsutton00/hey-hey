import { z } from 'zod';
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  EntityType,
  ProjectReportContextPageDtoKindEnum,
  ProjectReportCoverageStatusEnum,
  ProjectReportEvidenceReferenceKindEnum,
  ProjectReportsApiAxiosParamCreator,
  type ActivityCorrelationRecordDto,
  type ProjectReportCoverage,
  type ProjectReportEvidenceReference,
  type ProjectReportSubject,
  type ProjectReportSubjectPlacement,
} from '../../shared/api/generated/api';
import type { ServerLogger } from '../../server/logger';
import type { ProjectReportRequestProjection } from './project-report-request-reader';

export type ProjectReportActivityEvidence = Pick<
  ActivityCorrelationRecordDto,
  'entityType' | 'entityId' | 'title' | 'type' | 'timestamp' | 'source'
>;

interface ProjectReportSubjectActivity {
  activityType: ActivityCorrelationActivityType;
  source: ActivityCorrelationSource;
  count: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
}

/**
 * Everything the selected period recorded for one primary subject, joined with
 * that subject's current state. The author writes about subjects, so the host
 * groups activity by subject rather than by page or activity type.
 */
export interface ProjectReportSubjectDigest {
  subject: ProjectReportSubject;
  title: string;
  currentStatus?: string;
  activity: ProjectReportSubjectActivity[];
  latestActivityEvidenceKey: string;
  currentStateEvidenceKey?: string;
  /** Owning plan and feature lineage; absent when current-state detail could not be read. */
  placement?: ProjectReportSubjectPlacement;
}

export interface ProjectReportEvidenceResult {
  subjects: ProjectReportSubjectDigest[];
  evidenceReferences: ProjectReportEvidenceReference[];
  evidenceReadStartedAt: string;
  evidenceReadCompletedAt: string;
  coverage: ProjectReportCoverage;
}

export interface ProjectReportEvidenceReadInput {
  token: string;
  organizationId: string;
  projectId: string;
  requestId: string;
  attemptId: string;
  agentSessionId: string;
  request: ProjectReportRequestProjection;
}

class ProjectReportEvidenceReadContractError extends Error {
  public constructor(
    public readonly code:
      | 'ACTIVITY_IDENTITY_MISMATCH'
      | 'CONTEXT_IDENTITY_MISMATCH'
      | 'EXCLUDED_PRIMARY_SUBJECT',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectReportEvidenceReadContractError';
  }
}

class ProjectReportEvidenceRequestError extends Error {
  public constructor(
    public readonly code: 'HTTP_ERROR' | 'NETWORK_ERROR' | 'INVALID_JSON' | 'INVALID_RESPONSE',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ProjectReportEvidenceRequestError';
  }
}

const ACTIVITY_PAGE_SIZE = 50;
const MAX_ACTIVITY_PAGES = 100;
const MAX_ACTIVITY_RECORDS = 5000;
/** The batch current-state read accepts at most this many subjects per call. */
const CONTEXT_BATCH_SIZE = 100;

interface SubjectAccumulator {
  subject: ProjectReportSubject;
  latest: ProjectReportActivityEvidence;
  activityCount: number;
  changeCount: number;
  activity: Map<string, ProjectReportSubjectActivity>;
}

const projectReportSubjectSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().uuid(),
});

const activityRecordSchema = z.object({
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().uuid(),
  title: z.string().min(1),
  type: z.nativeEnum(ActivityCorrelationActivityType),
  timestamp: z.string().min(1),
  source: z.nativeEnum(ActivityCorrelationSource),
});

const activityPageSchema = z.object({
  requestId: z.string().uuid(),
  attemptId: z.string().uuid(),
  records: z.array(activityRecordSchema),
  total: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().optional(),
  queriedAt: z.string().min(1),
});

const currentStateContextSchema = z.object({
  requestId: z.string().uuid(),
  attemptId: z.string().uuid(),
  subject: projectReportSubjectSchema,
  kind: z.literal(ProjectReportContextPageDtoKindEnum.CurrentStateContext),
  title: z.string().min(1),
  status: z.string().optional(),
  updatedAt: z.string().optional(),
  relatedSubjects: z.array(projectReportSubjectSchema),
  queriedAt: z.string().min(1),
});

const placementEntrySchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
});

const contextBatchSchema = z.object({
  requestId: z.string().uuid(),
  attemptId: z.string().uuid(),
  items: z.array(
    z.object({
      context: currentStateContextSchema,
      placement: z.object({
        plan: placementEntrySchema.optional(),
        features: z.array(placementEntrySchema),
      }),
    }),
  ),
  queriedAt: z.string().min(1),
});

const activityPageResponseSchema = z
  .object({ success: z.literal(true), data: activityPageSchema })
  .transform((response) => response.data);

const contextBatchResponseSchema = z
  .object({ success: z.literal(true), data: contextBatchSchema })
  .transform((response) => response.data);

interface CurrentStateDetail {
  title: string;
  status?: string;
  placement: ProjectReportSubjectPlacement;
}

type SafeParseResult<T> = { success: true; data: T } | { success: false };

export class ProjectReportEvidenceReader {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: ServerLogger;

  public constructor(options: {
    apiBaseUrl: string;
    fetchImpl: typeof fetch;
    logger: ServerLogger;
  }) {
    this.apiBaseUrl = options.apiBaseUrl;
    this.fetchImpl = options.fetchImpl;
    this.logger = options.logger;
  }

  public async read(input: ProjectReportEvidenceReadInput): Promise<ProjectReportEvidenceResult> {
    const evidenceReadStartedAt = new Date().toISOString();
    const subjects = new Map<string, SubjectAccumulator>();
    let pagesRead = 0;
    let firstReportedTotal: number | undefined;
    let processedActivityCount = 0;
    const limitations: string[] = [];
    const excludedSubjects = new Set(
      input.request.submission.exclusions.map((subject) => this.subjectKey(subject)),
    );
    let matchingActivityCount: number | undefined;
    let offset = 0;
    let reachedEnd = false;

    this.logger.info('project_report.evidence.read.started', {
      requestId: input.requestId,
      attemptId: input.attemptId,
      projectId: input.projectId,
      activityPageSize: ACTIVITY_PAGE_SIZE,
      maxActivityPages: MAX_ACTIVITY_PAGES,
      maxActivityRecords: MAX_ACTIVITY_RECORDS,
      contextBatchSize: CONTEXT_BATCH_SIZE,
    });

    while (pagesRead < MAX_ACTIVITY_PAGES) {
      this.logger.debug('project_report.activity_page.read.started', {
        requestId: input.requestId,
        attemptId: input.attemptId,
        offset,
        limit: ACTIVITY_PAGE_SIZE,
      });
      let page: z.infer<typeof activityPageSchema>;
      try {
        page = await this.readActivityPage(input, offset);
      } catch (error) {
        limitations.push(this.describeReadFailure('Activity page', offset, error));
        this.logger.warn('project_report.activity_page.read.failed', {
          requestId: input.requestId,
          attemptId: input.attemptId,
          offset,
          errorCode:
            error instanceof ProjectReportEvidenceRequestError ? error.code : 'REQUEST_FAILED',
          ...(error instanceof ProjectReportEvidenceRequestError && error.status !== undefined
            ? { status: error.status }
            : {}),
        });
        break;
      }

      if (page.requestId !== input.requestId || page.attemptId !== input.attemptId) {
        this.logger.error('project_report.activity_page.identity_mismatch', {
          requestId: input.requestId,
          attemptId: input.attemptId,
          responseRequestId: page.requestId,
          responseAttemptId: page.attemptId,
          offset,
        });
        throw new ProjectReportEvidenceReadContractError(
          'ACTIVITY_IDENTITY_MISMATCH',
          'Activity page response did not match the active request and attempt',
        );
      }

      matchingActivityCount =
        matchingActivityCount === undefined
          ? page.total
          : Math.max(matchingActivityCount, page.total);
      if (firstReportedTotal === undefined) {
        firstReportedTotal = page.total;
      } else if (page.total !== firstReportedTotal) {
        limitations.push('The live matching activity total changed while pages were being read.');
      }
      pagesRead += 1;

      const availableRecordCount = MAX_ACTIVITY_RECORDS - processedActivityCount;
      const recordsToProcess = page.records.slice(0, availableRecordCount);
      for (const record of recordsToProcess) {
        const subject = { entityType: record.entityType, entityId: record.entityId };
        if (excludedSubjects.has(this.subjectKey(subject))) {
          this.logger.error('project_report.activity_page.excluded_primary_subject', {
            requestId: input.requestId,
            attemptId: input.attemptId,
            entityType: record.entityType,
            entityId: record.entityId,
            offset,
          });
          throw new ProjectReportEvidenceReadContractError(
            'EXCLUDED_PRIMARY_SUBJECT',
            'Authorized activity page returned an excluded entity as a primary subject',
          );
        }
        this.accumulate(subjects, subject, record);
        processedActivityCount += 1;
      }
      this.logger.debug('project_report.activity_page.read.completed', {
        requestId: input.requestId,
        attemptId: input.attemptId,
        offset,
        retrievedActionCount: page.records.length,
        processedActionCount: recordsToProcess.length,
        reportedTotal: page.total,
        nextOffset: page.nextOffset ?? null,
      });

      if (recordsToProcess.length < page.records.length) {
        limitations.push(
          `Activity reading was bounded to ${MAX_ACTIVITY_RECORDS} of the retrieved actions.`,
        );
        break;
      }
      if (page.nextOffset === undefined) {
        reachedEnd = true;
        break;
      }
      if (page.nextOffset <= offset || page.records.length === 0) {
        limitations.push('Activity paging stopped because the next offset did not advance.');
        break;
      }
      offset = page.nextOffset;
    }

    if (!reachedEnd && pagesRead >= MAX_ACTIVITY_PAGES) {
      limitations.push(`Activity reading reached the ${MAX_ACTIVITY_PAGES}-page bound.`);
    }
    if (
      reachedEnd &&
      matchingActivityCount !== undefined &&
      processedActivityCount !== matchingActivityCount
    ) {
      limitations.push(
        'The activity page chain did not process exactly the reported matching activity total.',
      );
    }
    if (matchingActivityCount === undefined) {
      matchingActivityCount = 0;
      limitations.push(
        'The authoritative activity total could not be read; zero in the count fields means unavailable, not zero matching activity.',
      );
    }

    // Subjects with recorded changes come before subjects that were only viewed.
    const rankedSubjects = Array.from(subjects.values()).sort(
      (a, b) =>
        b.changeCount - a.changeCount ||
        b.activityCount - a.activityCount ||
        b.latest.timestamp.localeCompare(a.latest.timestamp),
    );
    const currentStates = new Map<string, CurrentStateDetail>();
    for (let start = 0; start < rankedSubjects.length; start += CONTEXT_BATCH_SIZE) {
      const chunk = rankedSubjects
        .slice(start, start + CONTEXT_BATCH_SIZE)
        .map((accumulator) => accumulator.subject);
      this.logger.debug('project_report.current_state_context.batch.started', {
        requestId: input.requestId,
        attemptId: input.attemptId,
        offset: start,
        subjectCount: chunk.length,
      });
      let batch: z.infer<typeof contextBatchSchema>;
      try {
        batch = await this.readContextBatch(input, chunk);
      } catch (error) {
        limitations.push(
          this.describeReadFailure(
            `Current-state detail for ${String(chunk.length)} of ${String(rankedSubjects.length)} included subjects`,
            0,
            error,
          ),
        );
        this.logger.warn('project_report.current_state_context.batch.failed', {
          requestId: input.requestId,
          attemptId: input.attemptId,
          offset: start,
          subjectCount: chunk.length,
          errorCode:
            error instanceof ProjectReportEvidenceRequestError ? error.code : 'REQUEST_FAILED',
          ...(error instanceof ProjectReportEvidenceRequestError && error.status !== undefined
            ? { status: error.status }
            : {}),
        });
        continue;
      }

      const chunkKeys = chunk.map((subject) => this.subjectKey(subject));
      const identityMatches =
        batch.requestId === input.requestId &&
        batch.attemptId === input.attemptId &&
        batch.items.length === chunk.length &&
        batch.items.every(
          ({ context }, index) =>
            context.requestId === input.requestId &&
            context.attemptId === input.attemptId &&
            this.subjectKey(context.subject) === chunkKeys[index],
        );
      if (!identityMatches) {
        this.logger.error('project_report.current_state_context.identity_mismatch', {
          requestId: input.requestId,
          attemptId: input.attemptId,
          offset: start,
          subjectCount: chunk.length,
          responseRequestId: batch.requestId,
          responseAttemptId: batch.attemptId,
          responseItemCount: batch.items.length,
        });
        throw new ProjectReportEvidenceReadContractError(
          'CONTEXT_IDENTITY_MISMATCH',
          'Current-state context response did not match its active request, attempt, and subjects',
        );
      }

      for (const { context, placement } of batch.items) {
        currentStates.set(this.subjectKey(context.subject), {
          title: context.title,
          ...(context.status !== undefined ? { status: context.status } : {}),
          placement: {
            ...(placement.plan ? { plan: placement.plan } : {}),
            features: placement.features,
          },
        });
      }
      this.logger.debug('project_report.current_state_context.batch.completed', {
        requestId: input.requestId,
        attemptId: input.attemptId,
        offset: start,
        subjectCount: chunk.length,
        queriedAt: batch.queriedAt,
      });
    }

    const evidenceReadCompletedAt = new Date().toISOString();
    const { subjects: subjectDigests, evidenceReferences } = this.buildSubjectDigests(
      rankedSubjects,
      currentStates,
    );
    const coverage: ProjectReportCoverage = {
      status:
        limitations.length === 0 && reachedEnd
          ? ProjectReportCoverageStatusEnum.Complete
          : ProjectReportCoverageStatusEnum.Incomplete,
      matchingActivityCount,
      processedActivityCount,
      pagesRead,
      limitations,
    };

    this.logger.info('project_report.evidence.read.completed', {
      requestId: input.requestId,
      attemptId: input.attemptId,
      pagesRead: coverage.pagesRead,
      matchingActivityCount: coverage.matchingActivityCount,
      processedActivityCount: coverage.processedActivityCount,
      currentStateContextsRead: currentStates.size,
      primarySubjects: rankedSubjects.length,
      coverageStatus: coverage.status,
      limitationCount: limitations.length,
    });

    return {
      subjects: subjectDigests,
      evidenceReferences,
      evidenceReadStartedAt,
      evidenceReadCompletedAt,
      coverage,
    };
  }

  private async readActivityPage(
    input: ProjectReportEvidenceReadInput,
    offset: number,
  ): Promise<z.infer<typeof activityPageSchema>> {
    const operation = await ProjectReportsApiAxiosParamCreator().getProjectReportActivityPage(
      input.organizationId,
      input.projectId,
      input.requestId,
      input.attemptId,
      ACTIVITY_PAGE_SIZE,
      offset,
    );
    return this.requestJson(
      operation.url,
      input,
      (value) => activityPageResponseSchema.safeParse(value),
      'Project report activity page',
    );
  }

  private async readContextBatch(
    input: ProjectReportEvidenceReadInput,
    subjects: ProjectReportSubject[],
  ): Promise<z.infer<typeof contextBatchSchema>> {
    const body = { attemptId: input.attemptId, subjects };
    const operation = await ProjectReportsApiAxiosParamCreator().batchReadProjectReportContext(
      input.organizationId,
      input.projectId,
      input.requestId,
      input.agentSessionId,
      body,
    );
    return this.requestJson(
      operation.url,
      input,
      (value) => contextBatchResponseSchema.safeParse(value),
      'Project report current-state context batch',
      body,
    );
  }

  private async requestJson<T>(
    path: string,
    input: ProjectReportEvidenceReadInput,
    parse: (value: unknown) => SafeParseResult<T>,
    description: string,
    body?: unknown,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.requestJsonOnce(path, input, parse, description, body);
      } catch (error) {
        const transient =
          error instanceof ProjectReportEvidenceRequestError &&
          (error.code === 'NETWORK_ERROR' ||
            (error.status !== undefined && error.status >= 500 && error.status < 600));
        if (!transient || attempt >= 3) throw error;
        const delayMs = 250 * attempt;
        this.logger.debug('project_report.evidence.read.retry', {
          requestId: input.requestId,
          attemptId: input.attemptId,
          description,
          attempt,
          delayMs,
          errorCode: error.code,
          status: error.status,
        });
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  private async requestJsonOnce<T>(
    path: string,
    input: ProjectReportEvidenceReadInput,
    parse: (value: unknown) => SafeParseResult<T>,
    description: string,
    body: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl.replace(/\/+$/u, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/json',
        'X-Organization-ID': input.organizationId,
        'X-Project-ID': input.projectId,
        'X-Agent-Session-ID': input.agentSessionId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }).catch(() => {
      throw new ProjectReportEvidenceRequestError(
        'NETWORK_ERROR',
        `${description} network read failed`,
      );
    });
    if (!response.ok) {
      throw new ProjectReportEvidenceRequestError(
        'HTTP_ERROR',
        `${description} returned HTTP ${response.status}`,
        response.status,
      );
    }
    const responseText = await response.text().catch(() => {
      throw new ProjectReportEvidenceRequestError(
        'NETWORK_ERROR',
        `${description} response read failed`,
      );
    });
    let responseValue: unknown;
    try {
      responseValue = JSON.parse(responseText);
    } catch {
      throw new ProjectReportEvidenceRequestError(
        'INVALID_JSON',
        `${description} response was not valid JSON`,
      );
    }
    const parsed = parse(responseValue);
    if (!parsed.success) {
      throw new ProjectReportEvidenceRequestError(
        'INVALID_RESPONSE',
        `${description} response did not match its generated contract`,
      );
    }
    return parsed.data;
  }

  private accumulate(
    subjects: Map<string, SubjectAccumulator>,
    subject: ProjectReportSubject,
    record: ProjectReportActivityEvidence,
  ): void {
    const subjectKey = this.subjectKey(subject);
    const accumulator = subjects.get(subjectKey) ?? {
      subject,
      latest: record,
      activityCount: 0,
      changeCount: 0,
      activity: new Map<string, ProjectReportSubjectActivity>(),
    };
    accumulator.activityCount += 1;
    if (record.type !== ActivityCorrelationActivityType.Viewed) accumulator.changeCount += 1;
    if (record.timestamp > accumulator.latest.timestamp) accumulator.latest = record;

    const activityKey = `${record.type}\u0000${record.source}`;
    const activity = accumulator.activity.get(activityKey);
    if (activity) {
      activity.count += 1;
      if (record.timestamp < activity.firstOccurredAt) activity.firstOccurredAt = record.timestamp;
      if (record.timestamp > activity.lastOccurredAt) activity.lastOccurredAt = record.timestamp;
    } else {
      accumulator.activity.set(activityKey, {
        activityType: record.type,
        source: record.source,
        count: 1,
        firstOccurredAt: record.timestamp,
        lastOccurredAt: record.timestamp,
      });
    }
    subjects.set(subjectKey, accumulator);
  }

  private buildSubjectDigests(
    subjects: readonly SubjectAccumulator[],
    currentStates: ReadonlyMap<string, CurrentStateDetail>,
  ): {
    subjects: ProjectReportSubjectDigest[];
    evidenceReferences: ProjectReportEvidenceReference[];
  } {
    const activityReferences: ProjectReportEvidenceReference[] = [];
    const contextReferences: ProjectReportEvidenceReference[] = [];
    const digests = subjects.map((accumulator, index) => {
      const latestActivityEvidenceKey = `selected-period-${index + 1}`;
      activityReferences.push({
        key: latestActivityEvidenceKey,
        subject: accumulator.subject,
        title: accumulator.latest.title,
        kind: ProjectReportEvidenceReferenceKindEnum.SelectedPeriod,
        occurredAt: accumulator.latest.timestamp,
        source: accumulator.latest.source,
      });
      const currentState = currentStates.get(this.subjectKey(accumulator.subject));
      let currentStateEvidenceKey: string | undefined;
      if (currentState) {
        currentStateEvidenceKey = `current-state-${accumulator.subject.entityType}-${accumulator.subject.entityId}`;
        contextReferences.push({
          key: currentStateEvidenceKey,
          subject: accumulator.subject,
          title: currentState.title,
          kind: ProjectReportEvidenceReferenceKindEnum.CurrentStateContext,
        });
      }
      return {
        subject: accumulator.subject,
        title: currentState?.title ?? accumulator.latest.title,
        ...(currentState?.status !== undefined ? { currentStatus: currentState.status } : {}),
        activity: Array.from(accumulator.activity.values()),
        latestActivityEvidenceKey,
        ...(currentStateEvidenceKey ? { currentStateEvidenceKey } : {}),
        ...(currentState ? { placement: currentState.placement } : {}),
      } satisfies ProjectReportSubjectDigest;
    });
    return {
      subjects: digests,
      evidenceReferences: [...activityReferences, ...contextReferences],
    };
  }

  private subjectKey(subject: ProjectReportSubject): string {
    return `${subject.entityType}:${subject.entityId}`;
  }

  private describeReadFailure(action: string, offset: number, error: unknown): string {
    const location = offset > 0 ? ` at offset ${offset}` : '';
    const status =
      error instanceof ProjectReportEvidenceRequestError && error.status !== undefined
        ? ` (HTTP ${error.status})`
        : '';
    return `${action}${location} could not be read${status}; coverage is incomplete.`;
  }
}

import { BadRequestException } from '@nestjs/common';
import { ReportService } from '../report.service';

const ORG = 'org-1' as never;
const PROJECT = 'project-1';
const EVAL_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '99999999-9999-4999-8999-999999999999';

const runPayload = {
  reportType: 'EVAL_RUN',
  summary: 'run',
  evalId: EVAL_ID,
  status: 'QUEUED',
  judgeSetup: { provider: 'claude', model: 'sonnet' },
  cases: [],
  configurations: [],
  settings: { maxConcurrentAttempts: 3 },
  coordinatorAgentSessionId: null,
  coordinatorConversationId: null,
};
const attemptPayload = {
  reportType: 'EVAL_ATTEMPT',
  summary: 'attempt',
  caseInputId: 'case-input-1',
  configuration: { id: 'c', target: { provider: 'claude', model: 'opus' } },
  status: 'QUEUED',
  measurements: [],
};

function row(id: string, reportType: string, payload: object, parent?: string) {
  const now = new Date();
  return {
    id,
    organizationId: 'org-1',
    projectId: PROJECT,
    reportType,
    audience: 'PROJECT_VISIBLE',
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: null,
    parentReportId: parent ?? null,
    createdAt: now,
    expiresAt: null,
    reportEntities: [],
  };
}

function build() {
  const tx = {
    report: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  const publisher = { publishInTransaction: jest.fn() };
  const service = new ReportService(
    { db: {} } as never,
    publisher as never,
    { resolveEntityNames: jest.fn().mockResolvedValue(new Map()) } as never,
  );
  return { service, tx, publisher };
}

type PublishedEvent = { type: string };
const publishedTypes = (publisher: {
  publishInTransaction: jest.Mock;
}): string[] =>
  publisher.publishInTransaction.mock.calls.map(
    (call: unknown[]) => (call[1] as PublishedEvent).type,
  );

const base = { audience: 'PROJECT_VISIBLE', projectId: PROJECT };

describe('eval run-record reports', () => {
  it('stores a never-expiring report without an expiry and announces a run update', async () => {
    const { service, tx, publisher } = build();
    tx.report.create.mockResolvedValue(row(RUN_ID, 'EVAL_RUN', runPayload));

    const created = await service.createWithIdInTransaction(
      tx as never,
      ORG,
      RUN_ID,
      {
        ...base,
        neverExpires: true,
        reportType: 'EVAL_RUN',
        payload: runPayload,
      } as never,
    );

    expect(tx.report.create.mock.calls[0][0].data).toMatchObject({
      id: RUN_ID,
      expiresAt: null,
    });
    expect(created.expiresAt).toBeNull();
    expect(publishedTypes(publisher)).toEqual([
      'report.created',
      'eval_run.updated',
    ]);
    expect(publisher.publishInTransaction.mock.calls[1][1]).toMatchObject({
      aggregateId: RUN_ID,
      payload: { evalId: EVAL_ID },
    });
  });

  it('announces an attempt update carrying its run and Eval', async () => {
    const { service, tx, publisher } = build();
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    tx.report.create.mockResolvedValue(
      row(attemptId, 'EVAL_ATTEMPT', attemptPayload, RUN_ID),
    );
    tx.report.findUnique.mockResolvedValue({ payload: runPayload });

    await service.createWithIdInTransaction(tx as never, ORG, attemptId, {
      ...base,
      neverExpires: true,
      parentReportId: RUN_ID,
      reportType: 'EVAL_ATTEMPT',
      payload: attemptPayload,
    } as never);

    const attemptEvent = publisher.publishInTransaction.mock.calls[1][1];
    expect(attemptEvent.type).toBe('eval_attempt.updated');
    expect(attemptEvent.payload).toMatchObject({
      evalId: EVAL_ID,
      evalRunId: RUN_ID,
    });
  });

  it('publishes nothing eval-specific for other report types', async () => {
    const { service, tx, publisher } = build();
    tx.report.create.mockResolvedValue(
      row(RUN_ID, 'SNAPSHOT', { reportType: 'SNAPSHOT', summary: 's' }),
    );
    await service.createWithIdInTransaction(tx as never, ORG, RUN_ID, {
      ...base,
      reportType: 'SNAPSHOT',
      payload: { reportType: 'SNAPSHOT', summary: 's' },
    } as never);
    expect(publishedTypes(publisher)).toEqual(['report.created']);
  });

  it('rejects neverExpires on a report type outside eval run records', async () => {
    const { service, tx } = build();
    await expect(
      service.createWithIdInTransaction(tx as never, ORG, RUN_ID, {
        ...base,
        neverExpires: true,
        reportType: 'SNAPSHOT',
        payload: { reportType: 'SNAPSHOT', summary: 's' },
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.report.create).not.toHaveBeenCalled();
  });

  it('rejects neverExpires combined with an explicit expiry', async () => {
    const { service, tx } = build();
    await expect(
      service.createWithIdInTransaction(tx as never, ORG, RUN_ID, {
        ...base,
        neverExpires: true,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        reportType: 'EVAL_RUN',
        payload: runPayload,
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.report.create).not.toHaveBeenCalled();
  });
});

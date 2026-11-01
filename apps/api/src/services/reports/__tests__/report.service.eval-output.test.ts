import { writeFileSync } from 'node:fs';
import { EventContextManager } from '../../../core/events/observable-event.context';
import { EvalOutputAdmissionService } from '../../eval/eval-output-admission.service';
import { ReportService } from '../report.service';

const ORG = '11111111-1111-4111-8111-111111111111' as never;
const PROJECT = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '77777777-7777-4777-8777-777777777777';
const REPORT_ID = '88888888-8888-4888-8888-888888888888';

const payload = { reportType: 'SNAPSHOT', summary: 'Eval attempt output.' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    organizationId: ORG,
    projectId: PROJECT,
    reportType: 'SNAPSHOT',
    audience: 'PROJECT_VISIBLE',
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: null,
    parentReportId: null,
    ragEnabled: true,
    createdAt: new Date('2026-10-20T00:00:00Z'),
    expiresAt: null,
    reportEntities: [],
    ...overrides,
  };
}

const writingAs = <T>(agentSessionId: string, fn: () => Promise<T>) =>
  EventContextManager.getInstance().runWithContext(
    EventContextManager.getInstance().createInitialContext('test', 'test', {
      agentSessionId,
    }),
    fn,
  );

function build(attemptRunning = true) {
  const tx = {
    report: {
      create: jest.fn(),
      findFirst: jest
        .fn()
        .mockResolvedValue(attemptRunning ? { id: 'attempt-report-id' } : null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const db = {
    report: tx.report,
    $transaction: jest.fn((callback: (client: unknown) => unknown) =>
      callback(tx),
    ),
  };
  const publisher = { publishInTransaction: jest.fn() };
  const service = new ReportService(
    { db } as never,
    publisher as never,
    { resolveEntityNames: jest.fn().mockResolvedValue(new Map()) } as never,
    undefined,
    undefined,
    undefined,
    new EvalOutputAdmissionService(),
  );
  return { service, tx, publisher };
}

const dto = {
  reportType: 'SNAPSHOT',
  audience: 'PROJECT_VISIBLE',
  projectId: PROJECT,
  payload,
};

const createdEvent = (publisher: { publishInTransaction: jest.Mock }) =>
  publisher.publishInTransaction.mock.calls
    .map((call: unknown[]) => call[1] as { type: string; payload: unknown })
    .find((event) => event.type === 'report.created');

describe('ReportService eval attempt output', () => {
  it('persists supplied exclusion and publishes shouldProcess false without looking up attempts', async () => {
    const { service, tx, publisher } = build();
    tx.report.create.mockResolvedValue(row({ ragEnabled: false }));

    const created = await writingAs(SESSION_ID, () =>
      service.create(ORG, { ...dto, ragEnabled: false } as never),
    );

    expect(tx.report.create.mock.calls[0][0].data).toMatchObject({
      ragEnabled: false,
    });
    expect(tx.report.create.mock.calls[0][0].data).not.toHaveProperty(
      'evalAttemptId',
    );
    expect(created).toMatchObject({ ragEnabled: false });
    expect(tx.report.findFirst).not.toHaveBeenCalled();
    expect(createdEvent(publisher)?.payload).toMatchObject({
      shouldProcess: false,
    });
    const capturePath = process.env.HEY_HEY_EVAL_EVENT_CAPTURE;
    if (capturePath) {
      writeFileSync(
        capturePath,
        JSON.stringify({
          event: {
            id: '33333333-3333-4333-8333-333333333333',
            ...createdEvent(publisher),
          },
          timestamp: '2026-10-28T00:00:00.000Z',
        }),
      );
    }
    tx.report.findFirst.mockResolvedValue(row({ ragEnabled: false }));
    expect(await service.findOne(ORG, REPORT_ID)).toMatchObject({
      ragEnabled: false,
      payload,
    });
  });

  it('keeps an ordinary report ingesting', async () => {
    const { service, tx, publisher } = build();
    tx.report.create.mockResolvedValue(row());

    await service.create(ORG, dto as never);

    expect(tx.report.create.mock.calls[0][0].data).toMatchObject({
      ragEnabled: true,
    });
    expect(tx.report.findFirst).not.toHaveBeenCalled();
    expect(createdEvent(publisher)?.payload).toMatchObject({
      shouldProcess: true,
    });
  });

  it('stores a report ordinarily when no in-flight attempt names the writing session', async () => {
    const { service, tx, publisher } = build(false);
    tx.report.create.mockResolvedValue(row());

    await writingAs(SESSION_ID, () => service.create(ORG, dto as never));

    expect(tx.report.create.mock.calls[0][0].data).toMatchObject({
      ragEnabled: true,
    });
    expect(createdEvent(publisher)?.payload).toMatchObject({
      shouldProcess: true,
    });
  });

  it('keeps run records ordinary when they are created inside a caller transaction', async () => {
    const { service, tx, publisher } = build();
    tx.report.create.mockResolvedValue(row({ reportType: 'EVAL_RUN' }));

    await service.createWithIdInTransaction(tx as never, ORG, REPORT_ID, {
      ...dto,
      reportType: 'EVAL_RUN',
      neverExpires: true,
    } as never);

    expect(tx.report.create.mock.calls[0][0].data).toMatchObject({
      ragEnabled: true,
    });
    expect(createdEvent(publisher)?.payload).toMatchObject({
      shouldProcess: true,
    });
  });

  it('lists every report by default and filters on ragEnabled only when asked', async () => {
    const { service, tx } = build();

    await service.findAll(ORG, {});
    await service.findAll(ORG, { ragEnabled: true });
    await service.findAll(ORG, { ragEnabled: false });

    const wheres = tx.report.findMany.mock.calls.map(
      (call: unknown[]) => (call[0] as { where: object }).where,
    );
    expect(wheres[0]).not.toHaveProperty('ragEnabled');
    expect(wheres[1]).toMatchObject({ ragEnabled: true });
    expect(wheres[2]).toMatchObject({ ragEnabled: false });
  });
});

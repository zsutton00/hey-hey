import {
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionStatusChangedEvent,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProjectReportRequestService } from '../project-report-request.service';
import { ProjectReportSessionOutcomeListener } from '../project-report-session-outcome.listener';

describe('ProjectReportSessionOutcomeListener', () => {
  const prisma = { db: { projectReportAttempt: { findUnique: jest.fn() } } };
  const requests = { fail: jest.fn() };
  const listener = new ProjectReportSessionOutcomeListener(
    prisma as unknown as PrismaService,
    requests as unknown as ProjectReportRequestService,
  );
  const event = {
    payload: {
      type: AgentSessionType.ProjectReport,
      newStatus: AgentSessionStatus.Errored,
      agentSession: { id: '11111111-1111-4111-8111-111111111111' },
    },
  } as AgentSessionStatusChangedEvent;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.db.projectReportAttempt.findUnique.mockResolvedValue({
      requestId: 'request',
      id: 'attempt',
      reportId: null,
      status: 'RUNNING',
    });
  });

  it('marks an errored source execution failed without attaching a report', async () => {
    await listener.handle(event);
    expect(requests.fail).toHaveBeenCalledWith(
      'request',
      'attempt',
      expect.objectContaining({
        stage: 'GENERATION',
        retryable: true,
      }),
    );
  });

  it('does not override a completed attempt or another session family', async () => {
    prisma.db.projectReportAttempt.findUnique.mockResolvedValue({
      requestId: 'request',
      id: 'attempt',
      reportId: 'report',
      status: 'COMPLETED',
    });
    await listener.handle(event);
    await listener.handle({
      ...event,
      payload: { ...event.payload, type: AgentSessionType.Coding },
    });
    expect(requests.fail).not.toHaveBeenCalled();
  });
});

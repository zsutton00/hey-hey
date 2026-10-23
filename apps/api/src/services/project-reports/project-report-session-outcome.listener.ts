import { Injectable } from '@nestjs/common';
import {
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionStatusChangedEvent,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProjectReportRequestService } from './project-report-request.service';

@Injectable()
export class ProjectReportSessionOutcomeListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: ProjectReportRequestService,
  ) {}

  async handle(event: AgentSessionStatusChangedEvent): Promise<void> {
    if (
      event.payload.type !== AgentSessionType.ProjectReport ||
      (event.payload.newStatus !== AgentSessionStatus.Errored &&
        event.payload.newStatus !== AgentSessionStatus.Completed)
    )
      return;

    const attempt = await this.prisma.db.projectReportAttempt.findUnique({
      where: { agentSessionId: event.payload.agentSession.id },
    });
    if (!attempt || attempt.reportId || attempt.status !== 'RUNNING') return;
    const failedGeneration =
      event.payload.newStatus === AgentSessionStatus.Errored;
    await this.requests.fail(attempt.requestId, attempt.id, {
      stage: failedGeneration ? 'GENERATION' : 'SUBMISSION',
      code: failedGeneration ? 'AGENT_SESSION_FAILED' : 'REPORT_NOT_SUBMITTED',
      message: failedGeneration
        ? 'The report agent ended with an error'
        : 'The report agent completed without a persisted report',
      retryable: true,
    });
  }
}

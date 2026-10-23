import { Injectable } from '@nestjs/common';
import { Client } from '@temporalio/client';
import { InjectTemporalClient } from '../../prisma/temporal.module';
import { ConversationId, UserId, WorkflowId } from '../../types';

const STATUS_BY_CODE: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'RUNNING',
  2: 'COMPLETED',
  3: 'FAILED',
  4: 'CANCELLED',
  5: 'TERMINATED',
  6: 'CONTINUED_AS_NEW',
  7: 'TIMED_OUT',
};

export type WorkflowExecutionSummary = {
  workflowId: WorkflowId;
  runId: string;
  workflowType: string;
  status: string;
  startTime: string;
  closeTime: string | null;
};

export type ListUserWorkflowsResult = {
  workflows: WorkflowExecutionSummary[];
  nextPageToken: string | null;
};

export type ListUserWorkflowsInput = {
  userId: UserId;
  workflowType?: string;
  sourceConversationId?: ConversationId;
  pageSize: number;
  nextPageToken?: string;
};

@Injectable()
export class WorkflowVisibilityService {
  constructor(
    @InjectTemporalClient() private readonly temporalClient: Client,
  ) {}

  async listUserWorkflows(
    input: ListUserWorkflowsInput,
  ): Promise<ListUserWorkflowsResult> {
    const query = this.buildQuery(input);
    const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
    const pageToken = input.nextPageToken
      ? Buffer.from(input.nextPageToken, 'base64')
      : undefined;

    const response =
      await this.temporalClient.workflowService.listWorkflowExecutions({
        namespace,
        query,
        pageSize: input.pageSize,
        nextPageToken: pageToken,
      });

    const workflows = response.executions.map((execution) => {
      const workflowId = execution.execution?.workflowId;
      const runId = execution.execution?.runId;
      const workflowType = execution.type?.name;

      if (!workflowId || !runId || !workflowType) {
        throw new Error('Temporal workflow listing returned incomplete data');
      }

      return {
        workflowId: workflowId as WorkflowId,
        runId,
        workflowType,
        status: this.resolveStatus(execution.status),
        startTime: this.requireTimestamp(execution.startTime),
        closeTime: this.optionalTimestamp(execution.closeTime),
      };
    });

    const nextPageToken =
      response.nextPageToken && response.nextPageToken.length > 0
        ? Buffer.from(response.nextPageToken).toString('base64')
        : null;

    return { workflows, nextPageToken };
  }

  private buildQuery(input: ListUserWorkflowsInput): string {
    const filters = [`UserId = "${input.userId}"`];

    if (input.workflowType) {
      filters.push(`WorkflowType = "${input.workflowType}"`);
    }

    if (input.sourceConversationId) {
      filters.push(`SourceConversationID = "${input.sourceConversationId}"`);
    }

    return filters.join(' AND ');
  }

  private resolveStatus(status?: number | null): string {
    const resolved = STATUS_BY_CODE[status ?? 0];
    if (!resolved) {
      throw new Error(`Unknown workflow status code: ${status}`);
    }
    return resolved;
  }

  private requireTimestamp(
    timestamp?: { seconds?: unknown; nanos?: unknown } | null,
  ): string {
    if (!timestamp || timestamp.seconds == null) {
      throw new Error('Missing workflow start time in Temporal response');
    }

    return this.timestampToIso(timestamp);
  }

  private optionalTimestamp(
    timestamp?: { seconds?: unknown; nanos?: unknown } | null,
  ): string | null {
    if (!timestamp || timestamp.seconds == null) {
      return null;
    }

    return this.timestampToIso(timestamp);
  }

  private timestampToIso(timestamp: {
    seconds?: unknown;
    nanos?: unknown;
  }): string {
    const seconds = this.normalizeSeconds(timestamp.seconds);
    const nanos = Number(timestamp.nanos ?? 0);
    const millis = seconds * 1000 + Math.floor(nanos / 1_000_000);
    return new Date(millis).toISOString();
  }

  private normalizeSeconds(seconds: unknown): number {
    if (seconds == null) {
      return 0;
    }
    if (typeof seconds === 'number') {
      return seconds;
    }
    if (typeof seconds === 'string') {
      return Number(seconds);
    }
    if (this.isLongLike(seconds)) {
      return seconds.toNumber();
    }
    return Number(seconds);
  }

  private isLongLike(value: unknown): value is {
    toNumber: () => number;
  } {
    if (!value || typeof value !== 'object') {
      return false;
    }
    return typeof (value as { toNumber?: unknown }).toNumber === 'function';
  }
}

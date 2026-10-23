import { JobType, QueueName } from 'src/core/events/types/event.types';
import {
  AgentWorkflowJobData,
  LLMWorkflowJobData,
} from 'src/services/interfaces/job-enqueuer.interface';
import { ExecutionContext } from 'src/types/execution-context';
import { JobId, OrganizationId } from 'src/types';
import { FlowUserMessage } from 'src/types/flow-internal.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QueueJob<T = any> extends ExecutionContext {
  id: JobId;
  data: T;
  queueName: QueueName;
  priority?: number;
  delay?: number;
  attempts?: number;
  maxAttempts?: number;
  createdAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
}

export type LlmQueueJob = QueueJob<LLMWorkflowJobData> & {
  userMessage: FlowUserMessage;
};

export type AgentQueueJob = QueueJob<AgentWorkflowJobData> & {
  userMessage?: FlowUserMessage;
};

export interface QueueJobOptions extends ExecutionContext {
  priority?: number;
  delay?: number;
  maxAttempts?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface QueueProcessor<T = any> {
  (job: QueueJob<T>): Promise<void>;
}

export interface IQueueService {
  /**
   * Add a job to the queue
   */
  addJob<T>(
    queueName: string,
    jobType: JobType,
    data: T,
    options: QueueJobOptions,
  ): Promise<QueueJob<T>>;

  /**
   * Process jobs from a queue
   */
  addProcessor<T>(
    queueName: string,
    jobType: JobType,
    processor: QueueProcessor<T>,
  ): void;

  /**
   * Get queue statistics
   */
  getStats(
    queueName: string,
    organizationId: OrganizationId,
  ): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }>;

  /**
   * Get job by id
   */
  getJob(queueName: string, jobId: string): Promise<QueueJob>;

  /**
   * Get jobs by status
   */
  getJobs(
    queueName: string,
    organizationId: OrganizationId,
    status: 'waiting' | 'active' | 'completed' | 'failed',
    limit?: number,
  ): Promise<QueueJob[]>;

  /**
   * Retry a failed job
   */
  retryJob(queueName: string, jobId: string): Promise<void>;

  /**
   * Remove a job from the queue
   */
  removeJob(queueName: string, jobId: string): Promise<void>;

  /**
   * Clean up old jobs
   */
  cleanup(
    queueName: string,
    organizationId: OrganizationId,
    olderThan: Date,
  ): Promise<number>;
}

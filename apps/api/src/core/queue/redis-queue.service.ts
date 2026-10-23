import { Injectable, Logger, OnModuleDestroy, Inject } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import {
  IQueueService,
  QueueJob,
  QueueJobOptions,
  QueueProcessor,
} from './interfaces/queue.interface';
import { JobId, OrganizationId } from 'src/types';
import { ExecutionContext } from 'src/types/execution-context';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../events/tokens';
import {
  QueueName,
  JobType,
  JOB_STATUS,
  JOB_STATUS_TO_EVENT_TYPE,
} from '../events/types/event.types';
import { JobNonRetryableException } from 'src/common/exceptions/job-non-retryable.exception';
import { PayloadType } from 'src/generated';

interface RedisJob<T = unknown> extends ExecutionContext {
  id: JobId;
  queueName: QueueName;
  jobType: JobType;
  data: T;
  priority: number;
  delay: number;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  processedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  status: 'waiting' | 'active' | 'completed' | 'failed';
}

@Injectable()
export class RedisQueueService implements IQueueService, OnModuleDestroy {
  private readonly logger = new Logger(RedisQueueService.name);
  private get redis(): Redis {
    return this.redisService.getClient();
  }
  private readonly processors = new Map<string, QueueProcessor>();
  private readonly processingIntervals = new Map<string, NodeJS.Timeout>();

  constructor(
    private redisService: RedisService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private publisher: DomainEventPublisher,
  ) {
    this.logger.debug(
      'RedisQueueService initialized with centralized RedisService',
    );
  }

  async onModuleDestroy() {
    // Clean up intervals
    for (const interval of this.processingIntervals.values()) {
      clearInterval(interval);
    }

    // Redis connection is managed by RedisService
    this.logger.log('RedisQueueService cleanup complete');
  }

  async addJob<T>(
    queueName: QueueName,
    jobType: JobType,
    data: T,
    options: QueueJobOptions,
  ): Promise<QueueJob<T>> {
    const job: RedisJob<T> = {
      id: uuidv4() as JobId,
      queueName,
      jobType,
      data,
      ...options, // Spread all ExecutionContext properties
      priority: options.priority || 0,
      delay: options.delay || 0,
      attempts: 0,
      maxAttempts: options.maxAttempts || 3,
      createdAt: new Date().toISOString(),
      status: 'waiting',
    };

    const jobKey = this.getJobKey(queueName, job.id);
    const queueKey = this.getQueueKey(queueName, options.organizationId);
    const delayedQueueKey = this.getDelayedQueueKey(
      queueName,
      options.organizationId,
    );

    // Store job data
    await this.redis.set(jobKey, JSON.stringify(job), 'EX', 24 * 60 * 60); // 24 hour TTL

    if (job.delay > 0) {
      // Add to delayed queue with score as processing time
      const processAt = Date.now() + job.delay;
      await this.redis.zadd(delayedQueueKey, processAt, job.id);
    } else {
      // Add to regular queue with priority
      await this.redis.zadd(queueKey, -job.priority, job.id); // Negative for high priority first
    }

    this.logger.debug(
      `Added job ${job.id} to queue ${queueName} (org: ${options.organizationId})`,
    );

    return this.redisJobToQueueJob(job);
  }

  addProcessor<T>(
    queueName: string,
    jobType: JobType,
    processor: QueueProcessor<T>,
  ): void {
    const processorKey = `${queueName}:${jobType}`;
    this.processors.set(processorKey, processor);

    // Start processing loop if not already running
    if (!this.processingIntervals.has(processorKey)) {
      const interval = setInterval(() => {
        this.processNextJob(queueName, jobType, processor);
      }, 1000); // Check every second

      this.processingIntervals.set(processorKey, interval);
      this.logger.log(`Started processing ${queueName}:${jobType}`);
    }
  }

  private async processNextJob<T>(
    queueName: string,
    jobType: JobType,
    processor: QueueProcessor<T>,
  ): Promise<void> {
    try {
      // First, move any delayed jobs that are ready
      await this.processDelayedJobs(queueName);

      // Get all organizations that have jobs in this queue
      const orgKeys = await this.redis.keys(
        this.getQueueKey(queueName, '*' as OrganizationId),
      );

      for (const orgQueueKey of orgKeys) {
        // Extract organization ID from key
        const orgId = orgQueueKey.split(':').pop() as OrganizationId;
        if (!orgId) continue;

        // Get the next job with highest priority
        const jobIds = await this.redis.zrange(orgQueueKey, 0, 0);
        if (jobIds.length === 0) continue;

        const jobId = jobIds[0] as JobId;
        const jobKey = this.getJobKey(queueName, jobId);
        const jobData = await this.redis.get(jobKey);

        if (!jobData) {
          // Job data not found, remove from queue
          await this.redis.zrem(orgQueueKey, jobId);
          continue;
        }

        const job: RedisJob<T> = JSON.parse(jobData);

        // Check if this job matches the type we're processing
        if (job.jobType !== jobType) continue;

        // Remove from waiting queue and mark as active
        await this.redis.zrem(orgQueueKey, jobId);
        job.status = 'active';
        job.processedAt = new Date().toISOString();
        job.attempts++;

        await this.redis.set(jobKey, JSON.stringify(job), 'EX', 24 * 60 * 60);

        // Add to active jobs set
        const activeKey = this.getActiveKey(queueName, orgId);
        await this.redis.sadd(activeKey, jobId);

        try {
          // Process the job
          await processor(this.redisJobToQueueJob(job));

          // Job completed successfully
          job.status = 'completed';
          job.completedAt = new Date().toISOString();
          await this.redis.set(jobKey, JSON.stringify(job), 'EX', 24 * 60 * 60);

          // Remove from active and add to completed
          await this.redis.srem(activeKey, jobId);
          const completedKey = this.getCompletedKey(queueName, orgId);
          await this.redis.sadd(completedKey, jobId);

          // Publish job completed event
          await this.publisher.publish({
            type: JOB_STATUS_TO_EVENT_TYPE[JOB_STATUS.COMPLETED],
            aggregateId: jobId,
            payload: {
              payloadType: PayloadType.QueueJob,
              queueName: queueName as QueueName,
              jobType,
              projectId: job.projectId,
              conversationId: job.conversationId,
              workflowId: job.workflowId,
              userId: job.userId,
              messageId: job.messageId,
              userMessage: job.userMessage,
              nodeId: job.nodeId,
              organizationId: job.organizationId,
              status: JOB_STATUS.COMPLETED,
              error: undefined,
              id: jobId,
            },
          });

          this.logger.debug(
            `Completed job ${jobId} from ${queueName}:${jobType}`,
          );
        } catch (error) {
          this.logger.debug(`Job ${job.id} failed`, {
            message: (error as Error).message,
            name: (error as Error).name,
            stack: (error as Error).stack,
          });
          // Job failed
          job.error = (error as Error).message;
          job.failedAt = new Date().toISOString();

          // Check for non-retryable exceptions
          if (error instanceof JobNonRetryableException) {
            job.status = 'failed';
            await this.redis.set(
              jobKey,
              JSON.stringify(job),
              'EX',
              24 * 60 * 60,
            );

            // Remove from active and add to failed
            await this.redis.srem(activeKey, jobId);
            const failedKey = this.getFailedKey(queueName, orgId);
            await this.redis.sadd(failedKey, jobId);

            this.logger.error(
              `Job ${jobId} failed permanently (non-retryable): ${(error as Error).message}`,
            );
          } else if (job.attempts < job.maxAttempts) {
            // Retry the job
            job.status = 'waiting';
            delete job.processedAt;
            delete job.failedAt;
            delete job.error;

            await this.redis.set(
              jobKey,
              JSON.stringify(job),
              'EX',
              24 * 60 * 60,
            );
            await this.redis.srem(activeKey, jobId);

            // Add back to queue with exponential backoff delay
            const retryDelay = Math.min(
              1000 * Math.pow(2, job.attempts - 1),
              30000,
            );
            const retryAt = Date.now() + retryDelay;
            const delayedQueueKey = this.getDelayedQueueKey(queueName, orgId);
            await this.redis.zadd(delayedQueueKey, retryAt, jobId);

            this.logger.warn(
              `Retrying job ${jobId} (attempt ${job.attempts}/${job.maxAttempts})`,
            );
          } else {
            // Max attempts reached, mark as failed
            job.status = 'failed';
            await this.redis.set(
              jobKey,
              JSON.stringify(job),
              'EX',
              24 * 60 * 60,
            );

            // Remove from active and add to failed
            await this.redis.srem(activeKey, jobId);
            const failedKey = this.getFailedKey(queueName, orgId);
            await this.redis.sadd(failedKey, jobId);

            this.logger.error(
              `Job ${jobId} failed permanently: ${(error as Error).message}`,
            );
          }
        }

        // Process only one job per loop to prevent blocking
        break;
      }
    } catch (error) {
      this.logger.error(
        `Error processing queue ${queueName}:${jobType}:`,
        error,
      );
    }
  }

  private async processDelayedJobs(queueName: string): Promise<void> {
    const delayedKeys = await this.redis.keys(
      this.getDelayedQueueKey(queueName, '*' as OrganizationId),
    );

    for (const delayedKey of delayedKeys) {
      const orgId = delayedKey.split(':').pop() as OrganizationId;
      if (!orgId) continue;

      // Get jobs that are ready to process
      const now = Date.now();
      const readyJobs = await this.redis.zrangebyscore(delayedKey, 0, now);

      for (const jobId of readyJobs) {
        // Move from delayed to regular queue
        await this.redis.zrem(delayedKey, jobId);

        const jobKey = this.getJobKey(queueName, jobId);
        const jobData = await this.redis.get(jobKey);

        if (jobData) {
          const job: RedisJob<unknown> = JSON.parse(jobData);
          const queueKey = this.getQueueKey(queueName, orgId);
          await this.redis.zadd(queueKey, -job.priority, jobId);
        }
      }
    }
  }

  async getStats(
    queueName: string,
    organizationId: OrganizationId,
  ): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.redis.zcard(this.getQueueKey(queueName, organizationId)),
      this.redis.scard(this.getActiveKey(queueName, organizationId)),
      this.redis.scard(this.getCompletedKey(queueName, organizationId)),
      this.redis.scard(this.getFailedKey(queueName, organizationId)),
    ]);

    return { waiting, active, completed, failed };
  }

  async getJob(queueName: string, jobId: string): Promise<QueueJob> {
    const jobData = await this.redis.get(this.getJobKey(queueName, jobId));
    if (!jobData) {
      throw new Error(`Job ${jobId} not found`);
    }
    return this.redisJobToQueueJob(JSON.parse(jobData) as RedisJob<unknown>);
  }

  async getJobs(
    queueName: string,
    organizationId: OrganizationId,
    status: 'waiting' | 'active' | 'completed' | 'failed',
    limit = 10,
  ): Promise<QueueJob[]> {
    let jobIds: string[] = [];

    switch (status) {
      case 'waiting':
        jobIds = await this.redis.zrange(
          this.getQueueKey(queueName, organizationId),
          0,
          limit - 1,
        );
        break;
      case 'active':
        jobIds = await this.redis.smembers(
          this.getActiveKey(queueName, organizationId),
        );
        break;
      case 'completed':
        jobIds = await this.redis.smembers(
          this.getCompletedKey(queueName, organizationId),
        );
        break;
      case 'failed':
        jobIds = await this.redis.smembers(
          this.getFailedKey(queueName, organizationId),
        );
        break;
    }

    const jobs: QueueJob[] = [];
    for (const jobId of jobIds.slice(0, limit)) {
      const jobData = await this.redis.get(this.getJobKey(queueName, jobId));
      if (jobData) {
        const redisJob: RedisJob<unknown> = JSON.parse(jobData);
        jobs.push(this.redisJobToQueueJob(redisJob));
      }
    }

    return jobs;
  }

  async retryJob(queueName: string, jobId: string): Promise<void> {
    const jobKey = this.getJobKey(queueName, jobId);
    const jobData = await this.redis.get(jobKey);

    if (!jobData) {
      throw new Error(`Job ${jobId} not found`);
    }

    const job: RedisJob<unknown> = JSON.parse(jobData);

    // Reset job for retry
    job.status = 'waiting';
    job.attempts = 0;
    delete job.processedAt;
    delete job.completedAt;
    delete job.failedAt;
    delete job.error;

    await this.redis.set(jobKey, JSON.stringify(job), 'EX', 24 * 60 * 60);

    // Remove from failed set and add back to queue
    await this.redis.srem(
      this.getFailedKey(queueName, job.organizationId),
      jobId,
    );
    await this.redis.zadd(
      this.getQueueKey(queueName, job.organizationId),
      -job.priority,
      jobId,
    );

    this.logger.log(`Retrying job ${jobId} in queue ${queueName}`);
  }

  async removeJob(queueName: string, jobId: string): Promise<void> {
    const jobKey = this.getJobKey(queueName, jobId);
    const jobData = await this.redis.get(jobKey);

    if (!jobData) {
      return; // Job already removed
    }

    const job: RedisJob<unknown> = JSON.parse(jobData);

    // Remove from all possible locations
    await Promise.all([
      this.redis.zrem(this.getQueueKey(queueName, job.organizationId), jobId),
      this.redis.zrem(
        this.getDelayedQueueKey(queueName, job.organizationId),
        jobId,
      ),
      this.redis.srem(this.getActiveKey(queueName, job.organizationId), jobId),
      this.redis.srem(
        this.getCompletedKey(queueName, job.organizationId),
        jobId,
      ),
      this.redis.srem(this.getFailedKey(queueName, job.organizationId), jobId),
      this.redis.del(jobKey),
    ]);

    this.logger.log(`Removed job ${jobId} from queue ${queueName}`);
  }

  async cleanup(
    queueName: string,
    organizationId: OrganizationId,
    olderThan: Date,
  ): Promise<number> {
    const completedKey = this.getCompletedKey(queueName, organizationId);
    const failedKey = this.getFailedKey(queueName, organizationId);

    const [completedJobs, failedJobs] = await Promise.all([
      this.redis.smembers(completedKey),
      this.redis.smembers(failedKey),
    ]);

    let cleaned = 0;
    const cutoffTime = olderThan.getTime();

    // Clean completed jobs
    for (const jobId of completedJobs) {
      const jobData = await this.redis.get(this.getJobKey(queueName, jobId));
      if (jobData) {
        const job: RedisJob<unknown> = JSON.parse(jobData);
        const completedAt = job.completedAt
          ? new Date(job.completedAt).getTime()
          : 0;

        if (completedAt < cutoffTime) {
          await this.removeJob(queueName, jobId);
          cleaned++;
        }
      }
    }

    // Clean failed jobs
    for (const jobId of failedJobs) {
      const jobData = await this.redis.get(this.getJobKey(queueName, jobId));
      if (jobData) {
        const job: RedisJob<unknown> = JSON.parse(jobData);
        const failedAt = job.failedAt ? new Date(job.failedAt).getTime() : 0;

        if (failedAt < cutoffTime) {
          await this.removeJob(queueName, jobId);
          cleaned++;
        }
      }
    }

    this.logger.log(
      `Cleaned up ${cleaned} old jobs from ${queueName} (org: ${organizationId})`,
    );
    return cleaned;
  }

  // Helper methods for Redis key generation
  private getJobKey(queueName: string, jobId: string): string {
    return `queue:${queueName}:job:${jobId}`;
  }

  private getQueueKey(
    queueName: string,
    organizationId: OrganizationId,
  ): string {
    return `queue:${queueName}:waiting:${organizationId}`;
  }

  private getDelayedQueueKey(
    queueName: string,
    organizationId: OrganizationId,
  ): string {
    return `queue:${queueName}:delayed:${organizationId}`;
  }

  private getActiveKey(
    queueName: string,
    organizationId: OrganizationId,
  ): string {
    return `queue:${queueName}:active:${organizationId}`;
  }

  private getCompletedKey(
    queueName: string,
    organizationId: OrganizationId,
  ): string {
    return `queue:${queueName}:completed:${organizationId}`;
  }

  private getFailedKey(
    queueName: string,
    organizationId: OrganizationId,
  ): string {
    return `queue:${queueName}:failed:${organizationId}`;
  }

  private redisJobToQueueJob<T>(redisJob: RedisJob<T>): QueueJob<T> {
    return {
      ...redisJob, // This spreads all ExecutionContext properties and job properties
      createdAt: new Date(redisJob.createdAt),
      processedAt: redisJob.processedAt
        ? new Date(redisJob.processedAt)
        : undefined,
      completedAt: redisJob.completedAt
        ? new Date(redisJob.completedAt)
        : undefined,
      failedAt: redisJob.failedAt ? new Date(redisJob.failedAt) : undefined,
    };
  }
}

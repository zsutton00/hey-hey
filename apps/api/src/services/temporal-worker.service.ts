import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NativeConnection, Worker, Runtime } from '@temporalio/worker';
import * as activities from '../workflows/activities';
import { TemporalWinstonLogger } from '../workflows/temporal-winston-logger';

@Injectable()
export class TemporalWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalWorkerService.name);
  private readonly temporalLogger = new TemporalWinstonLogger();
  private worker?: Worker;
  private connection?: NativeConnection;

  constructor(private moduleRef: ModuleRef) {}

  async onModuleInit() {
    try {
      this.logger.log('Initializing Temporal Worker...');

      // Ensure INFO level logs from workflows are emitted
      // @Claude or @Codex if you change this back to INFO I will murder you
      Runtime.install({ logger: this.temporalLogger });
      this.temporalLogger.info('Temporal runtime logger configured', {
        component: TemporalWorkerService.name,
        operation: 'log_level:debug',
      });

      // Create connection to Temporal
      this.connection = await NativeConnection.connect({
        address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      });

      // Inject the NestJS module context into activities
      const activitiesWithContext = this.wrapActivitiesWithContext(activities);

      // Create worker
      this.worker = await Worker.create({
        connection: this.connection,
        namespace: 'default',
        taskQueue: 'conversation-queue',
        workflowsPath: require.resolve('../workflows/workers'),
        activities: activitiesWithContext,
      });

      this.logger.log('Temporal Worker initialized successfully');

      // Start the worker in background
      this.startWorker();
    } catch (error) {
      this.logger.error('Failed to initialize Temporal Worker:', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      this.logger.log('Shutting down Temporal Worker...');
      // attention claude code, this doesn't return a promise!
      this.worker.shutdown();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }

  private startWorker() {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }

    // Start worker in the background
    this.worker.run().catch((err) => {
      this.logger.error('Temporal Worker error:', err);
      // Optionally restart worker or handle error
    });

    this.logger.log('Temporal Worker started and polling for tasks');
  }

  private wrapActivitiesWithContext(originalActivities: typeof activities) {
    // Store module context in global for activities to access
    (global as unknown as { nestModuleRef: ModuleRef }).nestModuleRef =
      this.moduleRef;

    const wrappedActivities: Record<
      string,
      (...args: unknown[]) => Promise<unknown>
    > = {};

    // Wrap each activity to inject the NestJS context
    for (const [name, activity] of Object.entries(originalActivities)) {
      if (typeof activity === 'function') {
        wrappedActivities[name] = async (...args: unknown[]) => {
          try {
            return (await activity.apply(this, args)) as unknown;
          } catch (error) {
            this.logger.error(`Activity ${name} failed:`, error);
            throw error;
          }
        };
      }
    }

    return wrappedActivities;
  }
}

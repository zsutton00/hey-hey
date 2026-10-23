import { INestApplicationContext } from '@nestjs/common';
import './load-environment';
import { NestFactory } from '@nestjs/core';
import * as path from 'node:path';
import {
  LogLevel,
  NativeConnection,
  Runtime,
  Worker,
} from '@temporalio/worker';
import { WorkerAppModule } from './worker-app.module';
import * as activities from './workflows/activities';
import { TemporalWinstonLogger } from './workflows/temporal-winston-logger';

const temporalLogger = new TemporalWinstonLogger();

export async function startWorker(
  existingApp?: INestApplicationContext,
): Promise<Worker> {
  temporalLogger.info('Starting Temporal worker');

  const validLogLevels: LogLevel[] = [
    'TRACE',
    'DEBUG',
    'INFO',
    'WARN',
    'ERROR',
  ];
  const rawLevel = (process.env.LOG_LEVEL || 'DEBUG').toUpperCase();
  const temporalLogLevel: LogLevel = validLogLevels.includes(
    rawLevel as LogLevel,
  )
    ? (rawLevel as LogLevel)
    : 'DEBUG';
  Runtime.install({ logger: temporalLogger });
  temporalLogger.info('Temporal runtime logger configured', {
    component: 'WorkerStartup',
    operation: `log_level:${temporalLogLevel.toLowerCase()}`,
  });

  // Use existing app context or create new one
  const app =
    existingApp ||
    (await NestFactory.createApplicationContext(WorkerAppModule, {
      bufferLogs: true,
    }));

  temporalLogger.info('Instantiated worker application context');

  // Replace default logger with custom logger (same as main app)
  if (process.env.LOGGER !== 'nestjs') {
    try {
      const { CustomLoggerService } = await import(
        './common/logger/logger.service'
      );
      const customLogger = app.get(CustomLoggerService);
      app.useLogger(customLogger);
    } catch (error) {
      temporalLogger.warn('Failed to set up custom logger for worker', {
        error: error instanceof Error ? error : String(error),
      });
    }
  }

  // Expose the context globally for activities (getAppContextForWorker)
  (
    global as unknown as { nestModuleRef?: INestApplicationContext }
  ).nestModuleRef = app;

  // Debug: Verify TaskService is available in worker context
  try {
    const { TaskService } = await import('./services/tasks/task.service');
    const taskService = app.get(TaskService);
    temporalLogger.debug('TaskService resolved in worker context', {
      component: 'WorkerStartup',
      operation: taskService
        ? 'task_service_available'
        : 'task_service_missing',
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : typeof error;
    temporalLogger.error('Failed to resolve TaskService in worker context', {
      component: 'WorkerStartup',
      operation: `error_type:${errorType}`,
      error: error instanceof Error ? error : String(error),
    });
  }

  // Create connection to Temporal
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  // Create worker
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    taskQueue: 'conversation-queue',
    workflowsPath: require.resolve('./workflows/workers'),
    activities,
    bundlerOptions: {
      ignoreModules: [
        'stream',
        '@nestjs/common',
        '@nestjs/core',
        '@nestjs/axios',
        'reflect-metadata',
      ],
      webpackConfigHook: (config) => {
        if (!config) {
          return config;
        }

        config.module = config.module || {};
        config.module.exprContextCritical = false;
        // Temporal's workflow bundle is built by Webpack rather than the
        // TypeScript runtime, so it does not automatically honor tsconfig's
        // `src/*` path mapping. Keep the worker bundle aligned with the
        // application resolver used by ts-node and the compiled dist layout.
        config.resolve = config.resolve || {};
        const existingAliases = config.resolve.alias;
        config.resolve.alias = {
          ...(existingAliases && !Array.isArray(existingAliases)
            ? existingAliases
            : {}),
          src: path.resolve(__dirname),
        };
        // Exclude generated API services from workflow bundle
        config.externals = config.externals || [];
        if (Array.isArray(config.externals)) {
          config.externals.push(/generated\/api/);
          config.externals.push(/@nestjs\//); // Exclude all @nestjs packages
        }

        return config;
      },
    },
  });

  temporalLogger.info('Worker created and polling for tasks');

  // Start the worker (don't await - let it run in background)
  worker.run().catch((err) => {
    temporalLogger.error('Error running Temporal worker', {
      error: err instanceof Error ? err : String(err),
    });
  });

  return worker;
}

async function run() {
  await startWorker();
}

// Only run directly if this file is executed directly
if (require.main === module) {
  run().catch((err) => {
    temporalLogger.error('Error starting Temporal worker', {
      error: err instanceof Error ? err : String(err),
    });
    process.exit(1);
  });
}

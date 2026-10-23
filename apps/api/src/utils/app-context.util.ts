import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerAppModule } from '../worker-app.module';

let applicationContext: INestApplicationContext | null = null;
let initializingContext: Promise<INestApplicationContext> | null = null;

export async function getAppContextForWorker(): Promise<INestApplicationContext> {
  console.log('🔍 APP CONTEXT DEBUG: getAppContextForWorker called', {
    hasGlobalContext: !!(
      global as unknown as { nestModuleRef: INestApplicationContext }
    ).nestModuleRef,
    hasApplicationContext: !!applicationContext,
    isInitializing: initializingContext !== null,
  });

  // Try to use the global context first (when integrated with main app)
  if (
    (global as unknown as { nestModuleRef: INestApplicationContext })
      .nestModuleRef
  ) {
    const context = (
      global as unknown as { nestModuleRef: INestApplicationContext }
    ).nestModuleRef;
    console.log('✅ APP CONTEXT DEBUG: Using global context', {
      contextType: context.constructor.name,
    });
    return context;
  }

  // Fallback to creating separate context (for standalone worker)
  if (applicationContext) {
    return applicationContext;
  }

  if (initializingContext !== null) {
    return initializingContext;
  }

  // No context and none initializing – create one atomically
  initializingContext = NestFactory.createApplicationContext(WorkerAppModule)
    .then((ctx) => {
      applicationContext = ctx;
      return ctx;
    })
    .finally(() => {
      initializingContext = null;
    });

  return initializingContext;
}

// You might also want a shutdown helper
export async function closeAppContext(): Promise<void> {
  if (applicationContext) {
    await applicationContext.close();
    applicationContext = null;
  }
}

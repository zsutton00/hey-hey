import { Global, Module } from '@nestjs/common';
import { ContextAwareLogger } from './context-aware-logger.service';
import { CustomLoggerService } from '../../common/logger/logger.service';

/**
 * Global Logging Module
 *
 * Provides context-aware logging capabilities across the entire application.
 * This module is marked as @Global() so ContextAwareLogger can be injected
 * anywhere without importing the module.
 *
 * Usage in services:
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   private readonly logger = ContextAwareLogger.createServiceLogger('MyService', customLogger);
 *   // or inject via constructor:
 *   constructor(private logger: ContextAwareLogger) {
 *     this.logger.setContext('MyService');
 *   }
 * }
 * ```
 */
@Global()
@Module({
  providers: [
    {
      provide: ContextAwareLogger,
      useFactory: (customLogger: CustomLoggerService) => {
        // Default instance for dependency injection with Winston/Logstash support
        return new ContextAwareLogger('App', {}, customLogger);
      },
      inject: [CustomLoggerService],
    },
  ],
  exports: [ContextAwareLogger],
})
export class LoggingModule {}

import { Module, Global } from '@nestjs/common';
import { CustomLoggerService } from './logger.service';
import { ErrorFileWriter } from './error-file-writer.service';

@Global()
@Module({
  providers: [ErrorFileWriter, CustomLoggerService],
  exports: [CustomLoggerService, ErrorFileWriter],
})
export class LoggerModule {}

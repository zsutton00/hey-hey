import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ImplementationHintService } from './implementation-hint.service';
import { ServiceService } from './service.service';

@Module({
  imports: [PrismaModule, CoreModule],
  providers: [ServiceService, ImplementationHintService],
  exports: [ServiceService, ImplementationHintService],
})
export class ServiceModule {}

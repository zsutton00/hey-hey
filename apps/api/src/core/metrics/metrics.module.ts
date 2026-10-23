import { Global, Module } from '@nestjs/common';
import { ApiMetricsService } from './api-metrics.service';
import { MetricsController } from './metrics.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [MetricsController],
  providers: [ApiMetricsService],
  exports: [ApiMetricsService],
})
export class MetricsModule {}

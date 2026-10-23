import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { ApiMetricsService } from './api-metrics.service';

@Public()
@SkipTransform()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: ApiMetricsService) {}

  @Get()
  async scrape(@Res() response: Response): Promise<void> {
    response.setHeader('Content-Type', this.metrics.contentType);
    response.end(await this.metrics.metrics());
  }
}

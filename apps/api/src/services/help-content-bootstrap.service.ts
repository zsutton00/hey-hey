import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { seedHelpContent } from './help-content-seed';

@Injectable()
export class HelpContentBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HelpContentBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const summary = await seedHelpContent(this.prisma);

    this.logger.log('Help content reconciled', {
      nodes: summary.nodes,
      demos: summary.demos,
      changedNodeCount: summary.changedNodeIds.length,
      driftCount: summary.drift.length,
    });

    for (const drift of summary.drift) {
      this.logger.warn('Help source/database drift detected', drift);
    }
  }
}

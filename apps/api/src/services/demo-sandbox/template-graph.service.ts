import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtKeysService } from '../../auth/services/jwt-keys.service';
import { TemplateGraphService } from '../../generated/graphs/api/templateGraph.service';
import {
  TemplateGraphCopyCommand,
  TemplateGraphSnapshot,
} from '../../generated/graphs';

@Injectable()
export class DemoTemplateGraphService {
  private readonly logger = new Logger(DemoTemplateGraphService.name);
  private retryRunning = false;
  constructor(
    private readonly client: TemplateGraphService,
    private readonly keys: JwtKeysService,
    private readonly prisma: PrismaService,
  ) {}

  async snapshot(
    organizationId: string,
    projectId: string,
  ): Promise<TemplateGraphSnapshot> {
    const result = await firstValueFrom(
      this.client.exportTemplateGraph(organizationId, projectId, {
        config: {
          timeout: 10_000,
          headers: {
            Authorization: `Bearer ${this.keys.getTemplateGraphToken(organizationId, projectId)}`,
          },
        },
      }),
    );
    return result.data;
  }

  @Interval(5_000)
  async retryPending(): Promise<void> {
    if (this.retryRunning) return;
    this.retryRunning = true;
    try {
      await this.processPending();
    } finally {
      this.retryRunning = false;
    }
  }

  private async processPending(): Promise<void> {
    // Durable rows, destination FK cascades and a graph closure tombstone keep
    // retries safe during teardown. Duplicate workers send the same command ID.
    const intents = await this.prisma.demoGraphCopyIntent.findMany({
      where: { completedAt: null, nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    for (const intent of intents) {
      try {
        await firstValueFrom(
          this.client.applyTemplateGraphCopy(
            intent.organizationId,
            intent.projectId,
            intent.command as unknown as TemplateGraphCopyCommand,
            {
              config: {
                timeout: 10_000,
                headers: {
                  Authorization: `Bearer ${this.keys.getTemplateGraphToken(intent.organizationId, intent.projectId)}`,
                },
              },
            },
          ),
        );
        await this.prisma.demoGraphCopyIntent.updateMany({
          where: { id: intent.id, completedAt: null },
          data: { completedAt: new Date() },
        });
      } catch {
        await this.prisma.demoGraphCopyIntent.updateMany({
          where: { id: intent.id, completedAt: null },
          data: {
            attempts: { increment: 1 },
            nextAttemptAt: new Date(Date.now() + 30_000),
          },
        });
        this.logger.warn('Template graph copy remains pending', {
          projectId: intent.projectId,
        });
      }
    }
  }
}

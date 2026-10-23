import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DemoTemplateDto, SetDemoTemplateDto } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DemoTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async getActive(): Promise<DemoTemplateDto | null> {
    const template = await this.prisma.db.demoTemplate.findFirst({
      where: { active: true },
    });
    return template
      ? { ...template, createdAt: template.createdAt.toISOString() }
      : null;
  }

  async designate(input: SetDemoTemplateDto): Promise<DemoTemplateDto> {
    const repositoryUrl = input.repositoryUrl
      .replace(/\/$/, '')
      .replace(/\.git$/, '');
    await this.assertPublicRepository(repositoryUrl);

    return this.prisma.$transaction(async (tx) => {
      // Also serialize the initial designation, when there is no active row to lock.
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('demo-template-designation'))::text`,
      );
      const project = await tx.project.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('Template project not found');

      const current = await tx.demoTemplate.findFirst({
        where: { active: true },
      });
      if (
        current?.projectId === input.projectId &&
        current.repositoryUrl === repositoryUrl
      ) {
        return { ...current, createdAt: current.createdAt.toISOString() };
      }

      await tx.demoTemplate.updateMany({
        where: { active: true },
        data: { active: false },
      });
      const template = await tx.demoTemplate.create({
        data: { projectId: input.projectId, repositoryUrl, active: true },
      });
      return {
        ...template,
        createdAt: template.createdAt.toISOString(),
      } satisfies DemoTemplateDto;
    });
  }

  private async assertPublicRepository(repositoryUrl: string): Promise<void> {
    const repositoryPath = new URL(repositoryUrl).pathname;
    let response: Response;
    try {
      // GitHub only exposes public repositories to this unauthenticated request.
      response = await fetch(`https://api.github.com/repos${repositoryPath}`, {
        headers: { Accept: 'application/vnd.github+json' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Unable to verify public GitHub repository',
      );
    }
    await response.body?.cancel();
    if (response.status === 404) {
      throw new BadRequestException(
        'GitHub repository must exist and be public',
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        'Unable to verify public GitHub repository',
      );
    }
  }
}

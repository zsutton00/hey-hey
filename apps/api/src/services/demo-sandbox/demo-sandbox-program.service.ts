import { Injectable } from '@nestjs/common';
import { DemoSandboxStatus } from '@prisma/client';
import type { DemoSandboxProgramDto } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { DemoTemplateService } from './demo-template.service';
import { PROGRAM_STATE_ID } from './demo-sandbox.constants';

@Injectable()
export class DemoSandboxProgramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: DemoTemplateService,
  ) {}

  async get(): Promise<DemoSandboxProgramDto> {
    const state =
      await this.prisma.db.demoSandboxProgramState.findUniqueOrThrow({
        where: { id: PROGRAM_STATE_ID },
      });
    return {
      enabled: state.enabled,
      activeCap: state.activeCap,
      perIpLimit: state.perIpLimit,
      perIpWindowSeconds: state.perIpWindowSeconds,
    };
  }

  /** Offered only when switched on and there is a template to copy; otherwise a start would fail. */
  async isAvailable(): Promise<boolean> {
    const [program, template] = await Promise.all([
      this.get(),
      this.templates.getActive(),
    ]);
    return program.enabled && template !== null;
  }

  /** ACTIVE only; admission's capacity check also counts PROVISIONING reservations. */
  countActiveSandboxes(): Promise<number> {
    return this.prisma.db.demoSandbox.count({
      where: { status: DemoSandboxStatus.ACTIVE },
    });
  }

  async set(program: DemoSandboxProgramDto): Promise<DemoSandboxProgramDto> {
    const saved = await this.prisma.db.demoSandboxProgramState.update({
      where: { id: PROGRAM_STATE_ID },
      data: program,
    });
    return {
      enabled: saved.enabled,
      activeCap: saved.activeCap,
      perIpLimit: saved.perIpLimit,
      perIpWindowSeconds: saved.perIpWindowSeconds,
    };
  }
}

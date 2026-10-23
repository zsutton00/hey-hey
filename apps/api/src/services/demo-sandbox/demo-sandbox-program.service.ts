import { Injectable } from '@nestjs/common';
import { DemoSandboxStatus } from '@prisma/client';
import { getDeploymentEnvironment } from '../../deployment-environment';
import type { DemoSandboxProgramDto } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { PROGRAM_STATE_ID } from './demo-sandbox.constants';

/**
 * The one value that decides whether the demo exists in this deployment: it
 * both shows View demo (via the availability endpoint) and lets a start
 * through admission. On everywhere except production.
 */
export function isDemoSandboxEnabled(): boolean {
  return getDeploymentEnvironment() !== 'production';
}

@Injectable()
export class DemoSandboxProgramService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<DemoSandboxProgramDto> {
    const state =
      await this.prisma.db.demoSandboxProgramState.findUniqueOrThrow({
        where: { id: PROGRAM_STATE_ID },
      });
    return {
      activeCap: state.activeCap,
      perIpLimit: state.perIpLimit,
      perIpWindowSeconds: state.perIpWindowSeconds,
    };
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
      activeCap: saved.activeCap,
      perIpLimit: saved.perIpLimit,
      perIpWindowSeconds: saved.perIpWindowSeconds,
    };
  }
}

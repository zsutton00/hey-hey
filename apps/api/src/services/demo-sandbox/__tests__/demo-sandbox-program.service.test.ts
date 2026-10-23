import type { PrismaService } from '../../../prisma/prisma.service';
import { DemoSandboxProgramService } from '../demo-sandbox-program.service';
import { DemoTemplateService } from '../demo-template.service';
import { PROGRAM_STATE_ID } from '../demo-sandbox.constants';

describe('demo sandbox admin reads', () => {
  const db = {
    demoSandboxProgramState: { findUniqueOrThrow: jest.fn() },
    demoSandbox: { count: jest.fn() },
    demoTemplate: { findFirst: jest.fn() },
  };
  const prisma = { db } as unknown as PrismaService;
  const service = new DemoSandboxProgramService(
    prisma,
    new DemoTemplateService(prisma),
  );

  beforeEach(() => jest.resetAllMocks());

  it('reads the singleton program state', async () => {
    db.demoSandboxProgramState.findUniqueOrThrow.mockResolvedValue({
      id: PROGRAM_STATE_ID,
      enabled: true,
      activeCap: 5,
      perIpLimit: 1,
      perIpWindowSeconds: 600,
    });
    await expect(service.get()).resolves.toEqual({
      enabled: true,
      activeCap: 5,
      perIpLimit: 1,
      perIpWindowSeconds: 600,
    });
    expect(db.demoSandboxProgramState.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: PROGRAM_STATE_ID },
    });
  });

  it('counts only ACTIVE sandboxes', async () => {
    db.demoSandbox.count.mockResolvedValue(4);
    await expect(service.countActiveSandboxes()).resolves.toBe(4);
    expect(db.demoSandbox.count).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
    });
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
  ])(
    'offers the demo only when switched on and a template exists (enabled=%s, template=%s)',
    async (enabled, hasTemplate, expected) => {
      db.demoSandboxProgramState.findUniqueOrThrow.mockResolvedValue({
        id: PROGRAM_STATE_ID,
        enabled,
        activeCap: 5,
        perIpLimit: 1,
        perIpWindowSeconds: 600,
      });
      db.demoTemplate.findFirst.mockResolvedValue(
        hasTemplate
          ? {
              id: 't',
              projectId: 'p',
              repositoryUrl: 'https://github.com/example/template',
              active: true,
              createdAt: new Date('2026-10-16T00:00:00Z'),
            }
          : null,
      );
      await expect(service.isAvailable()).resolves.toBe(expected);
    },
  );

  it('returns the active template or null', async () => {
    const createdAt = new Date('2026-10-16T00:00:00Z');
    db.demoTemplate.findFirst.mockResolvedValueOnce({
      id: 't',
      projectId: 'p',
      repositoryUrl: 'https://github.com/example/template',
      active: true,
      createdAt,
    });
    const service = new DemoTemplateService(prisma);
    await expect(service.getActive()).resolves.toMatchObject({
      createdAt: createdAt.toISOString(),
    });
    db.demoTemplate.findFirst.mockResolvedValueOnce(null);
    await expect(service.getActive()).resolves.toBeNull();
    expect(db.demoTemplate.findFirst).toHaveBeenCalledWith({
      where: { active: true },
    });
  });
});

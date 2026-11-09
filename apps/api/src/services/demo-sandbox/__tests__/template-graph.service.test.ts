import { randomUUID } from 'crypto';
import { of, throwError } from 'rxjs';
import { DemoTemplateGraphService } from '../template-graph.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtKeysService } from '../../../auth/services/jwt-keys.service';
import { TemplateGraphService } from '../../../generated/graphs/api/templateGraph.service';
import { TemplateGraphCopyCommand } from '../../../generated/graphs';
import { createPersistedGraphCopyIntent } from '../template-graph-copy-intent';

describe('DemoTemplateGraphService durable retry', () => {
  it('retains failed work and acknowledges the same command after a worker restart', async () => {
    const command: TemplateGraphCopyCommand = {
      id: randomUUID(),
      snapshot: { nodes: [], edges: [] },
    };
    const intent = {
      id: command.id,
      organizationId: randomUUID(),
      projectId: randomUUID(),
      command,
    };
    const prisma = {
      demoGraphCopyIntent: {
        findMany: jest.fn().mockResolvedValue([intent]),
        updateMany: jest.fn(),
      },
    };
    const client = {
      applyTemplateGraphCopy: jest
        .fn()
        .mockReturnValueOnce(throwError(() => new Error('not projected yet')))
        .mockReturnValueOnce(of({ status: 204 })),
    };
    const keys = {
      getTemplateGraphToken: jest.fn().mockReturnValue('test-credential'),
    };
    const create = () =>
      new DemoTemplateGraphService(
        client as unknown as TemplateGraphService,
        keys as unknown as JwtKeysService,
        prisma as unknown as PrismaService,
      );
    await create().retryPending();
    expect(prisma.demoGraphCopyIntent.updateMany).toHaveBeenLastCalledWith({
      where: { id: intent.id, completedAt: null },
      data: { attempts: { increment: 1 }, nextAttemptAt: expect.any(Date) },
    });
    await create().retryPending();
    expect(client.applyTemplateGraphCopy).toHaveBeenNthCalledWith(
      2,
      intent.organizationId,
      intent.projectId,
      command,
      expect.objectContaining({
        config: expect.objectContaining({
          headers: { Authorization: 'Bearer test-credential' },
        }),
      }),
    );
    expect(prisma.demoGraphCopyIntent.updateMany).toHaveBeenLastCalledWith({
      where: { id: intent.id, completedAt: null },
      data: { completedAt: expect.any(Date) },
    });
  });

  it('sends only the graph command from a persisted readiness envelope', async () => {
    const graphCommand: TemplateGraphCopyCommand = {
      id: randomUUID(),
      snapshot: { nodes: [], edges: [] },
    };
    const readinessWorkItems = [
      {
        id: randomUUID(),
        typeKey: 'FEATURE',
        parentTaskId: null,
      },
    ];
    const intent = {
      id: graphCommand.id,
      organizationId: randomUUID(),
      projectId: randomUUID(),
      command: createPersistedGraphCopyIntent(
        graphCommand,
        readinessWorkItems,
        [],
      ),
    };
    const prisma = {
      demoGraphCopyIntent: {
        findMany: jest.fn().mockResolvedValue([intent]),
        updateMany: jest.fn(),
      },
    };
    const client = {
      applyTemplateGraphCopy: jest.fn().mockReturnValue(of({ status: 204 })),
    };
    const keys = { getTemplateGraphToken: jest.fn().mockReturnValue('token') };
    const service = new DemoTemplateGraphService(
      client as unknown as TemplateGraphService,
      keys as unknown as JwtKeysService,
      prisma as unknown as PrismaService,
    );

    await service.retryPending();

    expect(client.applyTemplateGraphCopy).toHaveBeenCalledWith(
      intent.organizationId,
      intent.projectId,
      graphCommand,
      expect.any(Object),
    );
    expect(intent.command).toMatchObject({ readinessWorkItems });
  });
});

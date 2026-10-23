import { HelpContentBootstrapService } from '../help-content-bootstrap.service';
import { seedHelpContent } from '../help-content-seed';
import type { PrismaService } from '../../prisma/prisma.service';

jest.mock('../help-content-seed', () => ({
  seedHelpContent: jest.fn(),
}));

describe('HelpContentBootstrapService', () => {
  const prisma = {} as PrismaService;
  const summary = {
    nodes: { created: 2, updated: 1, unchanged: 23 },
    demos: { created: 0, updated: 0, deleted: 0, unchanged: 4 },
    changedNodeIds: ['node-id'],
    drift: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(seedHelpContent).mockResolvedValue(summary);
  });

  it('reconciles Help content during application bootstrap', async () => {
    const service = new HelpContentBootstrapService(prisma);

    await service.onApplicationBootstrap();

    expect(seedHelpContent).toHaveBeenCalledWith(prisma);
  });

  it('fails application bootstrap when reconciliation fails', async () => {
    const error = new Error('content source unavailable');
    jest.mocked(seedHelpContent).mockRejectedValue(error);
    const service = new HelpContentBootstrapService(prisma);

    await expect(service.onApplicationBootstrap()).rejects.toBe(error);
  });
});

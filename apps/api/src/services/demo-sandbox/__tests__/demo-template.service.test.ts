import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaService } from '../../../prisma/prisma.service';
import { DemoTemplateService } from '../demo-template.service';

const projectId = 'ac41a491-6eb2-48ce-82e8-489897ca63ec';
const repositoryUrl = 'https://github.com/example/template';
const input = { projectId, repositoryUrl };
const template = {
  id: '620720fe-117a-4d69-bbc9-24d174cc9c22',
  ...input,
  active: true,
  createdAt: new Date('2026-10-16T00:00:00Z'),
};

describe('DemoTemplateService', () => {
  const tx = {
    $queryRaw: jest.fn(),
    project: { findFirst: jest.fn() },
    demoTemplate: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  };
  const prisma = { $transaction: jest.fn() };
  let service: DemoTemplateService;
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    tx.project.findFirst.mockResolvedValue({ id: projectId });
    tx.demoTemplate.findFirst.mockResolvedValue(null);
    tx.demoTemplate.create.mockResolvedValue(template);
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    service = new DemoTemplateService(prisma as unknown as PrismaService);
  });

  afterEach(() => fetchMock.mockRestore());

  it('verifies the public repository before replacing the active designation in one transaction', async () => {
    await expect(
      service.designate({ ...input, repositoryUrl: `${repositoryUrl}.git/` }),
    ).resolves.toEqual({
      ...template,
      createdAt: template.createdAt.toISOString(),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/example/template',
      expect.objectContaining({
        credentials: 'omit',
        redirect: 'error',
      }),
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.demoTemplate.findFirst.mock.invocationCallOrder[0]!,
    );
    expect(tx.demoTemplate.updateMany).toHaveBeenCalledWith({
      where: { active: true },
      data: { active: false },
    });
    expect(tx.demoTemplate.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.demoTemplate.create.mock.invocationCallOrder[0]!,
    );
    expect(tx.demoTemplate.create).toHaveBeenCalledWith({
      data: { ...input, active: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns the existing active designation for a repeated request', async () => {
    tx.demoTemplate.findFirst.mockResolvedValue(template);
    await expect(service.designate(input)).resolves.toEqual({
      ...template,
      createdAt: template.createdAt.toISOString(),
    });
    expect(tx.demoTemplate.updateMany).not.toHaveBeenCalled();
    expect(tx.demoTemplate.create).not.toHaveBeenCalled();
  });

  it('does not deactivate the template when the requested project is absent', async () => {
    tx.project.findFirst.mockResolvedValue(null);
    await expect(service.designate(input)).rejects.toThrow(NotFoundException);
    expect(tx.demoTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('propagates a failed insert through the transaction so replacement rolls back', async () => {
    const failure = new Error('insert failed');
    tx.demoTemplate.create.mockRejectedValue(failure);
    await expect(service.designate(input)).rejects.toBe(failure);
  });

  it.each([404, 403, 429, 500])(
    'rejects GitHub status %s before opening a write transaction',
    async (status) => {
      fetchMock.mockResolvedValue(new Response(null, { status }));
      await expect(service.designate(input)).rejects.toThrow(
        status === 404 ? BadRequestException : ServiceUnavailableException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('leaves the designation untouched when GitHub cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'));
    await expect(service.designate(input)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

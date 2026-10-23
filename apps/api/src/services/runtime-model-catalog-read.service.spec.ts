import { Test } from '@nestjs/testing';
import { RuntimeModelCatalogReadService } from './runtime-model-catalog-read.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionGrantService } from './controller-authorization/execution-grant.service';
import { CliReadEmitter } from '../core/websockets/cli-read-emitter.service';
import { MachineId, OrganizationId, ProjectId, UserId } from '../types';
import type { CliReadRuntimeModelCatalogGetRequest } from '../generated';
jest.mock('../core/websockets/websocket.gateway', () => ({
  WebsocketGateway: class {},
}));
const request: CliReadRuntimeModelCatalogGetRequest = {
  operation: 'runtime.model_catalog.get',
  authorization: { kind: 'bounded_grant', grantId: 'grant' },
};
const params = {
  organizationId: 'org' as OrganizationId,
  projectId: 'project' as ProjectId,
  userId: 'user' as UserId,
  machineId: 'machine' as MachineId,
  controllerBindingSecret: 'binding',
  request,
};
describe('RuntimeModelCatalogReadService', () => {
  const db = {
    project: { findFirst: jest.fn() },
    machine: { findFirst: jest.fn() },
  };
  const grants = { assertRuntimeModelCatalogAuthorized: jest.fn() };
  const emitter = { readRuntimeModelCatalog: jest.fn() };
  let subject: RuntimeModelCatalogReadService;
  beforeEach(async () => {
    jest.clearAllMocks();
    db.project.findFirst.mockResolvedValue({ id: 'project' });
    db.machine.findFirst.mockResolvedValue({ id: 'machine' });
    grants.assertRuntimeModelCatalogAuthorized.mockResolvedValue({
      action: {
        requestId: 'request',
        actionType: 'CLI_READ',
        actionCategory: 'CLI_READ',
        targetKind: 'CLI_READ',
        targetId: 'machine',
      },
      authorizationId: 'authorization',
      envelopeAuthorization: request.authorization,
    });
    emitter.readRuntimeModelCatalog.mockResolvedValue({
      operation: 'runtime.model_catalog.get',
      status: 'success',
      result: { providers: [] },
    });
    const module = await Test.createTestingModule({
      providers: [
        RuntimeModelCatalogReadService,
        { provide: PrismaService, useValue: { db } },
        { provide: ExecutionGrantService, useValue: grants },
        { provide: CliReadEmitter, useValue: emitter },
      ],
    }).compile();
    subject = module.get(RuntimeModelCatalogReadService);
  });
  it('reads on the selected machine without any agent session', async () => {
    expect(await subject.read(params)).toMatchObject({ status: 'success' });
    expect(grants.assertRuntimeModelCatalogAuthorized).toHaveBeenCalledWith({
      ...params,
      authorization: request.authorization,
    });
    expect(emitter.readRuntimeModelCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        machineId: 'machine',
        projectId: 'project',
        organizationId: 'org',
        authorizationRequestId: 'request',
        admission: expect.objectContaining({
          actionPayloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
  });
  it('returns the CLI response untouched', async () => {
    const response = {
      requestId: 'request',
      operation: 'runtime.model_catalog.get',
      status: 'success',
      result: {
        providers: [
          {
            provider: 'claude',
            models: [],
            notice: 'Claude Code reported zero models on this machine.',
          },
        ],
      },
    };
    emitter.readRuntimeModelCatalog.mockResolvedValue(response);
    expect(await subject.read(params)).toBe(response);
  });
  it.each(['project', 'machine'] as const)(
    'rejects an unavailable %s before authorization or host access',
    async (key) => {
      db[key].findFirst.mockResolvedValue(null);
      await expect(subject.read(params)).rejects.toThrow();
      expect(grants.assertRuntimeModelCatalogAuthorized).not.toHaveBeenCalled();
      expect(emitter.readRuntimeModelCatalog).not.toHaveBeenCalled();
    },
  );
  it('does not emit a read when controller approval is rejected', async () => {
    grants.assertRuntimeModelCatalogAuthorized.mockRejectedValue(
      new Error('denied'),
    );
    await expect(subject.read(params)).rejects.toThrow('denied');
    expect(emitter.readRuntimeModelCatalog).not.toHaveBeenCalled();
  });
});

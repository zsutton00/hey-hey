import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ServicePlacesReadService } from './service-places-read.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionGrantService } from './controller-authorization/execution-grant.service';
import { CliReadEmitter } from '../core/websockets/cli-read-emitter.service';
import { MachineId, OrganizationId, ProjectId, UserId } from '../types';
import type { CliReadWorkspaceServicePlacesListRequest } from '@hey-hey/contracts/api/models';

jest.mock('../core/websockets/websocket.gateway', () => ({
  WebsocketGateway: class {},
}));

const inProject = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherProject = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const requestWith = (
  authorization: CliReadWorkspaceServicePlacesListRequest['authorization'],
  serviceIds: string[],
): CliReadWorkspaceServicePlacesListRequest => ({
  operation: 'workspace.service_places.list',
  authorization,
  serviceIds,
});

const paramsFor = (request: CliReadWorkspaceServicePlacesListRequest) => ({
  organizationId: 'org' as OrganizationId,
  projectId: 'project' as ProjectId,
  userId: 'user' as UserId,
  machineId: 'machine' as MachineId,
  controllerBindingSecret: 'binding',
  request,
});

describe('ServicePlacesReadService', () => {
  const db = {
    project: { findFirst: jest.fn() },
    machine: { findFirst: jest.fn() },
    // Only Services that belong to org + project come back, as in the database.
    service: { findMany: jest.fn() },
  };
  const grants = { assertServicePlacesReadAuthorized: jest.fn() };
  const emitter = { readServicePlaces: jest.fn() };
  let subject: ServicePlacesReadService;

  beforeEach(async () => {
    jest.clearAllMocks();
    db.project.findFirst.mockResolvedValue({ id: 'project' });
    db.machine.findFirst.mockResolvedValue({ id: 'machine' });
    db.service.findMany.mockImplementation(
      async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => id === inProject).map((id) => ({ id })),
    );
    grants.assertServicePlacesReadAuthorized.mockResolvedValue({
      action: { requestId: 'request' },
      authorizationId: 'authorization',
      envelopeAuthorization: { kind: 'bounded_grant', grantId: 'grant' },
    });
    emitter.readServicePlaces.mockResolvedValue({ status: 'success' });

    const module = await Test.createTestingModule({
      providers: [
        ServicePlacesReadService,
        { provide: PrismaService, useValue: { db } },
        { provide: ExecutionGrantService, useValue: grants },
        { provide: CliReadEmitter, useValue: emitter },
      ],
    }).compile();
    subject = module.get(ServicePlacesReadService);
  });

  it('reads places for Services that belong to the project', async () => {
    const request = requestWith({ kind: 'bounded_grant', grantId: 'grant' }, [inProject]);

    await subject.read(paramsFor(request));

    expect(db.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org',
          projectId: 'project',
        }),
      }),
    );
    expect(emitter.readServicePlaces).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a reusable grant', { kind: 'bounded_grant', grantId: 'grant' }],
    ['a fresh authorization', { kind: 'fresh_authorization', authorizationRequestId: 'x' }],
  ] as const)(
    'never authorizes or reaches the machine when %s names a Service outside the project',
    async (_name, authorization) => {
      const request = requestWith(authorization as never, [inProject, otherProject]);

      await expect(subject.read(paramsFor(request))).rejects.toBeInstanceOf(NotFoundException);

      expect(grants.assertServicePlacesReadAuthorized).not.toHaveBeenCalled();
      expect(emitter.readServicePlaces).not.toHaveBeenCalled();
    },
  );
});

import { Test } from '@nestjs/testing';
import { WorkspaceSkillsReadService } from './workspace-skills-read.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExecutionGrantService } from './controller-authorization/execution-grant.service';
import { CliReadEmitter } from '../core/websockets/cli-read-emitter.service';
import { MachineId, OrganizationId, ProjectId, UserId } from '../types';
import type { CliReadWorkspaceSkillsListRequest } from '../generated';
jest.mock('../core/websockets/websocket.gateway', () => ({
  WebsocketGateway: class {},
}));
const request: CliReadWorkspaceSkillsListRequest = {
  operation: 'workspace.skills.list',
  provider: 'codex',
  catalogContext: { policy: 'non_repository' },
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
describe('WorkspaceSkillsReadService', () => {
  const db = {
    project: { findFirst: jest.fn() },
    machine: { findFirst: jest.fn() },
    service: { findFirst: jest.fn() },
  };
  const grants = { assertWorkspaceSkillsAuthorized: jest.fn() };
  const emitter = { readWorkspace: jest.fn(), error: jest.fn() };
  let subject: WorkspaceSkillsReadService;
  beforeEach(async () => {
    jest.clearAllMocks();
    db.project.findFirst.mockResolvedValue({ id: 'project' });
    db.machine.findFirst.mockResolvedValue({ id: 'machine' });
    db.service.findFirst.mockResolvedValue({ id: 'service' });
    grants.assertWorkspaceSkillsAuthorized.mockResolvedValue({
      action: {
        requestId: 'request',
        actionType: 'CLI_READ',
        actionCategory: 'CLI_READ',
        targetKind: 'CLI_READ',
        targetId: 'machine',
        provider: 'codex',
        catalogContext: { policy: 'non_repository' },
      },
      authorizationId: 'authorization',
      envelopeAuthorization: request.authorization,
    });
    emitter.readWorkspace.mockResolvedValue({
      operation: 'workspace.skills.list',
      status: 'success',
      result: { provider: 'codex', skills: [], errors: [] },
    });
    emitter.error.mockImplementation((_request, code, message) => ({
      operation: 'workspace.skills.list',
      status: 'error',
      error: { code, message },
    }));
    const module = await Test.createTestingModule({
      providers: [
        WorkspaceSkillsReadService,
        { provide: PrismaService, useValue: { db } },
        { provide: ExecutionGrantService, useValue: grants },
        { provide: CliReadEmitter, useValue: emitter },
      ],
    }).compile();
    subject = module.get(WorkspaceSkillsReadService);
  });
  it('reads on the selected machine without creating or looking up a session or Service', async () => {
    expect(await subject.read(params)).toMatchObject({ status: 'success' });
    expect(db.service.findFirst).not.toHaveBeenCalled();
    expect(grants.assertWorkspaceSkillsAuthorized).toHaveBeenCalledWith({
      ...params,
      authorization: request.authorization,
    });
    expect(emitter.readWorkspace).toHaveBeenCalledWith(
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
  it('requires the requested Service to belong to the project', async () => {
    db.service.findFirst.mockResolvedValue(null);
    expect(
      await subject.read({
        ...params,
        request: {
          ...request,
          catalogContext: { policy: 'service_workspace', serviceId: 'other' },
        },
      }),
    ).toMatchObject({ status: 'error', error: { code: 'INVALID_WORKSPACE' } });
    expect(db.service.findFirst).toHaveBeenCalledWith({
      where: { id: 'other', projectId: 'project', organizationId: 'org' },
      select: { id: true },
    });
    expect(grants.assertWorkspaceSkillsAuthorized).not.toHaveBeenCalled();
    expect(emitter.readWorkspace).not.toHaveBeenCalled();
  });
  it.each(['project', 'machine'] as const)(
    'rejects an unavailable %s before authorization or host access',
    async (key) => {
      db[key].findFirst.mockResolvedValue(null);
      await expect(subject.read(params)).rejects.toThrow();
      expect(emitter.readWorkspace).not.toHaveBeenCalled();
    },
  );
  it('does not emit a read when controller approval is rejected', async () => {
    grants.assertWorkspaceSkillsAuthorized.mockRejectedValue(
      new Error('denied'),
    );
    await expect(subject.read(params)).rejects.toThrow('denied');
    expect(emitter.readWorkspace).not.toHaveBeenCalled();
  });
});

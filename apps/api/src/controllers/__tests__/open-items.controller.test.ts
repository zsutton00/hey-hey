import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as http from 'http';
import { Socket } from 'net';
import { ProjectAccessService } from '../../auth/services/project-access.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OpenItemsConflictException } from '../../services/open-items/open-items.errors';
import { OpenItemsService } from '../../services/open-items/open-items.service';
import { OpenItemsGoalPromotionService } from '../../services/open-items/open-items-goal-promotion.service';
import { OpenItemsController } from '../open-items.controller';

const ORG = 'org-allowed';
const PROJECT = 'project-allowed';
const BASE = `/api/v1/organizations/${ORG}/projects/${PROJECT}/open-items`;
const ENTITY = '00000000-0000-4000-8000-000000000001';
const GROUP = '00000000-0000-4000-8000-000000000901';

const mutationResult = {
  collectionRevision: 2,
  items: [],
  groups: [],
  deletedGroupIds: [],
  replayed: false,
};

// Requests are injected into the Express handler in-process, so the suite
// needs no listening socket.
interface ResponseBody {
  violations: { path: string }[];
  [key: string]: unknown;
}

let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

function call(
  method: 'GET' | 'POST',
  route: string,
  body?: unknown,
): Promise<{ status: number; body: ResponseBody }> {
  return new Promise((resolve) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = new http.IncomingMessage(new Socket());
    req.method = method;
    req.url = route;
    req.headers = payload
      ? {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        }
      : {};
    req.push(payload || null);
    if (payload) req.push(null);
    const res = new http.ServerResponse(req);
    const chunks: Buffer[] = [];
    res.write = ((chunk: string | Buffer) => {
      chunks.push(Buffer.from(chunk));
      return true;
    }) as typeof res.write;
    res.end = ((chunk?: string | Buffer) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      resolve({
        status: res.statusCode,
        body: JSON.parse(text || 'null') as ResponseBody,
      });
      return res;
    }) as typeof res.end;
    handler(req, res);
  });
}

describe('OpenItemsController (HTTP)', () => {
  let app: INestApplication;
  const service = {
    getOpenItems: jest.fn(),
    activateOpenItem: jest.fn(),
    setOpenItemNote: jest.fn(),
    renameOpenItemGroup: jest.fn(),
    migrateOpenItems: jest.fn(),
    resetOpenItems: jest.fn(),
    setOpenItemGoalFilter: jest.fn(),
    setOpenItemGoalDisclosure: jest.fn(),
  };
  const promotion = { promoteGroupToGoal: jest.fn() };
  const access = {
    assertOrganization: jest.fn(async (_user: string, org: string) => {
      if (org !== ORG) throw new ForbiddenException();
    }),
    assertProject: jest.fn(
      async (_user: string, _org: string, project: string) => {
        if (project !== PROJECT)
          throw new ForbiddenException('Project access denied');
      },
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OpenItemsController],
      providers: [
        { provide: OpenItemsService, useValue: service },
        { provide: OpenItemsGoalPromotionService, useValue: promotion },
        { provide: ProjectAccessService, useValue: access },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = {
            userId: 'user-from-token',
            orgMemberships: [{ orgId: ORG, role: 'Member' }],
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    handler = app.getHttpAdapter().getInstance();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('wires promotion with authenticated scope and rejects expected-revision input', async () => {
    const body = {
      groupId: GROUP,
      goalName: 'Outcome',
      idempotencyKey: 'promotion-key',
    };
    const result = {
      collection: { state: 'PRESENT', revision: 3, items: [], groups: [] },
      goal: { entityType: 'TASK', entityId: ENTITY },
      untrackedMembers: [],
      replayed: false,
    };
    promotion.promoteGroupToGoal.mockResolvedValue(result);
    expect(await call('POST', BASE + '/promotions', body)).toEqual({
      status: 200,
      body: result,
    });
    expect(promotion.promoteGroupToGoal).toHaveBeenCalledWith(
      { organizationId: ORG, projectId: PROJECT, userId: 'user-from-token' },
      body,
      null,
    );
    promotion.promoteGroupToGoal.mockClear();
    expect(
      (
        await call('POST', BASE + '/promotions', {
          ...body,
          expectedRevision: 1,
        })
      ).status,
    ).toBe(400);
    expect(promotion.promoteGroupToGoal).not.toHaveBeenCalled();
  });

  it('wires typed Goal filter and disclosure operations', async () => {
    service.setOpenItemGoalFilter.mockResolvedValue(mutationResult);
    service.setOpenItemGoalDisclosure.mockResolvedValue(mutationResult);
    expect(
      (
        await call('POST', BASE + '/items/TASK/' + ENTITY + '/goal-filter', {
          idempotencyKey: 'filter-key',
          filter: 'ALL',
        })
      ).status,
    ).toBe(200);
    expect(service.setOpenItemGoalFilter).toHaveBeenCalledWith(
      { organizationId: ORG, projectId: PROJECT, userId: 'user-from-token' },
      { entityType: 'TASK', entityId: ENTITY },
      { idempotencyKey: 'filter-key', filter: 'ALL' },
    );
    expect(
      (
        await call(
          'POST',
          BASE + '/items/TASK/' + ENTITY + '/goal-disclosure',
          { idempotencyKey: 'disclosure-key', collapsed: false },
        )
      ).status,
    ).toBe(200);
    expect(service.setOpenItemGoalDisclosure).toHaveBeenCalledWith(
      { organizationId: ORG, projectId: PROJECT, userId: 'user-from-token' },
      { entityType: 'TASK', entityId: ENTITY },
      { idempotencyKey: 'disclosure-key', collapsed: false },
    );
    expect(
      (
        await call('POST', BASE + '/items/TASK/' + ENTITY + '/goal-filter', {
          idempotencyKey: 'filter-key',
          filter: 'INVALID',
        })
      ).status,
    ).toBe(400);
  });

  it('derives the user from authenticated context, never from the request', async () => {
    service.getOpenItems.mockResolvedValue({ state: 'ABSENT' });
    const response = await call('GET', `${BASE}?userId=someone-else`);
    expect(response).toEqual({ status: 200, body: { state: 'ABSENT' } });
    expect(service.getOpenItems).toHaveBeenCalledWith({
      organizationId: ORG,
      projectId: PROJECT,
      userId: 'user-from-token',
    });
  });

  it('enforces project access before any handler runs', async () => {
    const response = await call(
      'POST',
      `/api/v1/organizations/${ORG}/projects/other-project/open-items/reset`,
      { idempotencyKey: 'idem-key-1' },
    );
    expect(response.status).toBe(403);
    expect(service.resetOpenItems).not.toHaveBeenCalled();
  });

  it('enforces organization access', async () => {
    const response = await call(
      'GET',
      `/api/v1/organizations/other-org/projects/${PROJECT}/open-items`,
    );
    expect(response.status).toBe(403);
    expect(service.getOpenItems).not.toHaveBeenCalled();
  });

  it('passes a contract-valid body through as the generated type', async () => {
    service.activateOpenItem.mockResolvedValue(mutationResult);
    const body = {
      idempotencyKey: 'idem-key-1',
      item: { entityType: 'TASK', entityId: ENTITY },
      lineage: [],
      presentation: { label: 'Task', workItemTypeKey: 'STANDARD' },
    };
    const response = await call('POST', `${BASE}/activations`, body);
    expect(response).toEqual({ status: 200, body: mutationResult });
    expect(service.activateOpenItem).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-from-token' }),
      body,
    );
  });

  it('rejects contract-invalid bodies with the closed validation error shape', async () => {
    const response = await call('POST', `${BASE}/activations`, {
      idempotencyKey: 'short',
      item: { entityType: 'NOT_A_TYPE', entityId: 'nope' },
      lineage: [],
      presentation: { label: '' },
      userId: 'injected',
    });
    expect(response.status).toBe(400);
    expect(Object.keys(response.body).sort()).toEqual([
      'code',
      'message',
      'success',
      'violations',
    ]);
    expect(response.body).toMatchObject({
      success: false,
      code: 'INVALID_REQUEST',
    });
    const paths = response.body.violations.map((v) => v.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/',
        '/idempotencyKey',
        '/item/entityType',
        '/item/entityId',
        '/presentation/label',
      ]),
    );
    expect(service.activateOpenItem).not.toHaveBeenCalled();
  });

  it('validates path identities against the contract', async () => {
    const note = await call('POST', `${BASE}/items/BOGUS/${ENTITY}/note`, {
      idempotencyKey: 'idem-key-1',

      note: null,
    });
    expect(note.status).toBe(400);
    expect(note.body.violations[0]!.path).toBe('#path/entityType');

    const rename = await call('POST', `${BASE}/groups/not-a-uuid/rename`, {
      idempotencyKey: 'idem-key-1',

      name: 'x',
    });
    expect(rename.status).toBe(400);
    expect(service.renameOpenItemGroup).not.toHaveBeenCalled();
  });

  it('routes path identities and the body to the service', async () => {
    service.renameOpenItemGroup.mockResolvedValue(mutationResult);
    const body = {
      idempotencyKey: 'idem-key-1',

      name: 'x',
    };
    const response = await call('POST', `${BASE}/groups/${GROUP}/rename`, body);
    expect(response.status).toBe(200);
    expect(service.renameOpenItemGroup).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT }),
      GROUP,
      body,
    );
  });

  it('writes conflicts as the closed conflict error shape', async () => {
    service.setOpenItemNote.mockRejectedValue(
      OpenItemsConflictException.of('IDEMPOTENCY_KEY_REUSED', 'reused', 4),
    );
    const response = await call('POST', `${BASE}/items/TASK/${ENTITY}/note`, {
      idempotencyKey: 'idem-key-1',

      note: '',
    });
    expect(response).toEqual({
      status: 409,
      body: {
        success: false,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'reused',
        currentCollectionRevision: 4,
      },
    });
  });

  it('validates migration payloads at the boundary', async () => {
    const response = await call('POST', `${BASE}/migration`, {
      idempotencyKey: 'idem-key-1',
      sourceSchemaVersion: 0,
      groups: [],
      items: [
        {
          entityType: 'TASK',
          entityId: ENTITY,
          note: null,
          pinned: false,
          localGroupId: null,
          lineage: Array.from({ length: 17 }, () => ({
            entityType: 'TASK',
            entityId: ENTITY,
          })),
          presentation: { label: 'x', live: true },
        },
      ],
    });
    expect(response.status).toBe(400);
    const paths = response.body.violations.map((v) => v.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/sourceSchemaVersion',
        '/items/0/lineage',
        '/items/0/presentation',
      ]),
    );
    expect(service.migrateOpenItems).not.toHaveBeenCalled();
  });
});

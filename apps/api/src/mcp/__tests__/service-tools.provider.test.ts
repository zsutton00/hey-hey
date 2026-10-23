import { ServiceToolsProvider } from '../tools/service-tools.provider';
import { ServiceService } from '../../services/service/service.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';

function makeUser() {
  return {
    userId: 'u1',
    email: 'test@example.com',
    name: 'Test',
    currentOrgId: ORG_ID,
    orgMemberships: [],
    isDevAdmin: false,
    devAdminMode: false,
  };
}

function makeRequest(opts: { token?: string } = {}) {
  return {
    headers: {
      authorization: opts.token ? `Bearer ${opts.token}` : 'Bearer tok',
    },
    cookies: {},
    user: makeUser(),
    ip: '127.0.0.1',
  } as any;
}

function makeService(overrides: Record<string, any> = {}) {
  return {
    id: 's1',
    name: 'api-service',
    description: 'Main API',
    serviceType: 'backend',
    language: 'TypeScript',
    framework: 'NestJS',
    tags: ['api', 'core'],
    status: 'ACTIVE',
    repositoryUrl: 'https://github.com/org/api',
    childCounts: {
      tasks: 5,
      initiatives: 2,
      designDocs: 1,
      agentSessions: 3,
      implementationHints: 4,
    },
    ...overrides,
  };
}

const mockServiceService = {
  findAll: jest.fn(),
} as unknown as jest.Mocked<ServiceService>;

function createProvider() {
  return new ServiceToolsProvider(
    mockServiceService as unknown as ServiceService,
  );
}

describe('ServiceToolsProvider', () => {
  let provider: ServiceToolsProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = createProvider();
  });

  describe('list_services', () => {
    it('returns error when not authenticated', async () => {
      const req = makeRequest();
      req.user = undefined;

      const result = await provider.listServices(
        { status: 'ACTIVE', limit: 10, offset: 0 },
        {} as any,
        req,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Authentication required',
      );
    });

    it('calls serviceService.findAll with status, tags, and serviceType', async () => {
      (mockServiceService.findAll as jest.Mock).mockResolvedValue([]);

      await provider.listServices(
        {
          status: 'ACTIVE',
          tag: 'core',
          serviceType: 'backend',
          limit: 10,
          offset: 0,
        },
        {} as any,
        makeRequest(),
      );

      expect(mockServiceService.findAll).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({
          status: 'ACTIVE',
          tags: ['core'],
          serviceType: 'backend',
        }),
      );
    });

    it('maps service fields to output schema', async () => {
      (mockServiceService.findAll as jest.Mock).mockResolvedValue([
        makeService(),
      ]);

      const result = await provider.listServices(
        { status: 'ACTIVE', limit: 10, offset: 0 },
        {} as any,
        makeRequest(),
      );

      expect((result as any).services).toHaveLength(1);
      expect((result as any).services[0]).toEqual({
        id: 's1',
        name: 'api-service',
        description: 'Main API',
        serviceType: 'backend',
        language: 'TypeScript',
        framework: 'NestJS',
        tags: ['api', 'core'],
        status: 'ACTIVE',
        repositoryUrl: 'https://github.com/org/api',
        childCounts: {
          tasks: 5,
          initiatives: 2,
          agentSessions: 3,
          implementationHints: 4,
        },
      });
    });

    it('filters by name case-insensitively', async () => {
      (mockServiceService.findAll as jest.Mock).mockResolvedValue([
        makeService({ id: 's1', name: 'api-service' }),
        makeService({ id: 's2', name: 'worker-service' }),
        makeService({ id: 's3', name: 'API-Gateway' }),
      ]);

      const result = await provider.listServices(
        { name: 'api', status: 'ACTIVE', limit: 10, offset: 0 },
        {} as any,
        makeRequest(),
      );

      expect((result as any).services).toHaveLength(2);
      expect((result as any).services.map((s: any) => s.id)).toEqual([
        's1',
        's3',
      ]);
    });

    it('filters by language case-insensitively', async () => {
      (mockServiceService.findAll as jest.Mock).mockResolvedValue([
        makeService({ id: 's1', language: 'TypeScript' }),
        makeService({ id: 's2', language: 'Python' }),
        makeService({ id: 's3', language: 'typescript' }),
      ]);

      const result = await provider.listServices(
        { language: 'type', status: 'ACTIVE', limit: 10, offset: 0 },
        {} as any,
        makeRequest(),
      );

      expect((result as any).services).toHaveLength(2);
      expect((result as any).services.map((s: any) => s.id)).toEqual([
        's1',
        's3',
      ]);
    });

    it('applies offset and limit pagination', async () => {
      const services = Array.from({ length: 5 }, (_, i) =>
        makeService({ id: `s${i}`, name: `svc-${i}` }),
      );
      (mockServiceService.findAll as jest.Mock).mockResolvedValue(services);

      const result = await provider.listServices(
        { status: 'ACTIVE', limit: 2, offset: 1 },
        {} as any,
        makeRequest(),
      );

      expect((result as any).services).toHaveLength(2);
      expect((result as any).services[0].id).toBe('s1');
      expect((result as any).services[1].id).toBe('s2');
    });

    it('returns total as filtered count before pagination', async () => {
      const services = Array.from({ length: 5 }, (_, i) =>
        makeService({ id: `s${i}`, name: `svc-${i}` }),
      );
      (mockServiceService.findAll as jest.Mock).mockResolvedValue(services);

      const result = await provider.listServices(
        { status: 'ACTIVE', limit: 2, offset: 0 },
        {} as any,
        makeRequest(),
      );

      expect((result as any).services).toHaveLength(2);
      expect((result as any).total).toBe(5);
    });

    it('sets hasMore when more results exist beyond page', async () => {
      const services = Array.from({ length: 5 }, (_, i) =>
        makeService({ id: `s${i}`, name: `svc-${i}` }),
      );
      (mockServiceService.findAll as jest.Mock).mockResolvedValue(services);

      const result = await provider.listServices(
        { status: 'ACTIVE', limit: 2, offset: 0 },
        {} as any,
        makeRequest(),
      );

      expect((result as any).hasMore).toBe(true);
    });

    it('sets hasMore=false when all results fit', async () => {
      (mockServiceService.findAll as jest.Mock).mockResolvedValue([
        makeService(),
      ]);

      const result = await provider.listServices(
        { status: 'ACTIVE', limit: 10, offset: 0 },
        {} as any,
        makeRequest(),
      );

      expect((result as any).hasMore).toBe(false);
    });

    it('handles services with null optional fields', async () => {
      (mockServiceService.findAll as jest.Mock).mockResolvedValue([
        makeService({
          description: null,
          serviceType: null,
          language: null,
          framework: null,
          tags: null,
          repositoryUrl: null,
          childCounts: null,
        }),
      ]);

      const result = await provider.listServices(
        { status: 'ACTIVE', limit: 10, offset: 0 },
        {} as any,
        makeRequest(),
      );

      const svc = (result as any).services[0];
      expect(svc.description).toBeUndefined();
      expect(svc.serviceType).toBeUndefined();
      expect(svc.language).toBeUndefined();
      expect(svc.framework).toBeUndefined();
      expect(svc.tags).toEqual([]);
      expect(svc.repositoryUrl).toBeUndefined();
      expect(svc.childCounts).toBeUndefined();
    });

    it('returns descriptive error on service failure', async () => {
      (mockServiceService.findAll as jest.Mock).mockRejectedValue(
        new Error('DB connection failed'),
      );

      const result = await provider.listServices(
        { status: 'ACTIVE', limit: 10, offset: 0 },
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Service list failed: DB connection failed',
      );
    });
  });
});

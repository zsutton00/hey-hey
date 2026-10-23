import { HttpService } from '@nestjs/axios';
import { firstValueFrom, of } from 'rxjs';
import { AgentEdgesService } from '../../generated/graphs/api/agentEdges.service';
import { Configuration } from '../../generated/graphs/configuration';

describe('generated Graph AgentEdgesService', () => {
  const expectedUpdatedAt = '2026-10-22T08:55:01.123Z';
  let httpClient: { patch: jest.Mock; delete: jest.Mock };
  let service: AgentEdgesService;

  beforeEach(() => {
    httpClient = {
      patch: jest
        .fn()
        .mockReturnValue(of({ data: { lastModifiedBySessionId: 'session' } })),
      delete: jest.fn().mockReturnValue(of({ data: undefined })),
    };
    service = new AgentEdgesService(
      httpClient as unknown as HttpService,
      new Configuration({ basePath: 'http://graphs.test' }),
    );
  });

  it('sends the expectedUpdatedAt string on update', async () => {
    await firstValueFrom(
      service.updateAgentEdge(
        'org',
        'project',
        'edge',
        { lastModifiedBySessionId: 'session' },
        expectedUpdatedAt,
      ),
    );

    const params: URLSearchParams = httpClient.patch.mock.calls[0][2].params;
    expect(params.get('expectedUpdatedAt')).toBe(expectedUpdatedAt);
  });

  it('sends the expectedUpdatedAt string on delete', async () => {
    await firstValueFrom(
      service.deleteAgentEdge('org', 'project', 'edge', expectedUpdatedAt),
    );

    const params: URLSearchParams = httpClient.delete.mock.calls[0][1].params;
    expect(params.get('expectedUpdatedAt')).toBe(expectedUpdatedAt);
  });
});

import type { AxiosResponse } from 'axios';
import { AxiosHeaders } from 'axios';
import { of } from 'rxjs';
import {
  ProjectionDeletionCommand,
  ProjectionDeletionResult,
} from 'src/generated/graphs';
import { GraphsClientService } from '../graphs-client.service';

describe('GraphsClientService projection deletion', () => {
  it('reads generated incident groups with authentication and without traversal', async () => {
    const request: import('src/generated/graphs').IncidentEdgesRequest = {
      seedEntityIds: ['123e4567-e89b-42d3-a456-426614174099'],
      relationshipTypes: ['RELATED_TO', 'INFLUENCES', 'PROPOSED_TOGETHER'],
    };
    const data: import('src/generated/graphs').IncidentEdgesResponse = {
      groups: [
        {
          seedEntityId: request.seedEntityIds[0]!,
          neighborTotal: 0,
          relationships: [],
          endpoints: [],
        },
      ],
    };
    const queries = {
      readIncidentEdges: jest.fn().mockReturnValue(of({ data })),
      traverseGraph: jest.fn(),
    };
    const service = new GraphsClientService(
      queries as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.readIncidentEdges(
        'org' as never,
        'project' as never,
        request,
        'token',
      ),
    ).resolves.toEqual(data);
    expect(queries.readIncidentEdges).toHaveBeenCalledWith(
      'org',
      'project',
      request,
      {
        config: {
          headers: {
            Authorization: 'Bearer token',
            'X-API-Auth': 'Bearer token',
            'Content-Type': 'application/json',
          },
        },
      },
    );
    expect(queries.traverseGraph).not.toHaveBeenCalled();
    await expect(
      service.readIncidentEdges(
        'org' as never,
        'project' as never,
        request,
        '',
      ),
    ).rejects.toThrow('require a user token');
    expect(queries.readIncidentEdges).toHaveBeenCalledTimes(1);
  });

  it('sends structured reads through one authenticated traversal request', async () => {
    const organizationId =
      '50e01076-bce8-4a65-b205-c5da8480e8fb' as import('src/types').OrganizationId;
    const projectId =
      '0fbfaeca-a381-4ff0-82ba-0bd772095e77' as import('src/types').ProjectId;
    const request: import('src/generated/graphs').StructuredGraphReadRequest = {
      root: {
        entityId: '8b0a1d69-0642-40e9-abd5-36795cd7bb14',
        entityType: 'TASK',
      },
      seeds: [],
      directEdgeTypes: [],
      expansions: [],
    };
    const structuredRead: import('src/generated/graphs').StructuredGraphReadResponse =
      { directEdges: [], expansions: [] };
    const queries = {
      traverseGraph: jest
        .fn()
        .mockReturnValue(of({ data: { structuredRead } })),
    };
    const service = new GraphsClientService(
      queries as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.readStructuredGraph(
        organizationId,
        projectId,
        request,
        'test-token',
      ),
    ).resolves.toEqual(structuredRead);
    expect(queries.traverseGraph).toHaveBeenCalledTimes(1);
    expect(queries.traverseGraph).toHaveBeenCalledWith(
      organizationId,
      projectId,
      { projection: 'STRUCTURED_READ', structuredRead: request },
      expect.objectContaining({
        config: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      }),
    );
    queries.traverseGraph.mockReturnValue(of({ data: { results: [] } }));
    await expect(
      service.readStructuredGraph(
        organizationId,
        projectId,
        request,
        'test-token',
      ),
    ).rejects.toThrow('no structured read response');
  });

  it('sends the canonical projection-deletion command with the scoped credential', async () => {
    const command: ProjectionDeletionCommand = {
      organizationId: 'org-123',
      markerId: 'marker-123',
      irreversibleClosureAt: '2026-08-19T12:00:00.000Z',
      deletionDeadline: '2026-09-18T12:00:00.000Z',
    };
    const result: ProjectionDeletionResult = {
      ...command,
      tombstoneRecorded: true,
      contentVerificationCompleted: true,
    };
    const lifecycleService = {
      deleteOrganizationProjection: jest.fn().mockReturnValue(
        of({
          data: result,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: { headers: new AxiosHeaders() },
        } as AxiosResponse<ProjectionDeletionResult>),
      ),
    };
    const service = new GraphsClientService(
      {} as never,
      lifecycleService as never,
      {} as never,
    );

    await expect(
      service.deleteOrganizationProjection(command, 'closure-token'),
    ).resolves.toEqual(result);

    expect(lifecycleService.deleteOrganizationProjection).toHaveBeenCalledWith(
      'org-123',
      command,
      expect.objectContaining({
        config: expect.objectContaining({
          headers: {
            Authorization: 'Bearer closure-token',
            'Content-Type': 'application/json',
          },
        }),
      }),
    );
  });
});

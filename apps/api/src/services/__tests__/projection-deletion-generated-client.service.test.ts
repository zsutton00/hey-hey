import type { HttpService } from '@nestjs/axios';
import { firstValueFrom, of } from 'rxjs';
import { Configuration as GraphConfiguration } from 'src/generated/graphs/configuration';
import { LifecycleService as GraphLifecycleService } from 'src/generated/graphs/api/lifecycle.service';
import { ProjectionDeletionCommand as GraphProjectionDeletionCommand } from 'src/generated/graphs';
import { Configuration as EmbeddingsConfiguration } from 'src/generated/embeddings/configuration';
import { OrganizationLifecycleService as EmbeddingsLifecycleService } from 'src/generated/embeddings/api/organizationLifecycle.service';
import { ProjectionDeletionCommand as EmbeddingsProjectionDeletionCommand } from 'src/generated/embeddings';

const command = {
  organizationId: 'org-123',
  markerId: 'marker-123',
  irreversibleClosureAt: '2026-08-19T12:00:00.000Z',
  deletionDeadline: '2026-09-18T12:00:00.000Z',
};

describe('generated projection-deletion clients', () => {
  it('serializes the Graph route, payload, and Authorization header', async () => {
    const post = jest.fn().mockReturnValue(of({ data: command }));
    const httpClient = { post } as unknown as HttpService;
    const service = new GraphLifecycleService(
      httpClient,
      new GraphConfiguration({
        basePath: 'https://graph.example.test/api',
        accessToken: 'closure-token',
      }),
    );

    await firstValueFrom(
      service.deleteOrganizationProjection(
        command.organizationId,
        command satisfies GraphProjectionDeletionCommand,
      ),
    );

    expect(post).toHaveBeenCalledWith(
      'https://graph.example.test/api/organizations/org-123/projection-deletion',
      command,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer closure-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('serializes the Embeddings route, payload, and Authorization header', async () => {
    const post = jest.fn().mockReturnValue(of({ data: command }));
    const httpClient = { post } as unknown as HttpService;
    const service = new EmbeddingsLifecycleService(
      httpClient,
      new EmbeddingsConfiguration({
        basePath: 'https://embeddings.example.test',
        accessToken: 'closure-token',
      }),
    );

    await firstValueFrom(
      service.deleteOrganizationProjection(
        command.organizationId,
        command satisfies EmbeddingsProjectionDeletionCommand,
      ),
    );

    expect(post).toHaveBeenCalledWith(
      'https://embeddings.example.test/orgs/org-123/projection-deletion',
      command,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer closure-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });
});

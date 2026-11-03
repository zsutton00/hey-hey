import { SKIP_TRANSFORM_KEY } from '../../common/decorators/skip-transform.decorator';
import { SearchResponse } from '../../generated/embeddings';
import { EmbeddingsClientService } from '../../services/embeddings-client.service';
import { EntityRegistryService } from '../../services/entity-registry/entity-registry.service';
import { OrganizationId, ProjectId, UserId } from '../../types';
import { EntitySearchController } from '../entity-search.controller';

describe('EntitySearchController', () => {
  it('returns provider search metadata without the generic response wrapper', async () => {
    const response: SearchResponse = {
      success: true,
      query: 'query text',
      results: 0,
      data: [],
    };
    const embeddingsClient = {
      searchWithUserToken: jest.fn().mockResolvedValue(response),
    };
    const controller = new EntitySearchController(
      {} as EntityRegistryService,
      embeddingsClient as unknown as EmbeddingsClientService,
      { assertProject: jest.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await controller.semanticSearch(
      'query text',
      'project-id' as ProjectId,
      10,
      undefined,
      'semantic',
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      'organization-id' as OrganizationId,
      'user-id' as UserId,
      'user-token',
    );

    expect(result).toBe(response);
    expect(
      Reflect.getMetadata(
        SKIP_TRANSFORM_KEY,
        EntitySearchController.prototype.semanticSearch,
      ),
    ).toBe(true);
  });
});

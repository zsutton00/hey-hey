import { ArtifactResponseDto, ArtifactType } from 'src/generated';
import { ArtifactService } from 'src/services/artifacts/artifact.service';
import { OrganizationId, ProjectId } from 'src/types';
import { formatArtifactForPrompt } from 'src/utils/artifact-formatting.util';

export const buildRecentConversationMessageLoaders = (
  artifactService: ArtifactService,
) => ({
  fetchArtifacts: async ({
    projectId,
    conversationId,
    organizationId,
    limit,
  }: {
    projectId: ProjectId;
    conversationId: string;
    organizationId: OrganizationId;
    limit: number;
  }): Promise<ArtifactResponseDto[]> => {
    const artifacts = await artifactService.findMany(
      {
        projectId,
        sourceId: conversationId,
        status: 'ACTIVE',
        limit,
        type: ArtifactType.QaPair,
        orderBy: 'createdAt',
        orderDirection: 'desc',
      },
      organizationId,
    );

    return artifacts?.data ?? [];
  },
  formatArtifact: (artifact: ArtifactResponseDto) =>
    formatArtifactForPrompt(artifact, {
      includeTitle: false,
      includeContentHeader: false,
      includeType: false,
      includeTimestamp: false,
    }),
});

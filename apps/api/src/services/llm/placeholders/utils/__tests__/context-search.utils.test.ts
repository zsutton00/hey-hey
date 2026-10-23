import { formatContextSearchResults } from '../context-search-formatting.utils';
import type { ArtifactWithMetadata } from '../../../../../context/interfaces';

describe('formatContextSearchResults', () => {
  const baseArtifact: Omit<ArtifactWithMetadata, 'relevanceScore'> = {
    id: 'artifact-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    type: 'DOCUMENT',
    title: 'Test Artifact',
    data: { content: 'A concise artifact summary.' },
    tags: [],
    category: 'test',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    sourceType: 'MESSAGE',
    sourceId: 'msg-1',
  };

  it('renders similarity scores without percentage conversion', () => {
    const artifacts: ArtifactWithMetadata[] = [
      {
        ...baseArtifact,
        relevanceScore: 0.67891,
      },
    ];

    const formatted = formatContextSearchResults(artifacts);

    expect(formatted).toContain('1. Test Artifact');
    expect(formatted).toContain('Similarity: 0.679');
    expect(formatted).toContain('Content: A concise artifact summary.');
  });

  it('omits similarity details for non-numeric scores', () => {
    const artifacts: ArtifactWithMetadata[] = [
      {
        ...baseArtifact,
        id: 'artifact-2',
        title: 'Artifact Without Score',
      },
    ];

    const formatted = formatContextSearchResults(artifacts);

    expect(formatted).toContain('1. Artifact Without Score');
    expect(formatted).not.toContain('Similarity:');
  });
});

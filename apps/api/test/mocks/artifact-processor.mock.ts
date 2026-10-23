import { ArtifactProcessor } from '../../src/core/processing/artifact-processor.service';

export function createArtifactProcessorMock() {
  return {
    provide: ArtifactProcessor,
    useValue: {
      processArtifactGeneration: jest.fn().mockResolvedValue({
        success: true,
        artifacts: [
          {
            id: 'artifact-123',
            title: 'Mock Artifact',
            content: 'Mock content',
          },
        ],
      }),
      maybeGenerateArtifactsForUserAnswers: jest.fn().mockResolvedValue({
        success: true,
        generated: true,
      }),
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
    },
  };
}

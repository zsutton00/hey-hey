import { SharedGenerateArtifactsNode } from '../shared-generate-artifacts.node';
import { NodeType } from '../../../../types/flow-internal.types';

describe('SharedGenerateArtifactsNode', () => {
  it('exposes analyze node metadata and prompt config', () => {
    const node = new SharedGenerateArtifactsNode();

    expect(node.id).toBe('shared-generate-artifacts');
    expect(node.type).toBe(NodeType.ANALYZE);
    expect(node.promptConfig?.responseSchema?.safeParse).toBeDefined();
    expect(node.promptConfig?.systemPromptTemplate).toContain(
      'Analyze the entire conversation and extract insights',
    );
  });
});

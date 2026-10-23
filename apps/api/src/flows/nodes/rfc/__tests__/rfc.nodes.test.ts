import { RfcGenerateNode } from '../generate.node';
import { NodeType } from '../../../../types/flow-internal.types';

describe('RfcGenerateNode', () => {
  it('defines generate node prompt configuration', () => {
    const node = new RfcGenerateNode();

    expect(node.id).toBe('rfc_generate');
    expect(node.type).toBe(NodeType.GENERATE);
    expect(node.promptConfig?.systemPromptTemplate).toContain(
      'You are an expert at creating comprehensive Request for Comments',
    );
    expect(node.promptConfig?.responseSchema?.safeParse).toBeDefined();
  });
});

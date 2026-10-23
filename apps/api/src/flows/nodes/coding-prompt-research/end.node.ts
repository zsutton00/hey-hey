import { Injectable } from '@nestjs/common';
import {
  CodingPromptResearchFlowContext,
  FinalizeNodeBase,
  NodeResult,
  NodeType,
} from 'src/types/flow-internal.types';
import { CODING_PROMPT_RESEARCH_NODES } from '../../constants';

@Injectable()
export class CodingPromptResearchEndNode extends FinalizeNodeBase<CodingPromptResearchFlowContext> {
  readonly id = CODING_PROMPT_RESEARCH_NODES.END;
  readonly title = 'Coding Prompt Research Complete';
  twoPhase = false;

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.FINALIZE,
      message: 'Coding prompt research execution completed.',
    };
  }
}

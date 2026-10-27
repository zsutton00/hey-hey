import { Injectable } from '@nestjs/common';
import {
  NodeResult,
  NodeType,
  RepositoryImportFlowContext,
  ActionNodeBase,
} from '../../../types/flow-internal.types';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import { FinalizeNodeBase } from '../base';

@Injectable()
export class RepositoryImportFinalizeNode extends ActionNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.FINALIZE;
  readonly title = 'Imported Features created';

  async execute(): Promise<NodeResult> {
    return {
      type: NodeType.ACTION,
      data: { type: 'ACTION_COMPLETE' },
      message: 'Your imported Features were created after approval.',
    };
  }
}

@Injectable()
export class RepositoryImportEndNode extends FinalizeNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.END;
  readonly title = 'Repository import complete';

  async execute(): Promise<NodeResult> {
    return { type: NodeType.FINALIZE, message: 'Repository import complete.' };
  }
}

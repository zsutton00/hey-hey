import { NodeType } from '../../../types/flow-internal.types';
import {
  RepositoryImportEndNode,
  RepositoryImportFinalizeNode,
} from './repository-import-finalize.node';

describe('repository import finalization', () => {
  it('finishes after proposal approval without onboarding activation effects', async () => {
    await expect(new RepositoryImportFinalizeNode().execute()).resolves.toEqual(
      {
        type: NodeType.FINALIZE,
        message: 'Your imported Features were created after approval.',
      },
    );
    await expect(new RepositoryImportEndNode().execute()).resolves.toEqual({
      type: NodeType.FINALIZE,
      message: 'Repository import complete.',
    });
  });
});

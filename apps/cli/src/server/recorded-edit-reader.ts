import type { ImplementReportEdit } from '@hey-hey/contracts/api/models';
import type { CliReadChangedFileDetail } from '@hey-hey/contracts/agent-bridge';
import { untrustedCheckoutGit } from '../git/diff';
import { runAnchorRef } from '../git/object-store';
import { RunChangedFilesContextError } from './run-changed-files';

export class RecordedEditTooLargeError extends Error {
  constructor() {
    super('The recorded file exceeds the remote read size limit.');
    this.name = 'RecordedEditTooLargeError';
  }
}

/** Reads only retained blobs in the addressed Run's Service repository. Never reads the working tree. */
export async function readRecordedEdit(
  repoPath: string,
  runId: string,
  serviceId: string,
  edit: ImplementReportEdit,
): Promise<CliReadChangedFileDetail> {
  const unavailable = () =>
    new RunChangedFilesContextError(
      'The recorded file versions are unavailable.',
      serviceId,
      'GIT_READ_FAILED',
    );
  if (!edit.versionsRecorded) {
    throw unavailable();
  }
  try {
    const retained = new Set(
      (
        await untrustedCheckoutGit(repoPath, [
          'rev-list',
          '--objects',
          '--no-object-names',
          runAnchorRef(runId),
          '--',
        ])
      )
        .trim()
        .split('\n'),
    );
    const read = async (id: string | null): Promise<string | null> => {
      if (id === null) {
        return null;
      }
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id) || !retained.has(id)) {
        throw unavailable();
      }
      const size = Number((await untrustedCheckoutGit(repoPath, ['cat-file', '-s', id])).trim());
      if (size > 1_048_576) {
        throw new RecordedEditTooLargeError();
      }
      return untrustedCheckoutGit(repoPath, ['cat-file', 'blob', id]);
    };
    const [preContent, postContent] = await Promise.all([
      read(edit.beforeObjectId),
      read(edit.afterObjectId),
    ]);
    return {
      serviceId,
      repoPath,
      filePath: edit.path,
      status:
        edit.beforeObjectId === null ? 'create' : edit.afterObjectId === null ? 'delete' : 'modify',
      diff: '',
      preContent,
      postContent,
    };
  } catch (error) {
    if (error instanceof RecordedEditTooLargeError) {
      throw error;
    }
    throw unavailable();
  }
}

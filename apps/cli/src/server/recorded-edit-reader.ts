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
  const unavailable = (reason: string, cause?: unknown) =>
    new RunChangedFilesContextError(
      `The recorded file versions are unavailable: ${reason}.`,
      serviceId,
      'GIT_READ_FAILED',
      undefined,
      { cause },
    );
  if (!edit.versionsRecorded) {
    throw unavailable('versions were not recorded for this edit');
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
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id)) {
        throw unavailable(`object id ${JSON.stringify(id.slice(0, 80))} is malformed`);
      }
      if (!retained.has(id)) {
        throw unavailable(`object ${id} is not retained under ${runAnchorRef(runId)}`);
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
    if (
      error instanceof RecordedEditTooLargeError ||
      error instanceof RunChangedFilesContextError
    ) {
      throw error;
    }
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw unavailable(`git read failed for ${edit.path} (${detail.slice(0, 300)})`, error);
  }
}

import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Articles copied from the canonical help source at build time (scripts/offline-docs.mjs). */
export const OFFLINE_DOC_FILES = {
  index: 'index.md',
  credentialStorage: 'protected-credential-store-failures.md',
  startupTroubleshooting: 'local-startup-troubleshooting.md',
} as const;

export interface OfflineDocs {
  directory: string;
  index: string;
  credentialStorage: string;
  startupTroubleshooting: string;
}

export type OfflineDocsLookup =
  | { found: true; docs: OfflineDocs }
  | { found: false; reason: string };

/** The documentation sits beside the bundle, as `release-manifest.json` sits above it. */
export async function bundledDocsDirectory(entryPoint = process.argv[1]): Promise<string> {
  return join(dirname(await realpath(entryPoint ?? '')), 'docs');
}

/** Only documentation written for this exact CLI version is cited; anything else is disclosed. */
export async function findOfflineDocs(
  directory: string,
  cliVersion: string,
): Promise<OfflineDocsLookup> {
  const docs: OfflineDocs = {
    directory,
    index: join(directory, OFFLINE_DOC_FILES.index),
    credentialStorage: join(directory, OFFLINE_DOC_FILES.credentialStorage),
    startupTroubleshooting: join(directory, OFFLINE_DOC_FILES.startupTroubleshooting),
  };
  try {
    const index = await readFile(docs.index, 'utf8');
    if (!index.includes(`CLI ${cliVersion}\n`) && !index.includes(`CLI ${cliVersion} `)) {
      return {
        found: false,
        reason: `Bundled documentation at ${directory} was written for a different CLI version than ${cliVersion}.`,
      };
    }
    for (const file of [docs.credentialStorage, docs.startupTroubleshooting]) {
      if (!(await stat(file)).isFile()) {
        throw Object.assign(new Error(), { code: 'ENOTFILE' });
      }
    }
    return { found: true, docs };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    return {
      found: false,
      reason: `Bundled documentation is not available at ${directory} (${code}); this is expected when running from source rather than an installed package.`,
    };
  }
}

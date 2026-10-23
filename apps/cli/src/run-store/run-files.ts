const RUN_INDEX_FILE_NAME = 'run-index.json';
export const RUN_FAMILY_MANIFEST_SUFFIX = '.family.json';

export const RUN_FAMILY_MEMBERS = [
  'metadata',
  'events',
  'toolUsage',
  'touchedFiles',
  'idempotency',
  'fileChangeFacts',
  'changedFilesDiagnostics',
] as const;

export type RunFamilyMember = (typeof RUN_FAMILY_MEMBERS)[number];

export const RUN_SIDECAR_SUFFIXES = [
  '.events.jsonl',
  '.tool-usage.json',
  '.touched-files.json',
  '.idempotency.json',
  '.file-change-facts.json',
  '.changed-files-diagnostics.json',
] as const;

const RUN_JSON_SIDECAR_SUFFIXES = RUN_SIDECAR_SUFFIXES.filter((suffix) => suffix.endsWith('.json'));

export const isRunMetadataFileName = (fileName: string): boolean =>
  fileName.endsWith('.json') &&
  fileName !== RUN_INDEX_FILE_NAME &&
  !fileName.endsWith(RUN_FAMILY_MANIFEST_SUFFIX) &&
  !RUN_JSON_SIDECAR_SUFFIXES.some((suffix) => fileName.endsWith(suffix));

export const isRunFamilyManifestFileName = (fileName: string): boolean =>
  fileName.endsWith(RUN_FAMILY_MANIFEST_SUFFIX);

export const runIdFromFamilyManifestFileName = (fileName: string): string =>
  fileName.slice(0, -RUN_FAMILY_MANIFEST_SUFFIX.length);

export const runIdFromMetadataFileName = (fileName: string): string =>
  fileName.slice(0, -'.json'.length);

export const runFamilyFileNames = (runId: string): string[] => [
  `${runId}.json`,
  ...RUN_SIDECAR_SUFFIXES.map((suffix) => `${runId}${suffix}`),
];

const MEMBER_SUFFIXES: Record<RunFamilyMember, string> = {
  metadata: '.json',
  events: '.events.jsonl',
  toolUsage: '.tool-usage.json',
  touchedFiles: '.touched-files.json',
  idempotency: '.idempotency.json',
  fileChangeFacts: '.file-change-facts.json',
  changedFilesDiagnostics: '.changed-files-diagnostics.json',
};

export const legacyRunFamilyMemberFileName = (runId: string, member: RunFamilyMember): string =>
  `${runId}${MEMBER_SUFFIXES[member]}`;

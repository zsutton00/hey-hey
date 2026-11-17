import type {
  ContainerEvidence,
  JournalCause,
  TroubleshootingEvidence,
} from './troubleshooting-evidence';
import type { OfflineDocsLookup } from './offline-docs';
import { sanitize, wrapText } from '../tui/text';

export const PROMPT_WINDOW_LINES = 14;
const PROMPT_COLUMNS = 90;

/** The prompt as screen rows; the screen and its scroll limit both use this one wrapping. */
export function promptRows(text: string): string[] {
  return wrapText(sanitize(text), PROMPT_COLUMNS);
}

const CREDENTIAL_CODES = new Set([
  'PLATFORM_UNAVAILABLE',
  'PERMISSION_DENIED',
  'DEFAULT_COLLECTION_MISSING',
  'STORAGE_LOCKED',
  'STORAGE_FAILURE',
  'CORRUPTED_DATA',
  'SERIALIZATION_ERROR',
]);

/** Single-line, control-free text so journal content can never reshape the prompt. */
function plain(value: string, max = 300): string {
  const collapsed = sanitize(value).replace(/\s+/gu, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function describeCause(cause: JournalCause): string {
  const details: string[] = [];
  if (cause.status !== undefined) {
    details.push(`HTTP ${String(cause.status)}`);
  }
  if (cause.exitCode !== undefined && cause.exitCode !== null) {
    details.push(`exit ${String(cause.exitCode)}`);
  }
  if (cause.signal) {
    details.push(`signal ${cause.signal}`);
  }
  const head = details.length > 0 ? `${cause.code} (${details.join(', ')})` : cause.code;
  const docker = cause.docker
    ? ` — docker ${plain(cause.docker.operation, 60)} ${cause.docker.outcome}: "${plain(cause.docker.detail)}"${cause.docker.truncated ? ' (output truncated)' : ''}`
    : '';
  const nested = cause.cause ? ` ← caused by ${describeCause(cause.cause)}` : '';
  return `${head}${docker}${nested}`;
}

function codesOf(cause: JournalCause): string[] {
  return [
    cause.code,
    ...(cause.docker ? [cause.docker.code] : []),
    ...(cause.cause ? codesOf(cause.cause) : []),
  ];
}

function describeContainer(item: ContainerEvidence): string {
  const label = `${item.service ?? 'service'}${item.containerIndex === undefined ? '' : ` #${String(item.containerIndex)}`}`;
  if (item.kind === 'local_startup_container') {
    if (item.reasonCode === 'container_collection_failed') {
      return `${label}: logs could not be collected${item.error ? ` (${describeCause(item.error)})` : ''}; no evidence from this container.`;
    }
    const groups = item.eventGroups ?? [];
    const codes = Object.entries(item.unstructuredCauseCodes ?? {});
    if (groups.length === 0 && codes.length === 0) {
      return `${label}: counts only (${String(item.scannedLines ?? 0)} lines scanned, ${String(item.unstructuredLines ?? 0)} unstructured). The real cause was not captured.`;
    }
    const events = groups.map(
      (group) =>
        `${group.level} ${plain(group.event ?? 'unnamed event', 80)}${group.cause ? ` [${describeCause(group.cause)}]` : ''} ×${String(group.count)}`,
    );
    const raw = codes.map(([code, count]) => `${code} ×${String(count)} in unstructured output`);
    const bounded = item.potentiallyTruncated
      ? ' (tail of the logs only; earlier lines not read)'
      : '';
    return `${label}: ${[...events, ...raw].join('; ')}${bounded}${item.omittedEventGroups ? `; ${String(item.omittedEventGroups)} more event group(s) omitted` : ''}`;
  }
  return `${label}: ${plain(item.kind, 60)}${item.reasonCode ? ` ${item.reasonCode}` : ''}`;
}

function containerLines(evidence: TroubleshootingEvidence): string[] {
  if (!evidence.containerCollected) {
    return [
      'Container diagnostics were not collected for this attempt. Collection runs after a handled failure and can be interrupted.',
    ];
  }
  const lines: string[] = [];
  for (const item of evidence.container) {
    if (item.kind === 'local_startup_collection') {
      if (item.reasonCode === 'collected') {
        lines.push(
          `Collected ${String(item.containerCount ?? 0)} container(s); ${String(item.omittedContainers ?? 0)} omitted by the two-per-service bound.`,
        );
      } else {
        lines.push(
          `Container diagnostics unavailable: ${item.reasonCode ?? 'unknown reason'}${item.error ? ` (${describeCause(item.error)})` : ''}.`,
        );
      }
    } else if (item.kind === 'local_startup_container') {
      lines.push(describeContainer(item));
    }
  }
  const pairing = evidence.container.filter((item) => item.kind.startsWith('local_pairing'));
  if (pairing.length > 0) {
    lines.push(`${String(pairing.length)} pairing evidence record(s) are in the journal.`);
  }
  return lines;
}

function causeLines(evidence: TroubleshootingEvidence): string[] {
  const lines: string[] = [];
  if (evidence.prerequisite) {
    lines.push(`Docker prerequisite check reported: ${evidence.prerequisite}.`);
  }
  for (const item of evidence.causes) {
    lines.push(
      `${plain(item.event, 80)}: ${describeCause(item.cause)}${item.count > 1 ? ` (recorded ×${String(item.count)})` : ''}`,
    );
  }
  if (lines.length === 0) {
    lines.push('No safe cause was recorded for this attempt. The cause is unknown.');
  }
  if (evidence.causes.some((item) => codesOf(item.cause).includes('UNCLASSIFIED_FAILURE'))) {
    lines.push(
      'UNCLASSIFIED_FAILURE means the original error text was deliberately not saved. Only the failing stage is known; treat the cause as unknown, not as a captured diagnosis.',
    );
  }
  return lines;
}

function recoveryLines(evidence: TroubleshootingEvidence): string[] {
  const lines: string[] = [];
  lines.push(
    evidence.earlierAttempts > 0
      ? `This is retry ${String(evidence.earlierAttempts)} in the same journal; earlier attempts in it ended without success.`
      : 'No retry is recorded before this attempt in its journal.',
  );
  if (evidence.repairFailed) {
    lines.push(
      'A Docker share repair was offered and attempted, and it failed (local.docker.repair_failed).',
    );
  } else if (evidence.repairOffered) {
    lines.push(
      'A Docker share repair was offered. The journal does not record whether it was accepted or declined.',
    );
  }
  if (evidence.lastFailedAttempt) {
    lines.push(
      `An earlier failed attempt exists: ${evidence.lastFailedAttempt.attemptId} (session ${evidence.lastFailedAttempt.sessionId}).`,
    );
  }
  if (evidence.laterSuccessAttemptId) {
    lines.push(
      `A later attempt (${evidence.laterSuccessAttemptId}) finished successfully, so this failure may already be resolved.`,
    );
  }
  return lines;
}

export interface PromptInputs {
  evidence: TroubleshootingEvidence;
  docs: OfflineDocsLookup;
  /** Present when the running CLI could be identified, to flag a journal written by another version. */
  runningCliVersion: string;
}

const bullets = (lines: string[]) => lines.map((line) => `- ${line}`);

/** Plain function over parsed evidence: the same text is shown, copied, saved and printed. */
export function buildTroubleshootingPrompt({
  evidence,
  docs,
  runningCliVersion,
}: PromptInputs): string {
  const v = evidence.versions;
  const allCodes = evidence.causes.flatMap((item) => codesOf(item.cause));
  const credentialRelated = allCodes.some((code) => CREDENTIAL_CODES.has(code));
  const dockerRelated =
    evidence.prerequisite !== null || evidence.causes.some((item) => item.cause.docker);
  const platform = [v.platform ?? 'unknown platform', v.architecture].filter(Boolean).join(' ');
  const gaps = [...evidence.gaps];
  if (v.cliVersion && v.cliVersion !== runningCliVersion) {
    gaps.push(
      `The journal was written by CLI ${v.cliVersion}, but CLI ${runningCliVersion} produced this prompt.`,
    );
  }

  const evidenceLocation = evidence.journalPath
    ? [
        `Journal for this attempt: ${evidence.journalPath}`,
        `All diagnostics (one JSON object per line, newest file last; earlier failed attempts are kept): ${evidence.directory}`,
      ]
    : [
        `No readable journal file exists for this attempt. The diagnostics directory would be: ${evidence.directory}`,
      ];
  const guidance = docs.found
    ? [
        `Offline guidance for CLI ${runningCliVersion} (works without a network or a running application): ${docs.docs.directory}`,
        `${docs.docs.index} — index`,
        `${docs.docs.credentialStorage} — protected credential storage${credentialRelated ? ' (most relevant to this failure)' : ''}`,
        `${docs.docs.startupTroubleshooting} — Docker, managed model folder and reading the journals${dockerRelated ? ' (most relevant to this failure)' : ''}`,
      ]
    : [`No bundled guidance is cited. ${docs.reason}`];

  const sections: Array<[string, string[]]> = [
    [
      'What failed',
      bullets([
        `Failed attempt ${evidence.attemptId} (session ${evidence.sessionId}) of \`heyhey local\`.`,
        `Last stage: ${evidence.lastStage ?? 'not recorded'}.`,
        `CLI ${v.cliVersion ?? 'unknown'}, Node ${v.nodeVersion ?? 'unknown'}, ${platform} (OS release ${v.osRelease ?? 'unknown'}).`,
        ...causeLines(evidence),
      ]),
    ],
    [
      'Runtime facts',
      bullets(
        evidence.readiness && evidence.readiness.length > 0
          ? evidence.readiness.map(
              (item) =>
                `${item.service}: ${item.present ? item.status : 'absent'}, health ${item.health}`,
            )
          : ['No application readiness observations were recorded.'],
      ),
    ],
    ['Container evidence', bullets(containerLines(evidence))],
    ['Recovery already attempted', bullets(recoveryLines(evidence))],
    [
      'What is missing or limited',
      bullets(gaps.length > 0 ? gaps : ['The journal reports no gaps for this attempt.']),
    ],
    [
      'Where the evidence is',
      [
        'If you can read files on my computer, start here. If you cannot (for example a remote chat), do not claim you can: use the facts above and ask me for excerpts.',
        ...bullets([...evidenceLocation, ...guidance]),
      ],
    ],
  ];

  const instructions = [
    'Read the evidence and the guidance. Separate what the evidence shows (facts) from what you suspect (hypotheses), and label each.',
    'If the cause is unknown or the evidence is truncated, say so rather than guessing.',
    'Keep my data and unrelated configuration unchanged. Ask me before any change that is disruptive, such as restarting a VM or service, and say what it interrupts.',
    'After a fix, verify by running `heyhey local` again and report what it shows.',
    'Never suggest storing credentials in plaintext, deleting credentials or the keyring, setting a model path, or editing Compose files.',
  ];

  return [
    '# Help me fix `heyhey local` setup',
    '',
    'Hey Hey could not finish starting on this computer and could not fix it automatically. Please diagnose it with me using the evidence below.',
    '',
    ...sections.flatMap(([title, lines]) => [`## ${title}`, ...lines, '']),
    '## How to help',
    ...instructions.map((line, index) => `${String(index + 1)}. ${line}`),
  ].join('\n');
}

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
    const bounded = item.potentiallyTruncated
      ? ' (tail of the logs only; earlier lines not read)'
      : '';
    if (groups.length === 0 && codes.length === 0) {
      return `${label}: counts only (${String(item.scannedLines ?? 0)} lines scanned, ${String(item.unstructuredLines ?? 0)} unstructured)${bounded}. The real cause was not captured.`;
    }
    const events = groups.map(
      (group) =>
        `${group.level} ${plain(group.event ?? 'unnamed event', 80)}${group.reasonCode ? ` (${plain(group.reasonCode, 80)})` : ''}${group.cause ? ` [${describeCause(group.cause)}]` : ''} ×${String(group.count)}`,
    );
    const raw = codes.map(([code, count]) => `${code} ×${String(count)} in unstructured output`);
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

/** Repair history across this attempt and its retries; an unrecorded outcome is said to be unknown. */
function repairLines(evidence: TroubleshootingEvidence): string[] {
  const lines: string[] = [];
  const attempts = [...new Set(evidence.repairs.map((step) => step.attempt))];
  for (const attempt of attempts) {
    const outcomes = evidence.repairs
      .filter((step) => step.attempt === attempt)
      .map((step) => step.outcome);
    const last = outcomes.at(-1);
    const where = `Attempt ${String(attempt)}${attempt === evidence.attemptNumber ? ' (this one)' : ''}`;
    const subsequent =
      attempt < evidence.attemptNumber
        ? ' A later attempt then failed, so it did not resolve this.'
        : '';
    if (last === 'applied') {
      lines.push(`${where}: a Docker share repair was accepted and applied.${subsequent}`);
    } else if (last === 'failed') {
      lines.push(`${where}: a Docker share repair was attempted and failed.`);
    } else if (last === 'declined') {
      lines.push(`${where}: a Docker share repair was offered and declined.`);
    } else if (last === 'accepted') {
      lines.push(
        `${where}: a Docker share repair was accepted; the journal does not record whether it completed (outcome unknown).`,
      );
    } else {
      lines.push(
        `${where}: a Docker share repair was offered; the journal does not record whether it was accepted or declined (outcome unknown).`,
      );
    }
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
  lines.push(...repairLines(evidence));
  for (const earlier of evidence.earlierFailures) {
    const causes = earlier.causes.map((item) => describeCause(item.cause));
    lines.push(
      `Attempt ${String(earlier.attempt)} failed earlier: ${causes.length > 0 ? causes.join('; ') : 'no safe cause was recorded'}.`,
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

const MAX_CONTAINER_LINES = 4;

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
    ? `Evidence files (one JSON object per line): this attempt's journal ${evidence.journalPath}; all journals, earlier failures included, in ${evidence.directory}`
    : `No readable journal exists for this attempt; journals would be in ${evidence.directory}`;
  const relevantDocs = docs.found
    ? [
        docs.docs.index,
        ...(credentialRelated ? [docs.docs.credentialStorage] : []),
        ...(dockerRelated || !credentialRelated ? [docs.docs.startupTroubleshooting] : []),
      ]
    : [];
  const guidance = docs.found
    ? `Offline guidance for CLI ${runningCliVersion} (no network needed): ${relevantDocs.join('; ')}`
    : `No bundled guidance is cited. ${docs.reason}`;
  const containers = containerLines(evidence);
  const shownContainers =
    containers.length > MAX_CONTAINER_LINES
      ? [
          ...containers.slice(0, MAX_CONTAINER_LINES),
          `${String(containers.length - MAX_CONTAINER_LINES)} more container line(s) are in the journal (container.evidence records).`,
        ]
      : containers;
  const services =
    evidence.readiness && evidence.readiness.length > 0
      ? `Services at the last readiness check: ${evidence.readiness
          .map((item) => `${item.service} ${item.present ? item.status : 'absent'}/${item.health}`)
          .join(', ')}.`
      : 'No application readiness observations were recorded.';

  return [
    '# Help me fix `heyhey local` setup',
    '',
    'Hey Hey could not start on this computer and could not fix it automatically. Diagnose it with me from the evidence below.',
    '',
    ...bullets([
      `Failed attempt ${evidence.attemptId} (session ${evidence.sessionId}); last stage: ${evidence.lastStage ?? 'not recorded'}.`,
      `CLI ${v.cliVersion ?? 'unknown'}, Node ${v.nodeVersion ?? 'unknown'}, ${platform} (OS release ${v.osRelease ?? 'unknown'}).`,
      ...causeLines(evidence),
      services,
      ...shownContainers,
      ...((evidence.browserTimeline ?? []).length > 0
        ? (evidence.browserTimeline ?? []).map(
            (item) =>
              `Browser ${item.observedAt ?? 'time unavailable'}${item.browserSequence ? ` #${String(item.browserSequence)}` : ''}: ${plain(item.state, 80)}${item.facts ? ` ${plain(JSON.stringify(item.facts), 600)}` : ''}`,
          )
        : ['Browser timeline was not captured; the journal cannot establish what the UI did.']),
      ...recoveryLines(evidence),
      ...(gaps.length > 0
        ? gaps.map((gap) => `Limit: ${gap}`)
        : ['Limit: the journal reports no gaps for this attempt.']),
      evidenceLocation,
      guidance,
    ]),
    '',
    'If you can read files on my computer, start with the evidence files. If you cannot (for example a remote chat), do not claim you can: use the facts above and ask me for excerpts.',
    'Separate facts from hypotheses and label each; say so when the cause is unknown. Keep my data and unrelated configuration unchanged, and ask before any disruptive change (say what it interrupts). Verify the fix by running `heyhey local` again.',
    'Never suggest storing credentials in plaintext, deleting credentials or the keyring, setting a model path, or editing Compose files.',
  ].join('\n');
}

/** One line for the banner: where it failed and what is known about why. */
export function failureHeadline(evidence: TroubleshootingEvidence): string {
  const first = evidence.causes[0];
  const why = first ? describeCause(first.cause) : (evidence.prerequisite ?? 'cause unknown');
  const where = evidence.lastStage ? ` while "${evidence.lastStage}"` : '';
  return `Failed${where}: ${why}`;
}

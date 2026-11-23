import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  ProviderNotInstalledError,
  isMissingExecutable,
} from '../../../server/model-catalog/provider-process';

const execFileAsync = promisify(execFile);
const PRINT_TIMEOUT_MS = 60_000;

/**
 * Why Antigravity cannot serve a read or a run. One vocabulary for the model
 * catalog, the skill read, the quota poller and the runner.
 *
 * `not_signed_in` is recorded (signed-out print-mode recordings: "authentication
 * failed or timed out"). `org_policy_denied` has no recording yet; it matches
 * wording about an organization or policy and must be checked against a real
 * org-blocked capture before it is trusted.
 */
export type AntigravityNotReadyCause = 'not_signed_in' | 'org_policy_denied';

const NOT_SIGNED_IN = /authenticat|sign(ed)?[ -]?in|log(ged)?[ -]?in|credential/i;
const ORG_POLICY =
  /organi[sz]ation|admin(istrator)?|polic(y|ies)|not (permitted|allowed)|disabled by/i;

export const classifyAntigravityFailure = (text: string): AntigravityNotReadyCause | null => {
  if (ORG_POLICY.test(text)) {
    return 'org_policy_denied';
  }
  if (NOT_SIGNED_IN.test(text)) {
    return 'not_signed_in';
  }
  return null;
};

const DIAGNOSTIC_MAX_CHARS = 300;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const SECRET_PAIR =
  /\b(token|code|key|secret|password|authorization|bearer|state|challenge)\b(\s*[=:]\s*|\s+)\S+/gi;

/**
 * Makes provider output safe for logs and the selector. `agy` prints OAuth
 * sign-in URLs whose query carries live parameters, so URLs and secret-looking
 * pairs are replaced and the rest is collapsed and capped. Redaction hides the
 * content, never the cause: classify first, then sanitize what is kept.
 */
export const sanitizeAntigravityDiagnostic = (text: string): string =>
  text
    .replace(URL_PATTERN, '<url>')
    .replace(SECRET_PAIR, '$1=<redacted>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DIAGNOSTIC_MAX_CHARS);

const CAUSE_MESSAGE: Record<AntigravityNotReadyCause, string> = {
  not_signed_in: 'Antigravity is not signed in. Sign in with `agy` on this machine, then retry.',
  org_policy_denied: "Antigravity is blocked by your organization's policy for this account.",
};

export class AntigravityNotReadyError extends Error {
  public constructor(
    public readonly cause_: AntigravityNotReadyCause,
    detail: string,
  ) {
    const safeDetail = sanitizeAntigravityDiagnostic(detail);
    super(`${CAUSE_MESSAGE[cause_]}${safeDetail ? ` (agy said: ${safeDetail})` : ''}`);
    this.name = 'AntigravityNotReadyError';
    this.detail = safeDetail;
  }

  /** Sanitized; the raw provider output is never kept on the error. */
  public readonly detail: string;
}

const printEnvelope = z
  .object({
    status: z.string(),
    response: z.string().optional(),
    error: z.string().optional(),
    command: z.object({ data: z.unknown().optional() }).passthrough().optional(),
  })
  .passthrough();

export interface AntigravityPrintResult {
  readonly response: string;
  /** Structured data the slash command attached to the envelope, when it did. */
  readonly commandData: unknown;
}

/**
 * Runs a read-only slash command through `agy -p`. A signed-out agy exits 1 with
 * an ERROR envelope; the cause is classified and the raw detail is kept for logs.
 */
export const runAntigravityPrint = async (
  slashCommand: string,
): Promise<AntigravityPrintResult> => {
  const cwd = await mkdtemp(join(tmpdir(), 'heyhey-agy-print-'));
  try {
    let stdout: string;
    let stderr = '';
    try {
      ({ stdout } = await execFileAsync('agy', ['-p', slashCommand, '--output-format', 'json'], {
        cwd,
        timeout: PRINT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      }));
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw new ProviderNotInstalledError('Antigravity', 'agy');
      }
      const failed = error as { stdout?: string; stderr?: string; message: string };
      stdout = failed.stdout ?? '';
      stderr = failed.stderr ?? failed.message;
    }
    return parsePrintOutput(slashCommand, stdout, stderr);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
};

export const parsePrintOutput = (
  slashCommand: string,
  stdout: string,
  stderr: string,
): AntigravityPrintResult => {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    json = undefined;
  }
  const envelope = printEnvelope.safeParse(json);
  if (!envelope.success) {
    const cause = classifyAntigravityFailure(stderr);
    if (cause) {
      throw new AntigravityNotReadyError(cause, stderr);
    }
    throw new Error(
      `agy ${slashCommand} did not answer with JSON. stdout: ${sanitizeAntigravityDiagnostic(stdout)} stderr: ${sanitizeAntigravityDiagnostic(stderr)}`,
    );
  }
  if (envelope.data.status !== 'SUCCESS') {
    const detail = envelope.data.error ?? stderr ?? envelope.data.status;
    const cause = classifyAntigravityFailure(`${detail} ${stderr}`);
    if (cause) {
      throw new AntigravityNotReadyError(cause, detail);
    }
    throw new Error(`agy ${slashCommand} failed: ${sanitizeAntigravityDiagnostic(detail)}`);
  }
  return { response: envelope.data.response ?? '', commandData: envelope.data.command?.data };
};

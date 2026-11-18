import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { version } from '../../package.json';
import { StructuredServerLogger } from '../server/logger';
import { Clipboard } from './clipboard';
import { bundledDocsDirectory, findOfflineDocs, type OfflineDocsLookup } from './offline-docs';
import type { StartupDiagnostics } from './startup-diagnostics';
import {
  evidenceUnavailable,
  readCurrentAttemptEvidence,
  readNewestFailureEvidence,
  type TroubleshootingEvidence,
} from './troubleshooting-evidence';
import { buildTroubleshootingPrompt, failureHeadline } from './troubleshooting-prompt';
import { safeStartupCause } from './startup-diagnostic-boundary';

const BANNER_WIDTH = 44;
export const PROMPT_FILE = 'troubleshooting-prompt.md';
export const TROUBLESHOOT_COMMAND = 'heyhey local troubleshoot';
export const defaultDiagnosticsDirectory = () =>
  join(homedir(), '.heyhey', 'local-application', 'diagnostics');

export interface PreparedPrompt {
  text: string;
  /** One line saying where it failed and why, for the banner. */
  headline: string;
  /** The same text, saved. Null when saving failed; `saveFailure` then says why. */
  savedPath: string | null;
  saveFailure: string | null;
}

/** Builds, saves, copies and prints the one troubleshooting prompt. Nothing leaves the computer. */
export class TroubleshootingPrompt {
  private readonly logger = new StructuredServerLogger({}, { component: 'local-troubleshooting' });

  private announced = false;

  constructor(
    private readonly clipboard = new Clipboard(),
    private readonly cliVersion = version,
    private readonly write: (text: string) => void = (text) => console.log(text),
    private readonly docsDirectory: () => Promise<string> = bundledDocsDirectory,
  ) {}

  /** After the screen closes the frame is gone, so say where the prompt is and how to see it again. */
  async announce(diagnostics: StartupDiagnostics): Promise<void> {
    this.announced = true;
    this.write(this.afterwards(await this.forCurrentAttempt(diagnostics)));
  }

  /** For failures that never reached the on-screen prompt: print all of it, then where it is saved. */
  async printUnlessAnnounced(diagnostics: StartupDiagnostics): Promise<void> {
    if (this.announced) {
      return;
    }
    this.print(await this.forCurrentAttempt(diagnostics));
  }

  /** A banner first so the failure stands out, then the prompt between clear copy markers. */
  print(prepared: PreparedPrompt): void {
    const rule = `+${'-'.repeat(BANNER_WIDTH)}+`;
    const title = '  !!  HEY HEY COULD NOT START';
    this.write(
      [
        '',
        rule,
        `|${title.padEnd(BANNER_WIDTH)}|`,
        rule,
        prepared.headline,
        '',
        'Want help? Copy everything between the markers into your coding agent (Claude Code, Codex, ...) and it will try to fix this with you.',
        '',
        '-------- COPY FROM HERE --------',
        prepared.text,
        '-------- COPY TO HERE ----------',
        '',
        this.afterwards(prepared),
      ].join('\n'),
    );
  }

  async forCurrentAttempt(diagnostics: StartupDiagnostics): Promise<PreparedPrompt> {
    let evidence: TroubleshootingEvidence;
    try {
      evidence = await readCurrentAttemptEvidence(diagnostics);
    } catch (error) {
      const code = safeStartupCause(error).code;
      this.logger.error('local.troubleshooting.evidence_unreadable', { error });
      evidence = evidenceUnavailable(
        { attemptId: diagnostics.attemptId, sessionId: diagnostics.sessionId },
        diagnostics.directory,
        `Journal evidence could not be read (${code}).`,
      );
    }
    return this.prepare(evidence);
  }

  /** The newest failed attempt on disk; null with the reason when there is none. */
  async forNewestFailure(
    directory = defaultDiagnosticsDirectory(),
  ): Promise<PreparedPrompt | { missing: string }> {
    const evidence = await readNewestFailureEvidence(directory);
    return 'missing' in evidence ? evidence : this.prepare(evidence);
  }

  async copy(prepared: PreparedPrompt): Promise<string> {
    const result = await this.clipboard.copy(prepared.text);
    if (result.copied) {
      return 'Copied to clipboard.';
    }
    this.logger.warn('local.troubleshooting.clipboard_unavailable', { cause: result.cause });
    return `Clipboard unavailable (${result.cause}). ${this.savedLine(prepared)}`;
  }

  savedLine(prepared: PreparedPrompt): string {
    return prepared.savedPath
      ? `Saved to ${prepared.savedPath}.`
      : `The prompt could not be saved (${prepared.saveFailure ?? 'unknown reason'}); select it on screen or run ${TROUBLESHOOT_COMMAND}.`;
  }

  /** What to say after the screen is gone: the saved path and how to get the prompt again. */
  afterwards(prepared: PreparedPrompt): string {
    return `Troubleshooting prompt: ${this.savedLine(prepared)} Show it again with: ${TROUBLESHOOT_COMMAND}`;
  }

  private async prepare(evidence: TroubleshootingEvidence): Promise<PreparedPrompt> {
    const text = buildTroubleshootingPrompt({
      evidence,
      docs: await this.docs(),
      runningCliVersion: this.cliVersion,
    });
    const headline = failureHeadline(evidence);
    try {
      const savedPath = await this.save(evidence.directory, text);
      return { text, headline, savedPath, saveFailure: null };
    } catch (error) {
      const code = safeStartupCause(error).code;
      this.logger.error('local.troubleshooting.save_failed', { error });
      return { text, headline, savedPath: null, saveFailure: code };
    }
  }

  private async docs(): Promise<OfflineDocsLookup> {
    try {
      return await findOfflineDocs(await this.docsDirectory(), this.cliVersion);
    } catch (error) {
      return {
        found: false,
        reason: `The installed package location could not be resolved (${safeStartupCause(error).code}).`,
      };
    }
  }

  /** Same no-symlink, owner-only rules as the journals; retention never sees this file. */
  private async save(directory: string, text: string): Promise<string> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw Object.assign(new Error(), { code: 'ELOOP' });
    }
    const target = join(directory, PROMPT_FILE);
    const temporary = join(directory, `${PROMPT_FILE}.${randomUUID()}.tmp`);
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await chmod(temporary, 0o600);
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    return target;
  }
}

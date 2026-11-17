import { lstat, readFile, open, rename, unlink, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isSeq, parseDocument } from 'yaml';
import { z } from 'zod/v4';
import type { DockerBoundary } from './docker-boundary';
import { DockerProcessError } from './docker-process';
import { StructuredServerLogger } from '../server/logger';

const profileSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u),
  runtime: z.string(),
  status: z.string(),
});
const configSchema = z
  .object({
    mounts: z.array(
      z.object({ location: z.string(), writable: z.boolean().optional() }).passthrough(),
    ),
  })
  .passthrough();

export interface ModelMountDiagnosis {
  message: string;
  repair?: ColimaMountRepair;
}

/** An offer holds the exact reviewed snapshot; decline never writes configuration. */
export class ColimaMountRepair {
  constructor(
    readonly profile: string,
    readonly configPath: string,
    readonly modelDirectory: string,
    private readonly snapshot: string,
    private readonly updated: string,
    private readonly docker: DockerBoundary,
  ) {}

  async apply(): Promise<void> {
    const lockPath = `${this.configPath}.heyhey-lock`;
    const lock = await open(lockPath, 'wx', 0o600);
    const temporary = `${this.configPath}.heyhey-${randomUUID()}`;
    try {
      const metadata = await lstat(this.configPath);
      if (
        !metadata.isFile() ||
        metadata.nlink !== 1 ||
        (process.getuid && metadata.uid !== process.getuid())
      ) {
        throw new Error(
          'Colima configuration must be an ordinary file owned by this user. No configuration changed.',
        );
      }
      const current = await readFile(this.configPath, 'utf8');
      if (current !== this.snapshot && current !== this.updated) {
        throw new Error(
          'Colima configuration changed since repair was offered. Retry to inspect the current shares.',
        );
      }
      if (current !== this.updated) {
        const backupPath = `${this.configPath}.heyhey-backup-${randomUUID()}`;
        const backup = await open(backupPath, 'wx', 0o600);
        try {
          await backup.writeFile(this.snapshot);
          await backup.sync();
        } finally {
          await backup.close();
        }
        const output = await open(temporary, 'wx', metadata.mode & 0o777);
        try {
          await output.writeFile(this.updated);
          await output.sync();
        } finally {
          await output.close();
        }
        const current = await readFile(this.configPath, 'utf8');
        if (current !== this.snapshot && current !== this.updated) {
          throw new Error(
            'Colima configuration changed while preparing repair. No configuration replaced.',
          );
        }
        await rename(temporary, this.configPath);
      }
      // Explicit profile, no mount flags: Colima reads the retained configuration.
      await this.docker.process.run(
        'colima',
        ['--profile', this.profile, 'restart'],
        'colima-restart',
      );
    } finally {
      await lock.close();
      await unlink(lockPath);
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
    }
  }
}

/** Runtime explanation is supplementary; the Docker failure always remains primary. */
export class DockerRuntimeRecovery {
  private readonly logger = new StructuredServerLogger({}, { component: 'local-docker' });
  constructor(private readonly docker: DockerBoundary) {}

  async diagnose(error: DockerProcessError, modelDirectory: string): Promise<ModelMountDiagnosis> {
    const safe = (value: string) => this.docker.process.safe(value);
    if (
      !/bind (?:source path|mount)|invalid mount config|mounts denied/iu.test(
        error.diagnostic.detail,
      ) ||
      !error.diagnostic.detail.includes(safe(modelDirectory))
    ) {
      return { message: '' };
    }
    const endpoint = this.docker.endpoint;
    const context = endpoint?.context ? `Context ${safe(endpoint.context)}. ` : '';
    if (!endpoint) {
      return {
        message: `${context}Runtime inspection unavailable: ${this.docker.endpointFailure ?? 'effective Docker endpoint unknown'}. Make the managed model directory ${safe(modelDirectory)} visible to the active Docker daemon, then retry.`,
      };
    }
    if (!endpoint.host.startsWith('unix://')) {
      return {
        message: `${context}Docker uses a remote or non-Unix endpoint (${safe(endpoint.host)}). The managed model directory ${safe(modelDirectory)} must exist on that daemon's host at the same path. Host existence does not establish daemon visibility. Select a local Docker engine with access to this directory, then retry.`,
      };
    }
    try {
      const host = await lstat(modelDirectory);
      if (!host.isDirectory()) {
        return {
          message: `The managed model location ${safe(modelDirectory)} is not a host directory. Restore access to the recorded installation directory, then retry.`,
        };
      }
      const colimaHome = resolve(
        this.docker.process.env['COLIMA_HOME'] ??
          join(this.docker.process.env['HOME'] ?? homedir(), '.colima'),
      );
      const socket = await realpath(endpoint.host.slice('unix://'.length));
      const rawProfiles = await this.docker.process.run(
        'colima',
        ['list', '--json'],
        'colima-inspect',
        undefined,
        undefined,
        10_000,
      );
      const profiles = rawProfiles
        .trim()
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          const value: unknown = JSON.parse(line);
          return z.array(profileSchema).parse(Array.isArray(value) ? value : [value]);
        });
      let profile: z.infer<typeof profileSchema> | undefined;
      for (const candidate of profiles) {
        if (candidate.runtime !== 'docker') {
          continue;
        }
        const candidateSocket = await realpath(
          join(colimaHome, candidate.name, 'docker.sock'),
        ).catch((cause: unknown) => {
          this.logger.warn('local.docker.inspection_failed', {
            error: this.docker.process.inspectionError(cause),
          });
          return undefined;
        });
        if (candidateSocket === socket) {
          profile = candidate;
          break;
        }
      }
      if (!profile) {
        return {
          message: `${context}The active local Docker socket is not an identified Colima profile. The model exists on this computer, but Docker refused its mount. Share ${safe(modelDirectory)} with the active engine at the same path and retry.`,
        };
      }
      // Colima SSH executes a shell command; quote the recorded path as one shell word.
      const quoted = `'${modelDirectory.replaceAll("'", "'\\''")}'`;
      const visibility = (
        await this.docker.process.run(
          'colima',
          [
            '--profile',
            profile.name,
            'ssh',
            '--',
            `if test -d ${quoted}; then printf visible; else printf absent; fi`,
          ],
          'colima-visibility',
          undefined,
          undefined,
          10_000,
        )
      ).trim();
      if (visibility !== 'visible' && visibility !== 'absent') {
        throw new Error('Colima visibility inspection returned an invalid response');
      }
      const version =
        (
          await this.docker.process.run(
            'colima',
            ['version'],
            'colima-version',
            undefined,
            undefined,
            10_000,
          )
        )
          .split('\n')[0]
          ?.trim() ?? 'unknown version';
      const configPath = join(colimaHome, profile.name, 'colima.yaml');
      const correction = `In ${safe(configPath)}, retain every existing mount and its options and add a mounts entry with location: ${JSON.stringify(safe(modelDirectory))} and writable: false. Restart only profile ${profile.name} with colima --profile ${profile.name} restart after confirming interruption of its other containers; then retry heyhey local.`;
      const prefix = `${context}The endpoint matches Colima profile ${profile.name} (${safe(profile.status)}; ${safe(version)}). The model exists on this computer; the VM reports it ${visibility === 'absent' ? 'absent' : 'present'}. `;
      if (visibility === 'visible') {
        return {
          message: `${prefix}A missing VM share is not established. Check the daemon's permissions for the exact bind source reported above; no share repair was offered.`,
        };
      }
      try {
        if (!/^colima version 0\.(?:[6-9]|10)\.\d+/u.test(version)) {
          throw new Error(`Automatic repair is unavailable for ${safe(version)}`);
        }
        const metadata = await lstat(configPath);
        if (!metadata.isFile() || metadata.size > 1024 * 1024) {
          throw new Error('Colima configuration is not a supported regular file');
        }
        const snapshot = await readFile(configPath, 'utf8');
        const document = parseDocument(snapshot, { uniqueKeys: true });
        if (document.errors.length > 0 || document.warnings.length > 0) {
          throw new Error('Colima configuration could not be parsed safely');
        }
        const config = configSchema.parse(document.toJS({ maxAliasCount: 0 }));
        const mounts = document.get('mounts');
        if (!isSeq(mounts)) {
          throw new Error('An explicit Colima mount list is required for automatic repair');
        }
        const modelPath = resolve(modelDirectory);
        const covered = config.mounts.some((mount) => {
          const expanded =
            mount.location === '~' || mount.location.startsWith('~/')
              ? join(this.docker.process.env['HOME'] ?? homedir(), mount.location.slice(1))
              : mount.location;
          if (!isAbsolute(expanded)) {
            return false;
          }
          const location = resolve(expanded);
          return modelPath === location || modelPath.startsWith(`${location}${sep}`);
        });
        if (!covered) {
          mounts.add({ location: modelDirectory, writable: false });
        }
        return {
          message: `${prefix}${covered ? 'The configured share has not reached the VM. ' : 'The configured shares do not include the model directory. '}${correction}`,
          repair: new ColimaMountRepair(
            profile.name,
            configPath,
            modelDirectory,
            snapshot,
            covered ? snapshot : document.toString(),
            this.docker,
          ),
        };
      } catch (cause) {
        this.logger.warn('local.docker.inspection_failed', {
          error: this.docker.process.inspectionError(cause),
        });
        return { message: `${prefix}Automatic configuration repair is unavailable. ${correction}` };
      }
    } catch (cause) {
      this.logger.warn('local.docker.inspection_failed', {
        error: this.docker.process.inspectionError(cause),
      });
      const reason = this.docker.process.inspectionError(cause).message;
      return {
        message: `${context}${safe(reason)}. Docker's mount refusal remains the cause. Make ${safe(modelDirectory)} visible at the same path to the active daemon, preserving existing shares, then retry.`,
      };
    }
  }
}

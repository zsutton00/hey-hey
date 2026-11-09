import { chmod, mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { START_OVER_INSTRUCTIONS } from './compose';
import {
  releaseIdentitySchema,
  type ReleaseIdentity,
  type ReleaseManifest,
} from '../release/release-manifest';

const secretSchema = z.strictObject({
  admin: z.string().regex(/^[a-f0-9]{64}$/),
  api: z.string().regex(/^[a-f0-9]{64}$/),
  graph: z.string().regex(/^[a-f0-9]{64}$/),
  jwt: z.string().regex(/^[a-f0-9]{64}$/),
  encryption: z.string().regex(/^[a-f0-9]{64}$/),
  enrollmentCodeHmac: z.string().regex(/^[a-f0-9]{64}$/),
  signingKey: z.string().min(1),
});
export type InstallationSecrets = z.infer<typeof secretSchema>;

// Not strict: installations written before models were downloaded still carry a `modelDirectory`.
const installationSchema = z.object({
  release: releaseIdentitySchema,
});
export type Installation = z.infer<typeof installationSchema>;
const updateConsentSchema = z.strictObject({
  from: releaseIdentitySchema,
  target: releaseIdentitySchema,
});

export class InstallationStore {
  constructor(readonly directory: string) {}

  get composePath(): string {
    return join(this.directory, 'compose.json');
  }

  /** Developer-only infrastructure document for `heyhey local dev`; same project and volumes. */
  get devComposePath(): string {
    return join(this.directory, 'compose.dev.json');
  }

  async read(): Promise<Installation | undefined> {
    try {
      return installationSchema.parse(
        JSON.parse(await readFile(join(this.directory, 'installation.json'), 'utf8')),
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      throw new Error(
        `Hey Hey Local cannot read ${join(this.directory, 'installation.json')}, so it will not start and nothing has been changed or removed. If you have a copy of that file, put it back and run \`heyhey local\` again. If you have no copy: ${START_OVER_INSTRUCTIONS}`,
      );
    }
  }

  async prepare(release: ReleaseManifest): Promise<Installation> {
    const existing = await this.read();
    if (existing) {
      await this.secrets();
      return existing;
    }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    await this.createSecrets();
    const installation = { release };
    try {
      await writeFile(join(this.directory, 'installation.json'), JSON.stringify(installation), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
    }
    const persisted = await this.read();
    if (!persisted) {
      throw new Error(
        'Installation identity disappeared. Restore installation.json before retrying.',
      );
    }
    return persisted;
  }

  private async createSecrets(): Promise<void> {
    const key = generateKeyPairSync('ed25519')
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    const secret = () => randomBytes(32).toString('hex');
    const values: InstallationSecrets = {
      admin: secret(),
      api: secret(),
      graph: secret(),
      jwt: secret(),
      encryption: secret(),
      enrollmentCodeHmac: secret(),
      signingKey: Buffer.from(key).toString('base64'),
    };
    try {
      await writeFile(join(this.directory, 'secrets.json'), JSON.stringify(values), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
    }
    await this.secrets();
  }

  async secrets(): Promise<InstallationSecrets> {
    try {
      const path = join(this.directory, 'secrets.json');
      await chmod(path, 0o600);
      return secretSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch {
      throw new Error(
        `Hey Hey Local's secrets file ${join(this.directory, 'secrets.json')} is missing or unreadable. Your local data is still there, but it is locked with those secrets, so Hey Hey will not create new ones over it. If you have a copy of that file, put it back and run \`heyhey local\` again. If you have no copy, the existing local data cannot be opened; ${START_OVER_INSTRUCTIONS}`,
      );
    }
  }

  async recordUpdate(from: ReleaseIdentity, target: ReleaseIdentity): Promise<void> {
    await this.atomicWrite('update-consent.json', { from, target });
  }

  async updateConsent(): Promise<z.infer<typeof updateConsentSchema> | undefined> {
    try {
      return updateConsentSchema.parse(
        JSON.parse(await readFile(join(this.directory, 'update-consent.json'), 'utf8')),
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async adoptRelease(installation: Installation, release: ReleaseManifest): Promise<Installation> {
    const next = { ...installation, release };
    await this.atomicWrite('installation.json', next);
    await unlink(join(this.directory, 'update-consent.json'));
    return next;
  }

  private async atomicWrite(name: string, value: unknown): Promise<void> {
    const temporary = join(this.directory, `${name}.${process.pid}.tmp`);
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, join(this.directory, name));
  }

  async writeCompose(config: unknown, path: string = this.composePath): Promise<void> {
    await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
    await chmod(path, 0o600);
  }
}

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { CorruptedDataError, PlatformUnavailableError, StorageFailureError } from './errors';
import { pbkdf2Async, randomBytes, toBuffer, zeroBuffer } from './utils';

const ITERATIONS = 310_000;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

const isRecord = (value: object | null): value is Record<string, string | number> =>
  value !== null && typeof value === 'object';

interface EncryptedRecord {
  v: number;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

const toEncryptedRecord = (value: object | null): EncryptedRecord | null => {
  if (!isRecord(value)) {
    return null;
  }

  const version = value['v'];
  const salt = value['salt'];
  const iv = value['iv'];
  const tag = value['tag'];
  const data = value['data'];

  if (
    typeof version !== 'number' ||
    typeof salt !== 'string' ||
    typeof iv !== 'string' ||
    typeof tag !== 'string' ||
    typeof data !== 'string'
  ) {
    return null;
  }

  return { v: version, salt, iv, tag, data };
};

const execFileAsync = promisify(execFile);

/**
 * Record versions select the key derivation:
 *   - v1: `username | os.hostname() | homedir` (+ `/etc/machine-id` on Linux).
 *     macOS derives `os.hostname()` from the network when HostName is unset,
 *     so v1 records stop decrypting when the network changes. Read-only; a
 *     successful v1 read is re-saved as v2 by `readEncryptedFile`.
 *   - v2: `username | stable machine id | homedir`.
 */
const LEGACY_VERSION = 1;
const CURRENT_VERSION = 2;

const legacyDeviceSecret = async (): Promise<Buffer> => {
  const pieces = [os.userInfo().username, os.hostname(), os.homedir()];
  if (process.platform === 'linux') {
    try {
      const machineId = await fs.readFile('/etc/machine-id', 'utf8');
      pieces.push(machineId.trim());
    } catch {
      // best-effort
    }
  }
  return toBuffer(pieces.join('|'));
};

const readMachineId = async (): Promise<string> => {
  switch (process.platform) {
    case 'darwin': {
      const { stdout } = await execFileAsync('/usr/sbin/ioreg', [
        '-rd1',
        '-c',
        'IOPlatformExpertDevice',
      ]);
      const match = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(stdout);
      if (!match?.[1]) throw new Error('IOPlatformUUID not found in ioreg output.');
      return match[1];
    }
    case 'linux':
      return (await fs.readFile('/etc/machine-id', 'utf8')).trim();
    case 'win32': {
      const { stdout } = await execFileAsync('reg', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
      ]);
      const match = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(stdout);
      if (!match?.[1]) throw new Error('MachineGuid not found in registry output.');
      return match[1];
    }
    default:
      throw new Error(`No stable machine id source for platform ${process.platform}.`);
  }
};

let machineIdPromise: Promise<string> | null = null;

const machineId = (): Promise<string> => {
  machineIdPromise ??= readMachineId().catch((error: unknown) => {
    machineIdPromise = null;
    // Wrapped so a missing /etc/machine-id or ioreg binary (ENOENT) is not
    // mistaken by callers for a missing credential file.
    throw new PlatformUnavailableError(
      `Cannot read this machine's stable id on ${process.platform}`,
      error,
    );
  });
  return machineIdPromise;
};

const deviceSecret = async (): Promise<Buffer> =>
  toBuffer([os.userInfo().username, await machineId(), os.homedir()].join('|'));

const secretForVersion = (version: number): Promise<Buffer> => {
  if (version === CURRENT_VERSION) return deviceSecret();
  if (version === LEGACY_VERSION) return legacyDeviceSecret();
  throw new CorruptedDataError(
    `Unsupported encrypted credential record version ${String(version)}.`,
  );
};

export const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const ensureDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
};

export const encrypt = async (payload: Buffer): Promise<Buffer> => {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const secret = await deviceSecret();
  const key = await pbkdf2Async(secret, salt, ITERATIONS, KEY_LENGTH, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();

  zeroBuffer(secret);
  zeroBuffer(key);

  const record = {
    v: CURRENT_VERSION,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };

  return toBuffer(JSON.stringify(record));
};

interface DecryptedPayload {
  plaintext: Buffer;
  version: number;
}

const decrypt = async (payload: Buffer): Promise<DecryptedPayload> => {
  let parsed: EncryptedRecord;
  try {
    const decoded: object | null = JSON.parse(payload.toString('utf8'));
    const record = toEncryptedRecord(decoded);
    if (!record) {
      throw new Error('Invalid encrypted payload record.');
    }
    parsed = record;
  } catch (error) {
    throw new CorruptedDataError('Corrupted encrypted credential payload.', error);
  }

  const salt = Buffer.from(parsed.salt, 'base64');
  const iv = Buffer.from(parsed.iv, 'base64');
  const tag = Buffer.from(parsed.tag, 'base64');
  const data = Buffer.from(parsed.data, 'base64');
  const secret = await secretForVersion(parsed.v);
  const key = await pbkdf2Async(secret, salt, ITERATIONS, KEY_LENGTH, 'sha256');

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return { plaintext, version: parsed.v };
  } catch (error) {
    throw new CorruptedDataError(
      'Saved credential no longer matches this machine and cannot be decrypted (run `heyhey login` to sign in again)',
      error,
    );
  } finally {
    zeroBuffer(secret);
    zeroBuffer(key);
  }
};

export const secureWrite = async (filePath: string, payload: Buffer): Promise<void> => {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  await fs.writeFile(filePath, payload, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
};

/**
 * Reads and decrypts a credential file. A legacy (v1) record is re-saved under
 * the current derivation in place, keeping its file name and permissions.
 * Throws ENOENT as-is so callers can treat a missing file as absent.
 */
export const readEncryptedFile = async (filePath: string): Promise<Buffer> => {
  const { plaintext, version } = await decrypt(await fs.readFile(filePath));
  if (version !== CURRENT_VERSION) {
    try {
      await secureWrite(filePath, await encrypt(plaintext));
    } catch (error) {
      zeroBuffer(plaintext);
      throw new StorageFailureError(
        `Decrypted v${String(version)} credential but failed to re-save it as v${String(CURRENT_VERSION)}`,
        error,
      );
    }
  }
  return plaintext;
};

export const secureDelete = async (filePath: string): Promise<void> => {
  try {
    const stat = await fs.stat(filePath);
    const random = randomBytes(stat.size);
    await fs.writeFile(filePath, random);
    await fs.unlink(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
};

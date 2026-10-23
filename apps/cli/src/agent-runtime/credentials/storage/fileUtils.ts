import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await mkdir(directoryPath, { recursive: true, mode: DIRECTORY_MODE });
  await chmod(directoryPath, DIRECTORY_MODE).catch(() => {
    // Ignore chmod failures on platforms that do not support POSIX-style permissions.
  });
};

const ensureParentDirectory = async (filePath: string): Promise<void> => {
  await ensureDirectory(dirname(filePath));
};

export const writeJsonFileAtomic = async (filePath: string, value: unknown): Promise<void> => {
  await ensureParentDirectory(filePath);
  const tmpPath = join(
    dirname(filePath),
    `.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  await writeFile(tmpPath, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: FILE_MODE,
  });
  await chmod(tmpPath, FILE_MODE).catch(() => {
    // Ignore chmod failures on non-POSIX platforms.
  });
  await rename(tmpPath, filePath);
  await chmod(filePath, FILE_MODE).catch(() => {
    // Ignore chmod failures on non-POSIX platforms.
  });
};

export const readJsonFile = async <T>(filePath: string, fallbackValue: T): Promise<T> => {
  try {
    const content = await readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return fallbackValue;
  }
};

export const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

export const deleteFileIfPresent = async (filePath: string): Promise<void> => {
  await rm(filePath, { force: true }).catch(() => {
    // Ignore delete failures.
  });
};

export const ensureRestrictedFile = async (filePath: string): Promise<void> => {
  await ensureParentDirectory(filePath);
  const exists = await fileExists(filePath);
  if (!exists) {
    await writeFile(filePath, '', {
      encoding: 'utf8',
      mode: FILE_MODE,
      flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    }).catch(() => {
      // If a race created the file first, continue.
    });
  }
  await chmod(filePath, FILE_MODE).catch(() => {
    // Ignore chmod failures on non-POSIX platforms.
  });
};

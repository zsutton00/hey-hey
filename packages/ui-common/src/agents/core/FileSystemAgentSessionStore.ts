import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AgentSessionMetadata,
  AgentSessionStore,
} from "./AgentSessionStore";
import type { AgentSessionId } from "./types";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

const defaultSessionsDir = (): string =>
  join(process.env.HEYHEY_HOME_DIR ?? join(homedir(), ".heyhey"), "sessions");

const toSessionFileName = (sessionId: AgentSessionId): string =>
  `${sessionId}.session.json`;

const toSessionFilePath = (
  baseDir: string,
  sessionId: AgentSessionId
): string => join(baseDir, toSessionFileName(sessionId));

interface SessionFileDocument<TSessionMetadata extends AgentSessionMetadata> {
  sessionId: AgentSessionId;
  metadata: TSessionMetadata;
}

export interface FileSystemAgentSessionStoreOptions {
  baseDir?: string;
}

export class FileSystemAgentSessionStore<
  TSessionMetadata extends AgentSessionMetadata = AgentSessionMetadata
> implements AgentSessionStore<TSessionMetadata>
{
  private readonly baseDir: string;

  constructor(options: FileSystemAgentSessionStoreOptions = {}) {
    this.baseDir = options.baseDir ?? defaultSessionsDir();
  }

  async persist(
    sessionId: AgentSessionId,
    metadata: TSessionMetadata
  ): Promise<void> {
    await this.ensureBaseDir();
    const filePath = toSessionFilePath(this.baseDir, sessionId);
    const tempPath = join(
      this.baseDir,
      `.${toSessionFileName(sessionId)}.${Date.now()}.tmp`
    );
    const payload: SessionFileDocument<TSessionMetadata> = {
      sessionId,
      metadata,
    };

    await writeFile(tempPath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
      mode: FILE_MODE,
    });
    await chmod(tempPath, FILE_MODE).catch(() => {
      // Ignore chmod failures on non-POSIX systems.
    });
    await rename(tempPath, filePath);
    await chmod(filePath, FILE_MODE).catch(() => {
      // Ignore chmod failures on non-POSIX systems.
    });
  }

  async retrieve(sessionId: AgentSessionId): Promise<TSessionMetadata | null> {
    const filePath = toSessionFilePath(this.baseDir, sessionId);

    try {
      const content = await readFile(filePath, "utf8");
      const parsed = JSON.parse(
        content
      ) as SessionFileDocument<TSessionMetadata>;
      return parsed.metadata;
    } catch {
      return null;
    }
  }

  async listSessionIds(): Promise<AgentSessionId[]> {
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      return entries
        .filter(
          (entry) => entry.isFile() && entry.name.endsWith(".session.json")
        )
        .map(
          (entry) =>
            entry.name.replace(/\.session\.json$/, "") as AgentSessionId
        );
    } catch {
      return [];
    }
  }

  async clear(): Promise<void> {
    await rm(this.baseDir, { recursive: true, force: true });
  }

  private async ensureBaseDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true, mode: DIRECTORY_MODE });
    await chmod(this.baseDir, DIRECTORY_MODE).catch(() => {
      // Ignore chmod failures on non-POSIX systems.
    });
  }
}

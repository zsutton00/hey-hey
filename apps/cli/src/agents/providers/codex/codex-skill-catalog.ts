import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { z } from 'zod';
import type { CodexSdkSkillTurnInput } from '../../../agent-runtime/index';
import type {
  AgentSkillCatalog,
  AgentSkillCatalogEntry,
  AgentSkillSelection,
} from '../agent-skills';

const skillScopeSchema = z.enum(['user', 'repo', 'system', 'admin']);

const skillInterfaceSchema = z.object({
  brandColor: z.string().nullable().optional(),
  defaultPrompt: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  iconLarge: z.string().nullable().optional(),
  iconSmall: z.string().nullable().optional(),
  shortDescription: z.string().nullable().optional(),
});

const skillToolDependencySchema = z.object({
  command: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  transport: z.string().nullable().optional(),
  type: z.string(),
  url: z.string().nullable().optional(),
  value: z.string(),
});

const skillDependenciesSchema = z.object({
  tools: z.array(skillToolDependencySchema),
});

const skillMetadataSchema = z.object({
  dependencies: skillDependenciesSchema.nullable().optional(),
  description: z.string(),
  enabled: z.boolean(),
  interface: skillInterfaceSchema.nullable().optional(),
  name: z.string(),
  path: z.string(),
  scope: skillScopeSchema,
  shortDescription: z.string().nullable().optional(),
});

const skillErrorInfoSchema = z.object({
  message: z.string(),
  path: z.string(),
});

const skillsListEntrySchema = z.object({
  cwd: z.string(),
  errors: z.array(skillErrorInfoSchema),
  skills: z.array(skillMetadataSchema),
});

const skillsListResponseSchema = z.object({
  data: z.array(skillsListEntrySchema),
});

const rpcResponseSchema = z.object({
  id: z.union([z.number(), z.string()]),
  result: z.object({}).passthrough().optional(),
  error: z.object({ message: z.string().optional() }).passthrough().optional(),
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

export type CodexSkillScope = z.infer<typeof skillScopeSchema>;
export type CodexSkill = z.infer<typeof skillMetadataSchema>;
export type CodexSkillError = z.infer<typeof skillErrorInfoSchema>;
export type CodexSkillsListEntry = z.infer<typeof skillsListEntrySchema>;
export type CodexSkillsListResponse = z.infer<typeof skillsListResponseSchema>;

interface PendingResponse {
  id: number;
  resolve: (result: object) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CODEX_CLIENT_INFO: JsonObject = {
  clientInfo: {
    name: 'hey_hey_cli_skill_catalog',
    title: 'Hey Hey CLI Skill Catalog',
    version: '0.1.0',
  },
  capabilities: {
    experimentalApi: false,
    requestAttestation: false,
  },
};

/**
 * Read Codex's provider-owned local Skill catalog for one workspace.
 *
 * It uses the typed Codex app-server protocol directly and keeps provider-owned
 * paths inside the local adapter.
 */
export class CodexSkillCatalogReader {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private pendingResponse: PendingResponse | null = null;
  private requestId = 0;
  private readonly flights = new Map<string, Promise<CodexSkillsListResponse>>();
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly requestTimeoutMs = 10_000) {}

  listSkills(cwd: string): Promise<CodexSkillsListResponse> {
    const existing = this.flights.get(cwd);
    if (existing) return existing;
    const flight = this.queue.then(() => this.readSkills(cwd));
    this.flights.set(cwd, flight);
    this.queue = flight.then(
      () => undefined,
      () => undefined,
    );
    void flight.then(
      () => this.flights.delete(cwd),
      () => this.flights.delete(cwd),
    );
    return flight;
  }

  private async readSkills(cwd: string): Promise<CodexSkillsListResponse> {
    if (this.process) {
      throw new Error('Codex Skill catalog reader is already active');
    }

    this.requestId = 0;
    try {
      this.spawnProcess(cwd);
      await this.request('initialize', CODEX_CLIENT_INFO);
      this.writeNotification('initialized');

      const result = await this.request('skills/list', {
        cwds: [cwd],
        forceReload: true,
      });
      return skillsListResponseSchema.parse(result);
    } finally {
      await this.shutdown();
    }
  }

  private spawnProcess(cwd: string): void {
    const child = spawn('codex', ['app-server'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: catalogProcessEnvironment(),
    });
    this.process = child;

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.trim().length > 0) {
        process.stderr.write(`[codex app-server] ${text}`);
      }
    });

    child.on('error', (error) => {
      if (this.process !== child) return;
      this.rejectPending(new Error(`Codex app-server error: ${error.message}`));
    });

    child.on('close', (code, signal) => {
      if (this.process !== child) return;
      this.rejectPending(
        new Error(
          `Codex app-server exited before the request completed (code=${String(
            code,
          )}, signal=${String(signal)})`,
        ),
      );
      this.closeReadline();
      if (this.process === child) {
        this.process = null;
      }
    });

    if (!child.stdout) {
      throw new Error('Codex app-server stdout is unavailable');
    }

    this.readline = createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    this.readline.on('line', (line) => {
      if (this.process === child) this.handleLine(line);
    });
    child.stdin?.on('error', (error) => {
      if (this.process === child) this.rejectPending(error);
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      this.rejectPending(new Error('Codex returned invalid JSON'));
      return;
    }

    const parsed = rpcResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      // Notifications such as skills/changed are not needed for this
      // one-shot read. They are intentionally ignored by the catalog reader.
      return;
    }

    const response = parsed.data;
    const pending = this.pendingResponse;
    if (!pending || response.id !== pending.id) return;

    this.pendingResponse = null;
    clearTimeout(pending.timer);
    if (response.error) {
      pending.reject(new Error(`Codex ${response.error.message ?? 'request failed'}`));
      return;
    }
    if (!response.result) {
      pending.reject(new Error('Codex response did not contain a result'));
      return;
    }
    pending.resolve(response.result);
  }

  private request(method: string, params: JsonObject): Promise<object> {
    const stdin = this.process?.stdin;
    if (!stdin?.writable || stdin.destroyed) {
      return Promise.reject(
        new Error(`Cannot send ${method}: Codex app-server stdin is not writable`),
      );
    }
    if (this.pendingResponse) {
      return Promise.reject(new Error('Codex request already in flight'));
    }

    const id = ++this.requestId;
    return new Promise<object>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rejectPending(new Error(`Codex ${method} timed out`));
      }, this.requestTimeoutMs);
      this.pendingResponse = { id, resolve, reject, timer };
      try {
        stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      } catch (error) {
        this.pendingResponse = null;
        clearTimeout(timer);
        reject(
          new Error(
            `Failed to send ${method}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  private writeNotification(method: string): void {
    const stdin = this.process?.stdin;
    if (!stdin?.writable || stdin.destroyed) {
      throw new Error(`Cannot send ${method}: Codex app-server stdin is not writable`);
    }
    stdin.write(`${JSON.stringify({ method })}\n`);
  }

  private rejectPending(error: Error): void {
    const pending = this.pendingResponse;
    this.pendingResponse = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }

  private async shutdown(): Promise<void> {
    const child = this.process;
    this.rejectPending(new Error('Codex Skill catalog reader closed'));
    if (!child) {
      this.closeReadline();
      return;
    }

    const exited = new Promise<boolean>((resolve) => {
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.off('close', onExit);
        resolve(false);
      }, 1_000);
      child.once('close', onExit);
    });

    try {
      child.stdin?.end();
    } catch {
      // The child may have already closed its stdin after answering.
    }

    try {
      if (!(await exited)) child.kill('SIGKILL');
    } finally {
      this.closeReadline();
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.removeAllListeners('close');
      child.stderr?.removeAllListeners('data');
      if (this.process === child) this.process = null;
    }
  }

  private closeReadline(): void {
    this.readline?.close();
    this.readline = null;
  }
}

export type CodexSkillSelectionErrorCode =
  | 'PROVIDER_MISMATCH'
  | 'SKILL_UNAVAILABLE'
  | 'SKILL_AMBIGUOUS';

export class CodexSkillSelectionError extends Error {
  public constructor(
    public readonly code: CodexSkillSelectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CodexSkillSelectionError';
  }
}

const toCatalogEntry = (skill: CodexSkill): AgentSkillCatalogEntry => ({
  provider: 'codex',
  name: skill.name,
  catalogScope: skill.scope,
  description: skill.description,
  ...(skill.shortDescription !== undefined ? { shortDescription: skill.shortDescription } : {}),
  enabled: skill.enabled,
  ...(skill.interface !== undefined && skill.interface !== null
    ? {
        interface: {
          ...(skill.interface.brandColor !== undefined
            ? { brandColor: skill.interface.brandColor }
            : {}),
          ...(skill.interface.defaultPrompt !== undefined
            ? { defaultPrompt: skill.interface.defaultPrompt }
            : {}),
          ...(skill.interface.displayName !== undefined
            ? { displayName: skill.interface.displayName }
            : {}),
          ...(skill.interface.iconLarge !== undefined
            ? { iconLarge: skill.interface.iconLarge }
            : {}),
          ...(skill.interface.iconSmall !== undefined
            ? { iconSmall: skill.interface.iconSmall }
            : {}),
          ...(skill.interface.shortDescription !== undefined
            ? { shortDescription: skill.interface.shortDescription }
            : {}),
        },
      }
    : {}),
  ...(skill.dependencies !== undefined && skill.dependencies !== null
    ? {
        dependencies: {
          tools: skill.dependencies.tools.map((tool) => ({
            type: tool.type,
            value: tool.value,
            ...(tool.command !== undefined ? { command: tool.command } : {}),
            ...(tool.description !== undefined ? { description: tool.description } : {}),
            ...(tool.transport !== undefined ? { transport: tool.transport } : {}),
            ...(tool.url !== undefined ? { url: tool.url } : {}),
          })),
        },
      }
    : {}),
});

export type CodexSkillCatalogContext =
  | { policy: 'non_repository'; authorityId: string }
  | { policy: 'service_workspace'; authorityId: string; cwd: string };

// Explicit cwd is the only repository authority; inherited Git overrides must not redirect it.
const catalogProcessEnvironment = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const initializeIsolatedDirectory = promisify(execFile);

/** Owns pathless catalog projection and fresh local selection resolution. */
export class CodexSkillCatalog {
  private readonly flights = new Map<string, Promise<CodexSkillsListResponse>>();
  private queue: Promise<void> = Promise.resolve();
  public constructor(private readonly reader = new CodexSkillCatalogReader()) {}

  private read(context: CodexSkillCatalogContext): Promise<CodexSkillsListResponse> {
    const key = JSON.stringify([
      context.authorityId,
      context.policy,
      context.policy === 'service_workspace' ? context.cwd : null,
    ]);
    const active = this.flights.get(key);
    if (active) return active;
    const flight = this.queue.then(() => this.readContext(context));
    this.flights.set(key, flight);
    this.queue = flight.then(
      () => undefined,
      () => undefined,
    );
    void flight.then(
      () => this.flights.delete(key),
      () => this.flights.delete(key),
    );
    return flight;
  }

  private async readContext(context: CodexSkillCatalogContext): Promise<CodexSkillsListResponse> {
    if (context.policy === 'service_workspace') return this.reader.listSkills(context.cwd);
    const cwd = await mkdtemp(join(tmpdir(), 'heyhey-skill-catalog-'));
    try {
      // An empty private Git boundary prevents provider discovery from walking
      // into an incidental ancestor repository or inheriting repository Skills.
      await initializeIsolatedDirectory('git', ['init', '--quiet', '--template=', cwd], {
        timeout: 5_000,
        cwd,
        env: catalogProcessEnvironment(),
      });
      const result = await this.reader.listSkills(cwd);
      if (result.data.some((entry) => entry.skills.some((skill) => skill.scope === 'repo'))) {
        throw new Error('Provider returned repository Skills for an isolated catalog.');
      }
      return result;
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }

  public async list(context: CodexSkillCatalogContext): Promise<AgentSkillCatalog> {
    const response = await this.read(context);
    return {
      provider: 'codex',
      skills: response.data.flatMap((entry) => entry.skills.map(toCatalogEntry)),
      errors: response.data.flatMap((entry) =>
        entry.errors.map((error) => ({ provider: 'codex' as const, message: error.message })),
      ),
    };
  }

  public async resolve(
    context: CodexSkillCatalogContext,
    selection: AgentSkillSelection,
  ): Promise<CodexSdkSkillTurnInput> {
    if (selection.provider !== 'codex') {
      throw new CodexSkillSelectionError(
        'PROVIDER_MISMATCH',
        `Codex cannot resolve a Skill selected for provider ${selection.provider}.`,
      );
    }

    const response = await this.read(context);
    const matches = response.data.flatMap((entry) =>
      entry.skills.filter(
        (skill) =>
          skill.name === selection.name && skill.scope === selection.catalogScope && skill.enabled,
      ),
    );

    if (matches.length === 0) {
      throw new CodexSkillSelectionError(
        'SKILL_UNAVAILABLE',
        `Codex Skill ${selection.name} (${selection.catalogScope}) is unavailable in the active workspace.`,
      );
    }
    if (matches.length > 1) {
      throw new CodexSkillSelectionError(
        'SKILL_AMBIGUOUS',
        `Codex Skill ${selection.name} (${selection.catalogScope}) is ambiguous in the active workspace.`,
      );
    }

    const match = matches[0]!;
    return { type: 'skill', name: match.name, path: match.path };
  }
}

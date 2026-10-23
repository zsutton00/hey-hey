import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { HEYHEY_RESERVED_MCP_SERVER_NAMES } from '../../mcp-server-config';
import { NOOP_LOGGER, type ServerLogger } from '../../../server/logger';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);

const serverSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('stdio').optional(),
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      env: z.record(z.string()).optional(),
    })
    .catchall(jsonSchema),
  z
    .object({
      type: z.literal('http'),
      url: z.string().min(1),
      headers: z.record(z.string()).optional(),
    })
    .catchall(jsonSchema),
  z
    .object({
      type: z.literal('sse'),
      url: z.string().min(1),
      headers: z.record(z.string()).optional(),
    })
    .catchall(jsonSchema),
]);
const configSchema = z.object({ mcpServers: z.record(jsonSchema).optional() });
type ClaudeUserMcpServer = z.infer<typeof serverSchema>;
export interface ClaudeUserMcpConfig {
  mcpServers: Record<string, ClaudeUserMcpServer>;
  serverNames: string[];
  allowedTools: string[];
}

const RESERVED_NAMES = new Set<string>(HEYHEY_RESERVED_MCP_SERVER_NAMES);

/** Only mint-time user identities can grant server-wide tool admission. */
export const isMintedUserMcpTool = (toolName: string, serverNames: readonly string[]): boolean =>
  serverNames.some((name) => toolName.startsWith(`mcp__${name}__`));

/** Read user scope only; never load settings, project entries or token files. */
export const loadClaudeUserMcpConfig = async (
  logger: ServerLogger = NOOP_LOGGER,
): Promise<ClaudeUserMcpConfig> => {
  const mcpServers: Record<string, ClaudeUserMcpServer> = {};
  const empty = { mcpServers, serverNames: [], allowedTools: [] };
  let config: z.infer<typeof configSchema>;
  try {
    const path = join(process.env['CLAUDE_CONFIG_DIR'] || homedir(), '.claude.json');
    config = configSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    logger.debug('local.runner.claude.user_mcp_config.unavailable');
    return empty;
  }
  for (const [serverName, entry] of Object.entries(config.mcpServers ?? {})) {
    if (RESERVED_NAMES.has(serverName)) {
      logger.warn('local.runner.claude.user_mcp_config.reserved', { serverName });
      continue;
    }
    const parsed = serverSchema.safeParse(entry);
    if (!parsed.success) {
      logger.warn('local.runner.claude.user_mcp_config.invalid', { serverName });
      continue;
    }
    Object.defineProperty(mcpServers, serverName, {
      value: parsed.data,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const serverNames = Object.keys(mcpServers);
  logger.debug('local.runner.claude.user_mcp_config.loaded', { serverNames });
  return { mcpServers, serverNames, allowedTools: serverNames.map((name) => `mcp__${name}`) };
};

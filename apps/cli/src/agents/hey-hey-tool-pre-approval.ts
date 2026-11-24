import { HEYHEY_RESERVED_MCP_SERVER_NAMES } from './mcp-server-config';

export type HeyHeyMcpServerName = (typeof HEYHEY_RESERVED_MCP_SERVER_NAMES)[number];

export const HEY_HEY_PLATFORM_SERVER: HeyHeyMcpServerName = 'heyhey-platform';
export const HEY_HEY_SUBMISSION_SERVER: HeyHeyMcpServerName = 'heyhey-submission-tools';
export const HEY_HEY_BROWSER_SERVER: HeyHeyMcpServerName = 'heyhey-browser';

const HEY_HEY_SERVER_NAMES: ReadonlySet<string> = new Set(HEYHEY_RESERVED_MCP_SERVER_NAMES);

export const isHeyHeyMcpServer = (serverName: string | null | undefined): boolean =>
  serverName !== null && serverName !== undefined && HEY_HEY_SERVER_NAMES.has(serverName);

/** The qualified MCP tool name every provider's allow-list uses: `mcp__<server>__<tool>`. */
export const qualifyHeyHeyToolName = (server: HeyHeyMcpServerName, tool: string): string =>
  `mcp__${server}__${tool}`;

/** Whether a qualified `mcp__<server>__<tool>` name is on a Hey Hey server. */
export const isHeyHeyQualifiedToolName = (name: string): boolean =>
  HEYHEY_RESERVED_MCP_SERVER_NAMES.some(
    (server) => name.startsWith(`mcp__${server}__`) && name.length > `mcp__${server}__`.length,
  );

export interface HeyHeyTool {
  server: HeyHeyMcpServerName;
  tool: string;
  qualifiedName: string;
}

export interface HeyHeyToolMounts {
  /** Qualified platform tool names from the turn's platform proxy mount; absent when not mounted. */
  platformAllowedTools?: readonly string[] | undefined;
  /** Submission tool names active for this turn (short names). */
  activeSubmissionToolNames?: readonly string[] | undefined;
  /** Qualified browser tool names when a browser mount exists. */
  browserAllowedTools?: readonly string[] | undefined;
}

/**
 * The Hey Hey tools active for one turn, which run without an approval prompt in
 * every provider. Holds only Hey Hey tools: user rules (Always Approve,
 * Whitelist), built-ins and user MCP tools stay in each provider's own state.
 * Membership is exact on the whole qualified name; names are never split.
 */
export class HeyHeyToolPreApproval {
  static readonly empty = new HeyHeyToolPreApproval({});

  private readonly qualifiedNames: ReadonlySet<string>;

  constructor(mounts: HeyHeyToolMounts) {
    const submission = (mounts.activeSubmissionToolNames ?? []).map((tool) =>
      qualifyHeyHeyToolName(HEY_HEY_SUBMISSION_SERVER, tool),
    );
    const candidates = [
      ...(mounts.platformAllowedTools ?? []),
      ...submission,
      ...(mounts.browserAllowedTools ?? []),
    ];
    // Only names on a Hey Hey server qualify, whatever a mount carries.
    this.qualifiedNames = new Set(candidates.filter(isHeyHeyQualifiedToolName));
  }

  has(qualifiedName: string | null | undefined): boolean {
    return (
      qualifiedName !== null &&
      qualifiedName !== undefined &&
      this.qualifiedNames.has(qualifiedName)
    );
  }

  get size(): number {
    return this.qualifiedNames.size;
  }

  /** Each pre-approved tool split at its known Hey Hey server, for provider connectors. */
  tools(): HeyHeyTool[] {
    return this.sortedNames().flatMap((qualifiedName) => {
      const server = HEYHEY_RESERVED_MCP_SERVER_NAMES.find((name) =>
        qualifiedName.startsWith(`mcp__${name}__`),
      );
      return server
        ? [{ server, tool: qualifiedName.slice(`mcp__${server}__`.length), qualifiedName }]
        : [];
    });
  }

  /** Sorted qualified names, for logging and diagnostics. */
  sortedNames(): string[] {
    return [...this.qualifiedNames].sort();
  }
}

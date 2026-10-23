import type { McpToolUseCase } from '../mcp-server-config';
import { qualifyMcpToolName, resolveMcpToolNames } from '../mcp-server-config';

export interface ActivePlatformToolCatalogInput {
  useCase?: McpToolUseCase;
  additionalTools?: readonly string[];
  /** Exact short-name surface, replacing the use-case list for a narrowed child. */
  exactTools?: readonly string[];
}

export class ActivePlatformToolCatalog {
  readonly shortNames: readonly string[];
  readonly qualifiedNames: readonly string[];

  private readonly shortNameSet: ReadonlySet<string>;
  private readonly qualifiedNameSet: ReadonlySet<string>;

  constructor(input: ActivePlatformToolCatalogInput = {}) {
    const shortNames = input.exactTools
      ? [...new Set(input.exactTools)]
      : resolveMcpToolNames(input);
    const qualifiedNames = shortNames.map(qualifyMcpToolName);
    this.shortNames = shortNames;
    this.qualifiedNames = qualifiedNames;
    this.shortNameSet = new Set(shortNames);
    this.qualifiedNameSet = new Set(qualifiedNames);
  }

  has(toolName: string): boolean {
    return this.shortNameSet.has(toolName) || this.qualifiedNameSet.has(toolName);
  }

  normalize(toolName: string): string {
    const qualifiedPrefix = 'mcp__heyhey-platform__';
    return toolName.startsWith(qualifiedPrefix) ? toolName.slice(qualifiedPrefix.length) : toolName;
  }
}

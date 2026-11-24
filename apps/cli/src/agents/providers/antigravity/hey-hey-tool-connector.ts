import type { HeyHeyToolPreApproval } from '../../hey-hey-tool-pre-approval';
import { HEYHEY_RESERVED_MCP_SERVER_NAMES } from '../../mcp-server-config';

/**
 * Antigravity names an MCP call `mcp_<server>_<tool>`. Server and tool names
 * contain `_` and `-`, so that name cannot be split back reliably. The connector
 * goes forward instead: it renders each pre-approved qualified name in agy's
 * form and looks up the incoming name whole.
 */
export class AntigravityHeyHeyTools {
  private readonly qualifiedByAgyName = new Map<string, string>();

  constructor(preApproval: HeyHeyToolPreApproval) {
    for (const { server, tool, qualifiedName } of preApproval.tools()) {
      this.qualifiedByAgyName.set(`mcp_${server}_${tool}`, qualifiedName);
    }
  }

  /** The qualified name of a pre-approved Hey Hey tool, or undefined when agy's name is not one. */
  qualifiedName(agyToolName: string | undefined): string | undefined {
    return agyToolName === undefined ? undefined : this.qualifiedByAgyName.get(agyToolName);
  }
}

/** For diagnostics only: whether agy's name looks like a call to a Hey Hey server. */
export const looksLikeHeyHeyTool = (agyToolName: string | undefined): boolean =>
  agyToolName !== undefined &&
  HEYHEY_RESERVED_MCP_SERVER_NAMES.some((server) => agyToolName.startsWith(`mcp_${server}_`));

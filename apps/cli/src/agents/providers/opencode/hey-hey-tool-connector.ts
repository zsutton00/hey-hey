import {
  HEY_HEY_PLATFORM_SERVER,
  HEY_HEY_SUBMISSION_SERVER,
  type HeyHeyToolPreApproval,
} from '../../hey-hey-tool-pre-approval';

/**
 * OpenCode's `permission.asked` names an MCP tool either by its qualified name
 * or by its OpenCode tool id `<server>_<tool>`; no captured event settles which.
 * The connector renders each pre-approved qualified name in both forms and
 * looks the incoming name up whole, never splitting it.
 */
export class OpenCodeHeyHeyTools {
  private readonly qualifiedByPermission = new Map<string, string>();

  constructor(preApproval: HeyHeyToolPreApproval) {
    for (const { server, tool, qualifiedName } of preApproval.tools()) {
      this.qualifiedByPermission.set(qualifiedName, qualifiedName);
      this.qualifiedByPermission.set(`${server}_${tool}`, qualifiedName);
    }
  }

  /** The qualified name of a pre-approved Hey Hey tool, or undefined when the permission is not one. */
  qualifiedName(permission: string): string | undefined {
    return this.qualifiedByPermission.get(permission);
  }
}

/**
 * The key saved for an Always Approve or Whitelist decision. Platform and
 * submission tools keep their short names so rules saved before stay matching.
 */
export const openCodeRuleKey = (permission: string): string => {
  for (const server of [HEY_HEY_PLATFORM_SERVER, HEY_HEY_SUBMISSION_SERVER]) {
    const prefix = `mcp__${server}__`;
    if (permission.startsWith(prefix)) {
      return permission.slice(prefix.length);
    }
  }
  return permission;
};

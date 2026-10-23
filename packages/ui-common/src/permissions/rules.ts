import type { PermissionRule } from "./types";

export const rules: PermissionRule[] = [
  {
    match: { type: "FEATURE", parentTaskId: null },
    config: { requiresProposal: true, threshold: 2 },
  },
];

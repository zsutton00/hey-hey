import { HELP_DEMO_FALLBACK } from "@hey-hey/ui-common/components";
import type { HelpDemoMap } from "@hey-hey/ui-common/components";

import { CreateTaskStepDemo } from "./demos/CreateTaskStepDemo";
import { FirstAgentSessionStepDemo } from "./demos/FirstAgentSessionStepDemo";

/**
 * Builds the total help-demo map for the web platform.
 *
 * Each `HelpScenarioId` is mapped to a concrete `PlatformDemo` element or
 * `HELP_DEMO_FALLBACK`. The `Record<HelpScenarioId, ...>` type means adding a
 * scenario to the union is a compile error here until every platform supplies
 * an entry — totality is enforced statically.
 *
 * The install-agent-bridge scenario uses `HELP_DEMO_FALLBACK` here because its
 * terminal animations now live as named slots on the relevant checkpoints (see
 * the catalog's "install-terminal" and "heyhey-pair-terminal" slots).
 */
export function buildHelpDemoMap(
  organizationId: string,
  projectId: string,
): HelpDemoMap {
  return {
    "read-first-project": HELP_DEMO_FALLBACK,
    "install-agent-bridge": HELP_DEMO_FALLBACK,
    "features-ready": HELP_DEMO_FALLBACK,
    "create-a-service": HELP_DEMO_FALLBACK,
    "create-a-task": (
      <CreateTaskStepDemo
        organizationId={organizationId}
        projectId={projectId}
      />
    ),
    "first-agent-session": (
      <FirstAgentSessionStepDemo
        organizationId={organizationId}
        projectId={projectId}
      />
    ),
  };
}

/**
 * Re-exported for callers that need to express "no demo here" in tests or
 * future scenarios that intentionally lack one.
 */

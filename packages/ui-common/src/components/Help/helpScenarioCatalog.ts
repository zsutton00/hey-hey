/**
 * The shared help-scenario catalog.
 *
 * This module is the single source for onboarding scenario copy and ordering.
 * Every help surface — the daily-session empty-state intro view and the
 * in-project deep help page — reads its scenarios from here, so each scenario
 * is authored once and rendered consistently everywhere.
 *
 * Copy and ordering are lifted from the previous inlined setup-step list
 * (`SETUP_STEPS` in `ProjectSetupBriefing`).
 */

import type { ProjectFeatureNextStepKind } from "../../api";

/**
 * Closed set of onboarding help scenarios. Adding a scenario means adding a
 * member here; downstream maps keyed by this union (e.g. the platform demo
 * animation map) then fail to compile until every platform supplies an entry.
 */
export type HelpScenarioId =
  | "install-agent-bridge"
  | "features-ready"
  | "create-a-service"
  | "create-a-task"
  | "first-agent-session"
  | "read-first-project";

/**
 * Frames the merged features step: every feature with its overview, plus the
 * onboarding-generated next-step suggestions as walkthrough buttons. The
 * features and suggestions are injected at render time by the help
 * data-access capability; the catalog only carries the copy around them.
 */
export interface HelpScenarioFeatureNextStepsCopy {
  /** Pill label for each kind of suggested first artifact. */
  kindLabels: Record<ProjectFeatureNextStepKind, string>;
  /**
   * Card button label for starting the guided walkthrough; `{feature}` is
   * replaced with the Feature name.
   */
  startLabel: string;
  /** Line inviting the user to pick a suggested feature; shown only with suggestions. */
  invite: string;
  /** Copy shown in place of the list when the project has no features yet. */
  emptyState: string;
}

/**
 * Describes copy that interpolates the project's live features as a list of
 * clickable links. The live feature records are injected at render time by
 * the help data-access capability; the catalog only carries the static frame
 * around them.
 */
export interface HelpScenarioTemplatedCopy {
  /** Copy rendered before the live feature list. */
  lead: string;
  /** Copy rendered after the live feature list. */
  trail?: string;
  /** Copy shown in place of the list when the project has no features yet. */
  emptyState: string;
}

/**
 * Navigation destinations resolve through routing; commands run through the
 * host's typed action capability without masquerading as navigation.
 */
export type HelpActionId = "import-repository";
export type HelpScenarioCta =
  | {
      kind: "navigation";
      label: string;
      intent: string;
      disabled?: boolean;
      /** Leading button icon; the card maps each key to a fixed MUI icon. */
      icon?: "guide";
    }
  | { kind: "action"; label: string; action: HelpActionId };

/**
 * Closed set of slot identifiers a checkpoint can reference. The card resolves
 * each slot to a fixed component; adding a new slot is a typed change in both
 * the catalog and the card so the two stay in sync.
 */
export type HelpScenarioCheckpointSlot =
  "works-with-strip" | "install-terminal" | "heyhey-pair-terminal";

/**
 * One step inside a scenario's sub-flow. Checkpoints are rendered in order
 * under the scenario's main heading on every help surface; they carry their
 * own copy and optional CTA / command snippet / named slots, but never their
 * own numeric badge — only the parent scenario's number is shown.
 */
export interface HelpScenarioCheckpoint {
  /** Sub-header above the checkpoint body. */
  title: string;
  /** Body copy for the checkpoint. */
  body: string;
  /** Optional call-to-action button. */
  cta?: HelpScenarioCta;
  /** Optional inline monospace command guidance. */
  command?: string;
  /**
   * Named slots rendered between body and CTA in the order given (e.g. a
   * provider strip followed by a terminal animation). The card resolves each
   * slot to a fixed component via an exhaustive switch.
   */
  slots?: readonly HelpScenarioCheckpointSlot[];
}

/** A single onboarding scenario, authored once and rendered across help surfaces. */
export interface HelpScenarioEntry {
  /** Stable identifier; also keys demo animations and routing. */
  id: HelpScenarioId;
  /** Short heading shown on every help surface. */
  title: string;
  /** Substring of `title` styled as a name (e.g. a guide's name). */
  titleEmphasis?: string;
  /** One-line description shown beneath the title. */
  summary: string;
  /** Complete ordered procedure that remains readable without animation. */
  instructions: readonly string[];
  /**
   * Present only on scenarios whose copy interpolates the project's live
   * features. Omitted when the scenario uses its plain `summary` copy.
   */
  templatedCopy?: HelpScenarioTemplatedCopy;
  /**
   * Richer per-scenario explanation rendered on the deep help page. Authored
   * later in the unified help system work; intentionally absent on every seed
   * entry below.
   */
  deepContent?: string;
  /** Optional call-to-action for the scenario. */
  callToAction?: HelpScenarioCta;
  /**
   * Ordered sub-flow rendered in place of deepContent when present. The
   * scenario's summary and deepContent fields are still authored so deep-help
   * search can match against them.
   */
  checkpoints?: readonly HelpScenarioCheckpoint[];
  /**
   * Present only on the scenario that lists every feature with its overview
   * and the project's next-step suggestions as walkthrough buttons.
   */
  featureNextSteps?: HelpScenarioFeatureNextStepsCopy;
}

const SCENARIO_ENTRIES: Record<HelpScenarioId, HelpScenarioEntry> = {
  "install-agent-bridge": {
    id: "install-agent-bridge",
    title: "Install Agent Bridge",
    summary:
      "Hey Hey orchestrates a local coding agent on your machine, so you'll need one installed.",
    instructions: [
      "Install Node.js, then install the Hey Hey Agent Bridge on the computer you want to connect.",
      "Run `heyhey pair` in that computer's terminal and keep it open.",
      "Follow the link into your authenticated browser and claim the machine.",
      "Review the machine, create its passkey, then return to the terminal to confirm activation.",
    ],
    deepContent:
      "The Agent Bridge is a small local process that connects your code editor to Hey Hey. After installing the `heyhey` CLI (which requires Node.js), start pairing from that computer by running `heyhey pair`. The CLI opens a short-lived enrollment and sends you to the authenticated browser, where you claim the machine, review it, and create its passkey. Return to the originating terminal for the final local confirmation. Once paired, the bridge runs alongside Claude Code (or another supported coding tool) and relays session activity — task context, progress updates, and completions — between the AI agent and the platform. The bridge reconnects automatically on restart, so you only go through setup once per machine.",
    checkpoints: [
      {
        title: "Install Node.js",
        body: "The Agent Bridge runs on Node.js. If you don't already have it on your machine, install it first.",
        cta: {
          kind: "navigation",
          label: "Open Node.js installer",
          intent: "node-installer",
        },
      },
      {
        title: "Install the Bridge",
        body: "Download the Hey Hey Agent Bridge. It runs alongside your coding tool and relays session activity back to the platform.",
        slots: ["works-with-strip", "install-terminal"],
        cta: {
          kind: "navigation",
          label: "Download Agent Bridge",
          intent: "install-agent-bridge",
          disabled: true,
        },
      },
      {
        title: "Run `heyhey pair`",
        body: "From a terminal on the computer you want to connect, start the pairing ceremony and keep the terminal open for the final local confirmation.",
        slots: ["heyhey-pair-terminal"],
      },
      {
        title: "Claim the machine in your browser",
        body: "Follow the link printed by the CLI into the authenticated browser and claim the short-lived enrollment.",
      },
      {
        title: "Review and create the passkey",
        body: "Review the machine in the browser, create its passkey, then return to the originating CLI to confirm or decline activation locally.",
      },
    ],
  },
  "features-ready": {
    id: "features-ready",
    title: "Your features are ready",
    summary:
      "Review the features we've drafted to see what your project delivers.",
    instructions: [
      "Click the Features section header in the explorer sidebar.",
      "Review all of your features in the document view or the tree view.",
      "Open each feature to check its scope, requirements, and planned work.",
      "Start a discussion at any time to plan future work with an agent.",
    ],
    templatedCopy: {
      lead: "We've drafted the features that describe what your project delivers:",
      trail:
        "Open any feature to see what's planned and start shaping the work.",
      emptyState: "Your features will appear here once they've been drafted.",
    },
    deepContent:
      "Features are the named product concepts your project is built from — the distinct areas of work a teammate could recognize as real parts of the product. When an agent picks up a task, it navigates the feature tree to understand scope and context: a task under one feature means something different from a task under another. Define enough features to describe the main areas of your product before running agents; the tree can grow over time. Features don't need to be exhaustive — they need to be real enough that an agent can place its work correctly.",
  },
  "create-a-service": {
    id: "create-a-service",
    title: "Add your first service",
    summary:
      "A service is how Hey Hey tracks one codebase in your project. Add one by giving it a name and a type — you'll point it at a directory on your machine later, when you start your first agent session.",
    instructions: [
      "Click the Services section header in the explorer sidebar.",
      "Click Create a Service located at the top right.",
      "Give the service a clear name and description, then select its type.",
      "Save the service; bind its local directory when you start an agent session.",
    ],
    callToAction: {
      kind: "navigation",
      label: "Add a service",
      intent: "create-service",
    },
    deepContent:
      "A service is the unit of work Hey Hey is pointed at: most often a codebase, with a type, language, and framework, though the concept is broader than code. It's usually the first thing you set up in a new project — before any code is written, you decide what you're working against, so a service can start as just a name and a type. Tasks, design docs, and agent sessions are all scoped to a service, which is how the platform organizes work by codebase ownership. The directory on disk where the code actually lives is bound later, during agent-session setup, so creating a service here is a lightweight first step, not a registration of an existing repository.",
  },
  "read-first-project": {
    id: "read-first-project",
    title: "Read the Your First Project guide",
    titleEmphasis: "Your First Project",
    summary:
      "Learn how to shape your feature tree, turn questions into tasks and plans, choose a coding-session mode, and build shared understanding.",
    instructions: [],
    callToAction: {
      kind: "navigation",
      label: "Open guide →",
      intent: "read-first-project",
      icon: "guide",
    },
  },
  "create-a-task": {
    id: "create-a-task",
    title: "Create a task",
    summary:
      "Open a feature and break it into tasks your coding agent can pick up.",
    instructions: [
      "Open the feature that owns the product outcome.",
      "Create one task for a coherent, session-sized implementation change.",
      "Add verifiable acceptance criteria and the implementation context needed to complete it.",
    ],
    deepContent:
      "A task is the unit of work an agent executes: a scoped problem, clear acceptance criteria, and enough context about how to approach it. Tasks live under features and inherit that feature's product context. A well-scoped task covers one coherent change — something an agent can complete in a single session without needing to ask questions. The acceptance criteria are the agent's definition of done; write them as things you can verify, not qualities you can sense. Implementation context (file paths, patterns to follow, constraints) makes the difference between an agent that drifts and one that lands.",
  },
  "first-agent-session": {
    id: "first-agent-session",
    title: "Run your first agent session",
    summary: "Hand a feature off to a coding agent and watch it work.",
    instructions: [
      "Open a ready task and start an agent session against the service it will change.",
      "Select the local code directory when prompted and begin the session.",
      "Follow progress in Hey Hey, then review the completed work and session record.",
    ],
    deepContent:
      "An agent session is one run of the AI working in your codebase on a task. You trigger it from the task; the bridge relays the request to your coding tool; the agent reads the task description and acceptance criteria, writes and runs code, and posts progress back to Hey Hey as it works. Sessions are observable in real time and leave a full record you can review afterward. The first session is also a calibration point: if the agent wanders or misses the mark, the task description usually needs tighter scope or more specific implementation context.",
  },
};

/** Scenario ids in presentation order. */
const SCENARIO_ORDER: readonly HelpScenarioId[] = [
  "install-agent-bridge",
  "features-ready",
  "read-first-project",
];

/** The onboarding scenarios in presentation order. */
export const HELP_SCENARIO_CATALOG: readonly HelpScenarioEntry[] =
  SCENARIO_ORDER.map((id) => SCENARIO_ENTRIES[id]);

/**
 * The features step of the feature-discovery Welcome. It lists every generated
 * feature with its overview and invites the user to be walked through one of
 * the suggested features, so it carries `featureNextSteps` copy in place of the
 * templated feature links.
 */
const FEATURE_DISCOVERY_FEATURES_READY: HelpScenarioEntry = {
  ...SCENARIO_ENTRIES["features-ready"],
  templatedCopy: undefined,
  instructions: SCENARIO_ENTRIES["features-ready"].instructions.slice(0, 3),
  featureNextSteps: {
    kindLabels: {
      TASKS: "Tasks",
      MOCKUPS: "Mockups",
      DIAGRAM: "Diagram",
    },
    startLabel: "Walk me through {feature} \u2192",
    invite:
      "Want a hand getting started? Pick one of the suggested features above and we'll walk you through starting a conversation about it, step by step.",
    emptyState: "Your features will appear here once they've been drafted.",
  },
};

/** Welcome scenarios for the feature-discovery route: always three steps. */
export function getFeatureDiscoveryWelcomeCatalog(): readonly HelpScenarioEntry[] {
  return [
    SCENARIO_ENTRIES["install-agent-bridge"],
    FEATURE_DISCOVERY_FEATURES_READY,
    SCENARIO_ENTRIES["read-first-project"],
  ];
}

/**
 * Welcome scenarios for projects created through the selected existing-work
 * onboarding route. These entries keep the shared scenario identities so the
 * existing data, demo, and routing capabilities continue to apply while the
 * copy reflects the next steps for an existing codebase.
 */
export const EXISTING_WORK_WELCOME_CATALOG: readonly HelpScenarioEntry[] = [
  SCENARIO_ENTRIES["install-agent-bridge"],
  {
    ...SCENARIO_ENTRIES["create-a-service"],
    title: "Bring in your first service",
    callToAction: {
      kind: "action",
      label: "Import my service",
      action: "import-repository",
    },
    summary:
      "Start with the first codebase you want Hey Hey to understand. Help will guide you through pairing and bringing that service into this project when you are ready.",
    instructions: [
      "Use the existing Help guidance to start the first-service setup.",
      "Pair the computer that holds the codebase, then follow the browser and local confirmation steps.",
      "Return to this project after setup so the service can ground the feature discussion.",
    ],
  },
  {
    ...SCENARIO_ENTRIES["features-ready"],
    title: "Discover your feature map",
    summary:
      "Use Help to explore the product areas that describe what this project delivers, then open a feature to understand its scope and decide what to explore next.",
    instructions: [
      "Open the feature guidance in Help and review the project's product areas.",
      "Open a feature to inspect its scope, requirements, and planned work.",
      "Use the linked feature pages to continue discovery before starting repository work.",
    ],
    templatedCopy: {
      lead: "Use Help to explore the features that describe what your project delivers:",
      trail:
        "Open any feature to understand its scope and decide what to ground next.",
      emptyState:
        "Your feature map will appear here as the project areas are defined.",
    },
  },
  SCENARIO_ENTRIES["read-first-project"],
];

/** Look up a single scenario entry by its id. */
export function getHelpScenario(id: HelpScenarioId): HelpScenarioEntry {
  return SCENARIO_ENTRIES[id];
}

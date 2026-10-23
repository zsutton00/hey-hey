import type {
  LocalSetSplittingPromptPayload,
  LocalSetSplittingService,
} from '../../shared/agent-bridge-contract/index';

const buildFeatureModeInstructions = (
  userGuidance?: string,
  services?: LocalSetSplittingService[],
): string => {
  const base = `Split mode: feature
Split the task into sub-tasks along feature boundaries. Each generated task should represent a distinct, independently deliverable feature slice.

Before finalizing the split, validate the proposed feature boundaries against the actual codebase. Surface-level reading of the task description is not enough — features that look distinct in prose often share state, modules, or contracts in code, and features that look unified often span clear seams. Use your code-search and read tools (and \`get_context\` on referenced services) to inspect the relevant repositories before deciding where to cut.${
    services?.length
      ? `

Referenced services to inspect (use these as the starting point for code exploration; do not treat this list as the split itself):
${formatServiceList(services)}`
      : `

If the task references specific services, inspect each of their repositories to ground your boundary decisions in real code.`
  }`;

  if (userGuidance) {
    return `${base}

User guidance for splitting:
${userGuidance}`;
  }

  return `${base}

No specific user guidance was provided. Identify the natural feature boundaries from the task description and acceptance criteria, validate them against the codebase, then split accordingly.`;
};

const formatServiceList = (services: LocalSetSplittingService[]): string =>
  services.map((s, i) => `${i + 1}. ${s.name} (id: ${s.id})`).join('\n');

const integrationSurfaceAnalysis = `Integration-surface analysis (do this before generating sub-tasks):
1. Describe how the services work together for this task — the request paths between them, the data that flows across the boundary, and any shared events or payloads they exchange.
2. Search the feature tree (use \`unified_search\` and \`get_context\`) for an existing contract, design doc, or feature that already captures the agreement at this boundary.
3. If the integration is new and undocumented, consider suggesting that the boundary be documented as a single source of truth — phrase this as a recommendation only; it must not block or gate the split.
4. Have each generated sub-task reference the agreement it depends on, either by mentioning the relevant feature or design doc (\`@[feature:id|name]\` / \`@[design_doc:id|title]\`) or, when no agreement exists yet, by carrying an inline \`needs documentation\` note in its description.`;

const buildServiceModeInstructions = (
  userGuidance?: string,
  services?: LocalSetSplittingService[],
): string => {
  if (services?.length) {
    const base = `Split mode: service
You MUST call create_work_item exactly ${services.length} times — once for each service listed below. Do NOT invent additional services, merge services, or split work along any other boundary.

Services (${services.length} total):
${formatServiceList(services)}

Each create_work_item call MUST correspond to exactly one service from this list. Include the service name in each task title.

${integrationSurfaceAnalysis}`;

    if (userGuidance) {
      return `${base}

User guidance for splitting:
${userGuidance}`;
    }

    return base;
  }

  const base = `Split mode: service
Split the task into sub-tasks along service boundaries. Identify every distinct service involved in delivering this task, then generate exactly one task per service. The total number of generated tasks MUST equal the number of identified services.

${integrationSurfaceAnalysis}`;

  if (userGuidance) {
    return `${base}

User guidance for splitting:
${userGuidance}`;
  }

  return base;
};

export const buildSetSplittingPrompt = (
  payload: LocalSetSplittingPromptPayload,
  options: { focalEntityId?: string } = {},
): string => {
  const splitInstructions =
    payload.splitMode === 'service'
      ? buildServiceModeInstructions(payload.userGuidance, payload.services)
      : buildFeatureModeInstructions(payload.userGuidance, payload.services);

  return `You are a task splitting agent. Your job is to decompose a parent task into 2 or more smaller, well-scoped sub-tasks.

You have access to a create_work_item tool. You MUST call create_work_item for each sub-task you generate.

## Canonical focal entity

The canonical focal entity projection is supplied before this workflow prompt. Use it as the parent task's authoritative description and acceptance criteria.

## Splitting instructions

${splitInstructions}

## Workflow

1. Analyze the parent task's description, acceptance criteria, and any provided context (design docs, evidence items, etc.).
2. Determine the split boundaries based on the split mode above.
3. For each sub-task, call the create_work_item tool with:
   - type: "STANDARD"
   - A clear, specific title
   - A description that explains the sub-task scope and how it relates to the parent
   - Acceptance criteria that are independently verifiable${options.focalEntityId ? `\n   - parentTaskId: "${options.focalEntityId}"` : ''}
4. After all create_work_item calls complete, give a brief natural-language explanation of why you chose these split boundaries.

## Rules

- Each task must have a non-empty title, description, and acceptanceCriteria.
- Tasks must collectively cover the parent task's full scope — no gaps, no overlaps.
- Each task must be independently deliverable and testable.
- Do not include work that falls outside the parent task's scope.
- Do not persist tasks — they are returned for user review only.
${payload.splitMode === 'service' ? (payload.services?.length ? `- CRITICAL: You MUST generate exactly ${payload.services.length} tasks — one per service listed above. Do not add, remove, or merge services.\n` : '- When splitting by service, the number of tasks MUST equal the number of services identified.\n') : '- When splitting by feature, the number of tasks is determined by the feature boundaries you discover — it is NOT tied to the number of services referenced.\n'}
After making all create_work_item calls, briefly explain the rationale for your chosen split boundaries in plain text. Do not output JSON.`;
};

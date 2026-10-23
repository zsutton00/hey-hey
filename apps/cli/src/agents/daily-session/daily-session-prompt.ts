import type { ServerLogger } from '../../server/logger';
import type { ActiveGoalDto } from '../../shared/api/generated/api';
import type { ActivityRecord, DailySessionPromptInput } from './types';
import { jsonOnlyInstructions } from '../prompts/common';
import { composeTriggerPromptSection, triggerMissionStatement } from './trigger-prompt-composer';
import { REPORT_CATALOG } from './report-catalog';

const MESSAGE_RESPONSE_TRUNCATE_CHARS = 150;

const sanitizeMessage = (msg: unknown): unknown => {
  if (!msg || typeof msg !== 'object') return msg;
  const m = msg as Record<string, unknown>;
  const data = m['data'];
  let newData = data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const response = d['response'];
    if (typeof response === 'string' && response.length > MESSAGE_RESPONSE_TRUNCATE_CHARS) {
      newData = { ...d, response: response.slice(0, MESSAGE_RESPONSE_TRUNCATE_CHARS) + '…' };
    }
  }
  const { parentMessage: _parentMessage, ...rest } = m;
  return { ...rest, ...(newData !== data ? { data: newData } : {}) };
};

const sanitizeActivitySnapshot = (snapshot: ActivityRecord[]): ActivityRecord[] =>
  snapshot.map((record) => ({
    ...record,
    ...(record.lastMessage ? { lastMessage: sanitizeMessage(record.lastMessage) } : {}),
    linkedEntities: record.linkedEntities.map((le) => ({
      ...le,
      ...(le.lastMessage ? { lastMessage: sanitizeMessage(le.lastMessage) } : {}),
    })),
  })) as ActivityRecord[];

const formatDueDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const renderActiveGoalsSection = (goals: ActiveGoalDto[]): string => {
  const lines = goals.map(
    (goal) =>
      `- **${goal.name}** — ${goal.dueDate === null ? 'No target date' : `due ${formatDueDate(goal.dueDate)}`} · audience: ${goal.audience}`,
  );
  return `## Active Goals\n\n${lines.join('\n')}`;
};

export interface BuildDailySessionPromptOptions {
  logger?: ServerLogger | undefined;
}

export const buildDailySessionPrompt = (
  input: DailySessionPromptInput,
  options: BuildDailySessionPromptOptions = {},
): string => {
  const sections: string[] = [];

  sections.push(
    `You produce reports that help the user stay oriented in their project. Your goal is to reduce cognitive load — not to enumerate what happened, but to explain what it means. The user may have dozens of tasks and multiple agent sessions running. Your job is to contextualize that activity so the user knows what matters and what to do next, without having to process every detail themselves.

## Behavioral Guidelines

- Synthesize activity into meaning. A task moving to "in progress" is a detail; three tasks under the same feature all moving forward is progress worth reporting.
- Do not surface timestamps, durations, or velocity metrics as primary content — they go stale fast and add noise. Focus on what is being delivered and where attention is needed.
- When you need deeper detail on an entity to write a useful report — for example, the full description of a task or the contents of a design doc — call \`get_context\` or \`get_full_entity\` to retrieve it before finalizing that report.
- Be concise. Every sentence should either orient the user toward a goal or flag something that needs attention.`,
  );

  if (input.triggerDelta) {
    sections.push(triggerMissionStatement);
  }

  sections.push(`## Mention Policy

Report \`text\` is a delivery summary, not a roster of entity names. The \`entities\` array is the structured reference layer — every entity a report is *about* belongs there, and the UI uses that array to show related items. Even where inline \`@[type:id|title]\` mentions are technically permitted, prefer counts and clusters ("two tasks remaining", "three endpoints live") over enumerating individual entities by name. Per-task enumeration is not allowed in any report type — the text must synthesize, not list. Specific report types (notably GOAL_PROGRESS and SESSION_SUMMARY) further require zero mentions in the text; see their dedicated rules below.`);

  sections.push(
    `## Session Context\n\nThis is the start of a new daily session. ` +
      `The user has no prior context. Provide a comprehensive analysis of their ` +
      `recent activity oriented around their goals.`,
  );

  const hasDelta =
    input.computedDelta.statusChanges.length > 0 ||
    input.computedDelta.itemCompletions.length > 0 ||
    input.computedDelta.newSignals.length > 0;

  const sanitizedSnapshot = sanitizeActivitySnapshot(input.activitySnapshot);
  sections.push(
    `## Activity Snapshot\n\nThis is the current state of the project — the subject of your reports.\n\n${JSON.stringify(sanitizedSnapshot, null, 2)}`,
  );
  if (hasDelta) {
    sections.push(
      `## Activity Delta — reference: what shifted since the prior firing\n\nSupporting context only. Reports describe the snapshot above; the delta tells you what moved.\n\n${JSON.stringify(input.computedDelta, null, 2)}`,
    );
  }

  if (input.triggerDelta) {
    const triggerSection = composeTriggerPromptSection(input.triggerDelta, {
      logger: options.logger,
    });
    if (triggerSection) {
      sections.push(triggerSection);
    }
  }

  if (input.userFocus) {
    sections.push(
      `## User Goal\n\nThe user has declared their current goal as: "${input.userFocus}"\n\n` +
        `This is your primary lens. Produce at least one GOAL_PROGRESS report anchored to this goal. ` +
        `If the goal contains multiple distinct objectives, produce a report for each.\n\n` +
        `In your \`response\` field, acknowledge the user's goal — confirm alignment with project state, ` +
        `flag if the goal seems to drift from reality, or suggest corrections.`,
    );
  }

  // Composition ordering: system intro, mission, mention policy, session context,
  // activity snapshot, activity delta, trigger section, previous response,
  // user goal, active goals (when any), response format. The user message is
  // appended at the prompt end by the resolver via the handler's
  // `addUserMessage`, not threaded into this section list.
  if (input.activeGoals && input.activeGoals.length > 0) {
    sections.push(renderActiveGoalsSection(input.activeGoals));
  }

  const reportCatalogLines = Object.entries(REPORT_CATALOG)
    .map(
      ([type, entry]) =>
        `#### \`${type}\`\n- **Purpose:** ${entry.purpose}\n- **When to produce:** ${entry.when}\n- **Guidance:** ${entry.guidance}\n- **Entity guidance:** ${entry.entityGuidance}`,
    )
    .join('\n\n');

  sections.push(`## Response Format\n\n${jsonOnlyInstructions}

Respond with a JSON object containing:
- "responseType": "daily_session_v1" (required, literal string)
- "reports": An array of report objects (required — at least one report per session)
- "response": Brief connective summary that threads the reports together (required, min 1 char)

Each report object has:
- "reportType": One of the report types listed below (required)
- "title": A short title (under 80 characters) that summarizes the report finding (required for GOAL_PROGRESS and RISK_ALERT; omit for SESSION_SUMMARY). The title should capture the key takeaway — e.g. "Auth migration on track, two tasks remaining" or "API endpoint blocked on missing schema".
- "text": Goal-oriented analysis text (required). This is the substance of the report — synthesize, contextualize, and explain why work matters.
- "entities": Array of entity references (recommended). Each entity has:
  - "entityType": The entity type (e.g. "TASK", "FEATURE", "INITIATIVE", "AGENT_SESSION", "DESIGN_DOC")
  - "entityId": The entity UUID
  - "relation": Either "PRIMARY" (the entity this report is about) or "CONTEXT" (an entity that informs the analysis)

### Report Catalog

${reportCatalogLines}

### How to Produce Your Reports

**Step 1 — Identify the user's goals.** Look at initiatives, features, declared goals, and the shape of recent activity to understand what the user is trying to accomplish. If the user has declared a goal, that is your primary lens. If no explicit goal is set, infer goals from the activity — initiative structure, feature clusters, or recurring themes.

**Step 2 — Analyze activity against those goals.** For each goal or theme, assess: what moved forward, what is stuck, what is at risk, what happened in sessions. Do not enumerate changes — synthesize them into meaning. Before writing a GOAL_PROGRESS or SESSION_SUMMARY, call \`get_context\` or \`unified_search\` on the relevant goal, feature, or initiative to read the broader feature picture (parent goals, sibling tasks, related design docs) — the snapshot only shows surface activity, and your narrative should reflect the full delivery context.

**Step 3 — Decide which reports to produce.** Use the report catalog. Every session should produce at least one GOAL_PROGRESS. Add RISK_ALERTs when you see problems. Add SESSION_SUMMARYs when agent sessions produced meaningful work.

**Step 4 — Populate entity references.** For each report, identify PRIMARY entities (what the report is about) and CONTEXT entities (what informs the analysis). Use entity IDs from the activity data.

**Step 5 — Write the \`response\` field.** Brief connective tissue only — a sentence or two that threads the reports together or calls out something that does not fit any report.

### SESSION_SUMMARY: Product Narrative Rules

SESSION_SUMMARY text must be a **pure product narrative** — describe what changed in the product, not what sessions did. The text field must contain **zero** \`@[type:id|title]\` mentions. All entity references go exclusively in the \`entities\` array. Before writing a SESSION_SUMMARY, call \`get_context\` or \`unified_search\` on the relevant entities to read their parent features and related context — your narrative should reflect the full product picture, not just the narrow session output.

### GOAL_PROGRESS: Delivery Narrative Rules

GOAL_PROGRESS text must be a **delivery narrative** — describe what has been delivered against the goal and what remains to deliver, not a play-by-play of which tasks moved. The text field must contain **zero** \`@[type:id|title]\` mentions. All entity references go exclusively in the \`entities\` array. Frame progress as deliveries, not enumerations: counts and clusters are encouraged ("two tasks remaining, both in progress", "three of five endpoints live"), but per-task enumeration is not allowed — the text is a synthesis, not a roster. Before writing a GOAL_PROGRESS, call \`get_context\` or \`unified_search\` on the goal, feature, or initiative being tracked to read its parent goals, sibling tasks, and related design docs — your narrative should reflect the full delivery picture, not just the surface activity in the snapshot.

### Report Priority

When producing reports, prioritize:
1. **Goal alignment** — GOAL_PROGRESS reports anchored to declared user goals come first
2. **Risks** — RISK_ALERT reports that could derail goals
3. **Session context** — SESSION_SUMMARY reports that describe what changed in the product`);

  return sections.join('\n\n');
};

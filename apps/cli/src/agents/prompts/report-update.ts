import { jsonOnlyInstructions } from './common';

export interface ReportUpdatePromptInput {
  /** Type of the report being updated (e.g. GOAL_PROGRESS). */
  reportType: string;
  /** Current title of the report, if any. */
  title?: string;
  /** Current text content of the report. */
  text: string;
  /** Entity refs currently declared on the report. */
  entities: Array<{ entityType: string; entityId: string; relation: string }>;
  /**
   * Entities that changed since the last update (the subset of `entities`
   * that triggered this incremental refresh).
   */
  changedEntities: Array<{ entityType: string; entityId: string }>;
  /** Accumulated platform events, in arrival order, that drove the threshold. */
  events: Array<Record<string, unknown>>;
}

export const buildReportUpdatePrompt = (input: ReportUpdatePromptInput): string => {
  const sections: string[] = [];

  sections.push(
    `You update a single existing report in place. The report already exists and has a stable audience; your job is to refresh its text (and title, if applicable) so it reflects what changed. You do **not** regenerate the report from scratch, produce additional reports, or change the report's entities list.`,
  );

  sections.push(`## Behavioral Guidelines

- Keep the report's voice, scope, and structure. Rewrite only what the changes make stale.
- Favor small, surgical edits. If most of the report is still accurate, keep it.
- If you need deeper detail on a changed entity, call \`get_context\` or \`get_full_entity\` before finalizing the update.
- If the changes make the report's framing itself obsolete, say so plainly in the new text — do not paper over a shift by leaving old claims intact.`);

  sections.push(`## Current Report

- **Report Type:** \`${input.reportType}\`
${input.title ? `- **Current Title:** ${input.title}\n` : ''}- **Current Text:**

${input.text}`);

  sections.push(`## Entities Tracked By This Report\n\n${JSON.stringify(input.entities, null, 2)}`);

  sections.push(
    `## Entities That Changed\n\nThese are the entities whose changes triggered this update. They are a subset of the tracked entities above — use them to decide which parts of the text are now stale.\n\n${JSON.stringify(input.changedEntities, null, 2)}`,
  );

  sections.push(
    `## Change Events\n\nPlatform events, in arrival order, that produced the changed-entity set. Use them only as evidence of what changed; do not enumerate them in the output.\n\n${JSON.stringify(input.events, null, 2)}`,
  );

  sections.push(`## Response Format\n\n${jsonOnlyInstructions}

Respond with a JSON object:
- "responseType": "report_update_v1" (required, literal string)
- "title": Optional updated title. Include only when the title would otherwise be misleading after the update. Omit when unchanged.
- "text": The complete updated report text (required, min 1 char). This fully replaces the current text.
- "summary": One sentence describing what you changed and why (required, min 1 char).`);

  return sections.join('\n\n');
};

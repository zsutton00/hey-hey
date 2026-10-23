export interface ReportCatalogEntry {
  purpose: string;
  when: string;
  guidance: string;
  entityGuidance: string;
}

export const REPORT_CATALOG: Record<string, ReportCatalogEntry> = {
  GOAL_PROGRESS: {
    purpose:
      'Tracks progress toward a specific goal, initiative, or thematic area. ' +
      'Synthesizes status across child tasks and related work into a coherent narrative.',
    when:
      'Produce when there is a meaningful goal or initiative with activity to report on. ' +
      'Produce multiple if distinct themes emerge or the user has set multiple goals. ' +
      'This is the default report type — most sessions should produce at least one.',
    guidance:
      'Frame progress as a delivery narrative: what has been delivered, what remains to deliver, ' +
      'and what stands between the two. "The auth refactor has shipped login and session refresh; ' +
      'the remaining work is password reset and MFA, both in progress" is the right shape. ' +
      'Counts and clusters are encouraged ("two tasks remaining", "three of five endpoints live"); ' +
      'per-task enumeration is not — the text is a synthesis, not a roster. ' +
      // Mention ban + context-gathering reinforced in the dedicated prompt section
      'Do NOT use @[type:id|title] mentions in the text — every entity reference must live ' +
      'exclusively in the `entities` array. The text must read as a clean, standalone delivery ' +
      'narrative with zero entity mentions. ' +
      'Before writing, call `get_context` or `unified_search` on the goal, feature, or initiative ' +
      'being tracked so your narrative reflects the full picture — parent goals, sibling tasks, ' +
      'related design docs — not just the surface activity in the snapshot.',
    entityGuidance:
      'PRIMARY = the goal, initiative, or feature being tracked. ' +
      'CONTEXT = tasks, sessions, or design docs whose activity informs the analysis. ' +
      'The entities array is the structured reference layer — put all entity ' +
      'references here, never in the text.',
  },
  RISK_ALERT: {
    purpose:
      'Flags a specific problem: drift from stated goals, scope creep, stale assumptions, ' +
      'blocked work, or contradictions between planned and actual direction.',
    when:
      'Produce when you identify something going wrong or about to go wrong. ' +
      'This is a warning, not a status update. Omit if there are no genuine risks to flag.',
    guidance:
      'Name the risk in terms of its impact on delivery, not its timeline. ' +
      '"The API migration has a blocked task with no owner" is better than ' +
      '"Task X has been blocked for 3 days." Focus on what could prevent the user ' +
      'from achieving their goal, not how long something has been in a particular state.',
    entityGuidance:
      'PRIMARY = the entity at risk or causing the risk. ' +
      'CONTEXT = related entities that provide evidence for the alert.',
  },
  SESSION_SUMMARY: {
    purpose:
      'A pure product narrative describing what changed in the product — ' +
      'user-facing behavior, technical capabilities, or system properties — ' +
      'as a result of recent agent sessions.',
    when:
      'Produce when agent sessions have shipped meaningful product changes. ' +
      'Distinct from GOAL_PROGRESS because it describes concrete product deltas, ' +
      'not goal status. Omit if sessions only produced planning or investigation.',
    guidance:
      'Write as a product changelog, not a session log. Describe what the product ' +
      'can now do, what changed for users or operators, or what technical surface shifted. ' +
      // Mention ban + context-gathering reinforced in the dedicated prompt section
      'Do NOT use @[type:id|title] mentions in the text — the text must read as a clean, ' +
      'standalone product narrative with zero entity references. ' +
      'Before writing, call `get_context` or `unified_search` on the entities involved ' +
      'to understand the full feature context — read parent features, sibling tasks, ' +
      'and related design docs so your narrative captures the broader product picture, ' +
      'not just the narrow session output.',
    entityGuidance:
      'PRIMARY = the agent session(s) whose work produced the product changes. ' +
      'CONTEXT = features, tasks, or design docs that frame the product area. ' +
      'The entities array is the structured reference layer — put all entity ' +
      'references here, never in the text.',
  },
};

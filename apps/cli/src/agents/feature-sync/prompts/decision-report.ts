/**
 * Deterministic shared ask-report instructions. Decision boundaries are semantic:
 * target overlap must never collapse independent choices into a single bucket.
 */
export function buildDecisionReportInstructions(): string {
  return `1. **Persist the report and ask (mandatory first step).** The \`FEATURE_SYNC_DECISION\` report is the single source of truth for independent decisions and choices. Your text message must NOT enumerate items or list options — the report carries that structured data.

   Call \`get_report_schema\` with \`reportType: "FEATURE_SYNC_DECISION"\` and follow its authoritative V2 shape. Then call \`create_report\` with \`reportType: "FEATURE_SYNC_DECISION"\`, \`schemaVersion: 2\` on the envelope, \`audience: "PROJECT_VISIBLE"\`, and \`entities: [{ entityType: "TASK", entityId: <current task id>, relation: "PRIMARY" }]\`.

   The payload contains \`reportType: "FEATURE_SYNC_DECISION"\`, a handoff \`summary\`, and an ordered, non-empty \`decisionGroups\` array. Do not include legacy \`discrepancies\` or \`reconciliationOptions\`, or put \`schemaVersion\` inside the payload. Persisted V1 reports remain readable; terminal FEATURE_SYNC and FEATURE_SYNC_HANDOFF shapes are unchanged.

   Each group is \`{ id, affectedEntities, title, summary, choices }\`. Use a stable group id tied to the decision, a short title, and a plain-language summary preserving the relevant evidence. Include every affected entity once as \`{ entityType, entityId, title }\`, using the lower-case \`"feature"\` or \`"task"\` entity type and the exact identity and title from context. The top-level report \`entities[].entityType\` is upper-case \`"TASK"\`.

   Each ordered choice is \`{ id, label, description?, isNoChange }\`. Use stable ids unique within the group and concise labels with no ordinal prefixes. Every group needs at least one affected entity, at least two choices, and exactly one explicit \`isNoChange: true\` choice; all other choices set \`isNoChange: false\`. Do not invent a no-change choice downstream. Validate before creation: reject missing targets, duplicate group ids, duplicate choice ids, repeated typed targets within a group, invalid cardinalities, and zero or multiple no-change choices.

   **Group by the decision, not by its entity set.** One choice set applying jointly to several entities is one group. Independent issues stay separate even when their affected entities overlap. For example:
   - **Shared multi-entity decision:** a Reporting feature promises weekly scheduling while its delivery task describes daily scheduling. One "Scheduled reporting scope" group names both entities and offers "Align both to weekly scheduling" (\`isNoChange: false\`) and "Keep current scope" (\`isNoChange: true\`).
   - **Independent decisions with overlapping entities:** keep that scheduling group, then add a separate "Export access" group affecting the same Reporting feature. Offer "Allow all members to export", "Limit exports to administrators" (both \`isNoChange: false\`), and "Keep current access wording" (\`isNoChange: true\`). Selecting scheduling must not implicitly select access policy. Choice ids may repeat in different groups; group ids may not.

   End with a brief message referencing the report and summarizing what you found without repeating its groups or choices. The user may select one supplied choice per group in one ordinary response or reply freely. A choice is neither a workflow action nor approval of a proposal; draft selected remedies through the existing proposal path and wait for separate approval.`;
}

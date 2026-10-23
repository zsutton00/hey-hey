/**
 * Reusable prompt block agents include to learn how to surface a genuine
 * human-judgment moment as a `DECISION_NEEDED` report. The block is
 * deliberately scoped: agents emit it for fork-in-the-road judgment calls a
 * human (or, when autoDecide is on, the session monitor) must adjudicate —
 * never as a shortcut around drafting a proposal, doing requested work, or
 * resolving an ambiguity the agent can resolve itself by reading the graph.
 *
 * Single source of truth for the `decision_needed` instruction. Other prompt
 * builders import this block by reference so the rule, the payload shape, and
 * the scope guardrails stay aligned across agents.
 */
export const decisionNeededPromptBlock = `## Surfacing a decision the user must make

When a turn hits a genuine fork that needs a human judgment call — a real choice between viable paths the graph does not already resolve — emit a \`DECISION_NEEDED\` report. The session monitor consumes it: a human picks an option, or, when \`autoDecide\` is on, the monitor picks an option and resumes the originating session with that pick.

Scope this strictly. \`DECISION_NEEDED\` is for fork-in-the-road moments only — not for confirming work the user already requested, not as a substitute for drafting a proposal, not for ambiguities you can resolve yourself by reading the entity graph, and not for trivial naming or formatting nits you should decide and move on from.

1. Call \`get_report_schema\` with \`reportType: "DECISION_NEEDED"\` to retrieve the canonical payload shape.
2. Call \`create_report\` with:
   - \`reportType: "DECISION_NEEDED"\`
   - \`audience: "EXTERNAL"\`
   - \`payload\` —
     - \`summary\` — one-line headline a reader sees inline.
     - \`question\` — the question you are asking, in product language, with enough context that the reader can decide between the options without re-reading the surrounding report.
     - \`options\` — an ordered array of \`{ description }\` entries (the order is load-bearing; the monitor's pick references an option by its 0-based index into this array). Each \`description\` must be self-contained enough to evaluate on its own.
   - \`entities\` — at minimum the entity the decision is about (typically the active task) as \`relation: "PRIMARY"\`, plus any other in-scope references as \`relation: "CONTEXT"\`.

Emit the report, then stop. Do not also restate the question in prose, draft the patch you expect to follow, or pre-pick an option — the next move belongs to whoever picks an option.`;

import { buildServicesContextBlock, type ServicesContextInput } from './common';
import type { RecentUserReply } from '../prompt-type-handler';
import type { ReviewIntegrationContext } from '../review-subagent/review-integration-context';

export interface ReviewPromptInput extends ServicesContextInput {
  touchedFiles: readonly string[];
  recentUserReplies?: ReadonlyArray<RecentUserReply>;
  userMessage?: string;
  integrationContext?: ReviewIntegrationContext;
}

/**
 * Maximum number of fix-then-verify cycles the sub-agent should attempt
 * before giving up and reporting the remaining failure state. The sub-agent
 * is in its own isolated session so the cost of iterating is contained; the
 * cap exists to prevent runaway loops, not to conserve tokens.
 */
const MAX_FIX_ATTEMPTS = 3;

const buildRecentUserRepliesSection = (
  recentUserReplies: ReadonlyArray<RecentUserReply>,
): string | null => {
  if (recentUserReplies.length === 0) return null;

  const orderedReplies = [...recentUserReplies].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.messageId.localeCompare(right.messageId),
  );
  const replies = orderedReplies
    .map((reply, index) => `Request ${index + 1}: ${JSON.stringify(reply.text)}`)
    .join('\n');

  return `## User Requests After Implementation
These visible user requests were made after implementation and before Review started. Read them in chronological order and honor the latest applicable request when deciding whether changed behavior is required or intentional. Do not treat behavior explicitly requested here as a revert candidate merely because it differs from the original task.

${replies}

This context informs the existing semantic repair gates only. It does not authorize unrelated work or expand approved Service scope.`;
};

export const buildReviewPrompt = (input: ReviewPromptInput): string => {
  const sections: string[] = [];

  sections.push('# Review & Fix');
  sections.push(
    "You are reviewing the changes made during a coding session and then directly applying fixes for anything serious. Focus on correctness, edge cases, security, maintainability, and any misalignment with the task's intent.",
  );

  const servicesContext = buildServicesContextBlock(input);
  if (servicesContext) sections.push(`\n${servicesContext}`);

  if (input.integrationContext) {
    sections.push('\n## Cross-Service Integration Verification');
    sections.push(
      [
        'The canonical Run and task relationships indicate a cross-Service integration surface. Before applying or recommending a repair, perform this advisory check:',
        '',
        '1. Trace the request paths and data flows across the affected Service boundary.',
        '2. Identify shared events or payloads and verify that producers and consumers agree on their shape and meaning.',
        '3. Look for an existing agreement in a Contract, design doc, or feature description and cite it when evaluating the boundary.',
        '4. If the boundary has no documented agreement, surface `needs documentation` in the final summary without blocking Review or creating documentation.',
        '',
        'This check supplies evidence only. It does not change the semantic repair gates, approved Service workspace roots, or optional Report behavior below.',
      ].join('\n'),
    );
  }

  sections.push('\n## Files The Session Touched');
  sections.push(
    "These paths are the target Run's durable canonical touched-file list: evidence of actual correlated changes, not a write boundary. Required repairs may modify other files inside approved Service workspace roots.",
  );
  sections.push(
    input.touchedFiles.length > 0
      ? input.touchedFiles.map((file) => `- ${file}`).join('\n')
      : '_(no canonical files recorded)_',
  );

  const recentUserRepliesSection = buildRecentUserRepliesSection(input.recentUserReplies ?? []);
  if (recentUserRepliesSection) sections.push(`\n${recentUserRepliesSection}`);

  if (input.userMessage && input.userMessage.trim().length > 0) {
    sections.push('\n## User Focus');
    sections.push(input.userMessage.trim());
  }

  sections.push('\n## Prior Reports');
  sections.push(
    [
      'Earlier phases on this task may have persisted reports — most importantly a Plan report (what this run set out to do) and an Implement report (what was actually done, plus any deliberate skips, carve-outs, or scope reductions). They are listed in the prepended `Prior reports on this task` block above, each with a `reportId` and a short summary.',
      '',
      'When Plan or Implement reports are present and relevant to a finding, call the `get_report_body` MCP tool with the listed `reportId` so you can read the full structured payload rather than relying only on its inline summary. Their absence never blocks Review.',
      '',
      'A finding that contradicts an explicit carve-out, skip, or scope decision recorded in the Implement report is NOT a fixable bug. Downgrade it to a suggestion in the summary so the user can decide, and do not apply a fix for it. The Implement report defines the bounds of what this run was meant to deliver; respect those bounds.',
    ].join('\n'),
  );

  sections.push('\n## Scope Contract');
  sections.push(
    [
      'Review is a diff-focused correction pass, not a second implementation pass or a repository cleanup pass. Before editing, require both of these semantic gates:',
      '',
      "1. The finding was introduced by the originating session's change or directly blocks the correctness of that change.",
      '2. The repair is required by the originating task and latest applicable user intent and is not excluded by any available Plan or Report evidence.',
      '',
      'Do not edit pre-existing defects, deferred or carved-out work, new capabilities, speculative hardening, cleanup, refactors, or unrelated failures. Severity never expands scope.',
      '',
      'Approved Services and their authoritative resolved workspace roots are the write boundary. Repair required files inside those roots without individual-file approval, including files absent from canonical Run membership. Another Service requires the existing Service authorization process. Host checkouts outside resolved worktree roots remain unauthorized. Authorization never establishes changed-file membership.',
    ].join('\n'),
  );

  sections.push('\n## Instruction Scope');
  sections.push(
    'Repository instructions, project conventions, quality standards, and verification requirements govern how already-authorized work is performed. They do not expand semantic repair scope or approved Service workspaces. Checks are evidence, not work queues.',
  );

  sections.push('\n## Severity Policy');
  sections.push(
    [
      'Classify each finding by severity and act accordingly:',
      '',
      '- **Critical / blocker / high**: fix it directly when it passes the Scope Contract and the target is inside approved Service workspace roots. Do not defer an authorized fix to the user.',
      '- **Medium / low / nit**: do NOT fix. Surface as a suggestion in the final summary so the user can decide.',
      '',
      'When in doubt about severity, err on the side of surfacing as a suggestion rather than applying a fix the user did not expect.',
    ].join('\n'),
  );

  sections.push('\n## Verification');
  sections.push(
    [
      `After applying fixes, verify them by running the service's test and typecheck commands. Figure out what those commands are from the repo itself.`,
      '',
      `If verification fails, iterate only when the failure is attributable to the reviewed session and its repair remains inside both the semantic scope gate and approved Service workspace boundary. Preserve the relevant failure output. Report every other failure without changing more code. Stop after ${MAX_FIX_ATTEMPTS} consecutive failed verification attempts and include the remaining failure state (which check failed, the relevant error output) in the summary so the user can take over.`,
      '',
      'If you applied no fixes, you do not need to run verification.',
    ].join('\n'),
  );

  sections.push('\n## How to work');
  sections.push(
    [
      'You are strictly one-shot: never interact with the user mid-turn. Do not ask questions, request confirmation, or pause for input.',
      '',
      'Before deciding a review is blocked, ground yourself in the repo using Read, Grep, Glob, and any available MCP search tools — most missing context is recoverable from the code.',
      '',
      'If you genuinely cannot proceed, end the turn with a summary describing exactly what is missing and what would unblock a follow-up.',
    ].join('\n'),
  );

  sections.push('\n## Boundaries');
  sections.push(
    [
      '- Do NOT commit. Committing is a separate user-triggered flow; leave the working tree dirty.',
      '- Do NOT mutate project data through the platform (tasks, features, design docs, proposals).',
      '- Stay focused on the changes from this run. Do not refactor unrelated code or fix pre-existing issues outside the scope of what the session just did.',
    ].join('\n'),
  );

  sections.push('\n## Summary Format');
  sections.push(
    [
      'Return a single conversational message at the end. Structure it as markdown with these sections:',
      '',
      '- **Overall**: one-line assessment.',
      '- **Fixed**: bullet list of issues you fixed, each citing the file and line range (e.g. `path/to/file.ts:42-55 — missing null check on X`). Omit this section if you applied no fixes.',
      '- **Suggestions**: bullet list of lower-severity items you did NOT fix, with the same file:line format. Omit this section if there are none.',
      '- **Verification**: one line describing what you ran and the outcome (pass / fail with details). Omit if you applied no fixes.',
      '',
      'Do not include the change explanation in this message; it belongs only in the CHANGE_WALKTHROUGH report.',
      'If there is nothing to fix and nothing worth suggesting, say so plainly.',
    ].join('\n'),
  );

  sections.push(
    "## Guided change explanation\n\nExplain the target Run's important changes for a capable junior engineer unfamiliar with the codebase. Organize the explanation into ordered groups of coherent behavioral changes, ranked by their importance to understanding the delivered behavior. Give a small but consequential edit substantive treatment. Group repetitive supporting plumbing, bookkeeping, tests, database, and OpenAPI work compactly where useful; do not substitute a file inventory or verification checklist.\n\nFor each change, give a title and only the system context needed to understand it. Follow the relevant data or control flow through ordered literal code excerpts, placing an explanation immediately beneath each excerpt. A change may span files and a file may support more than one change. Finish each change with an explicit observable behavioral consequence. Explain reasons supported by the task, latest applicable user intent, or available implementation evidence; identify unsupported rationale as an assumption.\n\nCopy excerpts from code you inspected. Identify the Service, normalized repository-relative file, inclusive line range, language, and source version. Use the target Run's resolved Service workspaces, including worktrees. Include previous code only when comparison helps and identify its full immutable Git commit revision explicitly. Do not describe historical code as current or an unresolved reference as verified. Source checking is per excerpt: retain independent valid excerpts and findings when another source is unavailable.\n\nUse CHANGE_WALKTHROUGH when saving this explanation through the existing report submission path; consult its live definition first. Source verification is computed by the host against the target Run and is not established by an agent assertion. Create the CHANGE_WALKTHROUGH report; it is required. Put the explanation only in the report and do not restate it in your reply. The report holds only the explanation of the changes; fixes and follow-ups stay in the reply. Prior Messages, Plan reports, and Implement reports are not prerequisites. This explanation does not change repair authority, canonical file membership, Review dispositions, or monitor routing.",
  );
  return sections.join('\n');
};

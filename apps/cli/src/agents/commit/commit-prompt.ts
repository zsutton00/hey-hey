import type { LocalCommitPromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import type { Prepared, ResolvedServiceBinding } from '../../shared/agent-bridge-contract/contract';

export const buildCommitPrompt = (payload: Prepared<LocalCommitPromptPayload>): string => {
  const services: ResolvedServiceBinding[] = payload.services ?? [];
  const changedFiles = payload.changedFiles ?? [];
  const sections = [
    '# Generate a Commit Message',
    '',
    'Return only a concise conventional-commit message for the session-owned changes below. The runtime owns validation, staging, commit execution, traceability trailers, and COMMIT report emission.',
  ];

  if (services.length > 0) {
    sections.push(
      '',
      '## Services',
      '',
      ...services.map((service) => `- **${service.id}**: \`${service.path}\``),
    );
  }

  sections.push('', '## Canonical Run Files', '');
  if (changedFiles.length === 0) {
    sections.push('- No uncommitted session-owned files were found.');
  } else {
    sections.push(...changedFiles.map((file) => `- ${file}`));
  }

  sections.push(
    '',
    '## Instructions',
    '',
    '1. Treat Canonical Run Files as the complete scope. Repository-wide status must never expand it.',
    '2. Use the current diffs for the listed files to understand what changed.',
    '3. You may inspect only the listed files and read-only git output (`status`, `diff`, `log`, `show`, or `rev-parse`) to understand the change.',
    '4. Do not stage files, create commits, construct trailers, or emit reports.',
    '5. Call `submit_commit_message` exactly once with a single-line conventional-commit message under 72 characters. Do not include trailers in the message.',
  );

  return sections.join('\n');
};

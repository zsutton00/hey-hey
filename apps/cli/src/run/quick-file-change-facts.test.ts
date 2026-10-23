import { describe, expect, it } from 'vitest';
import { parsePersistedFileChangeFacts, projectFileChanges } from './file-change-facts';

describe('quick canonical file-change regression', () => {
  it('retains durable evidence while projecting the Run file membership', () => {
    const facts = parsePersistedFileChangeFacts({
      version: 1,
      facts: [
        {
          factId: 'fact-1',
          runId: 'run-1',
          turnId: 'turn-1',
          provider: 'codex',
          providerSessionId: 'provider-1',
          providerThreadId: 'thread-1',
          providerTurnId: 'provider-turn-1',
          serviceId: 'service-a',
          repoRelativePath: 'src/example.ts',
          occurredAt: '2026-07-10T00:00:00.000Z',
          evidence: {
            kind: 'patch',
            diff: '@@ -1 +1 @@\n-old\n+new',
            preContent: 'old\n',
            postContent: 'new\n',
          },
        },
      ],
    });

    expect(facts[0]?.evidence).toEqual({
      kind: 'patch',
      diff: '@@ -1 +1 @@\n-old\n+new',
      preContent: 'old\n',
      postContent: 'new\n',
    });
    expect(projectFileChanges(facts)).toEqual([
      { serviceId: 'service-a', repoRelativePath: 'src/example.ts' },
    ]);
  });
});

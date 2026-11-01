import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { CodexSdkClient } from '../../agent-runtime';
import { buildReviewPrompt } from '../prompts/review';

/** Opt-in judgment evaluation against a real provider; ordinary CI needs no credentials. */
it.runIf(process.env['HEYHEY_LIVE_REVIEW_EVAL'] === '1')(
  'reports a persistence defect hidden by passing mocks and preserves an approved manual-reopen decision',
  async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'review-evidence-eval-'));
    const client = new CodexSdkClient();
    const source = `let enabled = true;
exports.setEnabled = value => { enabled = value; };
exports.getEnabled = () => enabled;
exports.reopenAutomatically = () => false;
`;
    const test = `const { test } = require('node:test');
const assert = require('node:assert/strict');
// The suite substitutes storage instead of exercising the production module.
test('disabled setting survives restart', () => {
  const mockedStorage = { save: () => {}, load: () => false };
  mockedStorage.save(false);
  assert.equal(mockedStorage.load(), false);
});
`;
    let reply = '';
    const requests: string[] = [];
    try {
      await writeFile(path.join(cwd, 'settings.cjs'), source);
      await writeFile(path.join(cwd, 'settings.test.cjs'), test);
      const passing = execFileSync(process.execPath, ['--test', 'settings.test.cjs'], {
        cwd,
        encoding: 'utf8',
      });
      expect(passing).toContain('pass 1');
      // Establish the real violation independently; both processes use production code.
      execFileSync(process.execPath, ['-e', "require('./settings.cjs').setEnabled(false)"], {
        cwd,
      });
      expect(
        execFileSync(process.execPath, ['-p', "require('./settings.cjs').getEnabled()"], {
          cwd,
          encoding: 'utf8',
        }).trim(),
      ).toBe('true');
      client.onServerRequest((request) => {
        requests.push(request.method);
        client.submitClientResponse(
          request.id,
          request.method === 'mcpServer/elicitation/request'
            ? { action: 'decline', content: null, _meta: null }
            : { decision: 'decline' },
        );
      });
      client.onEvent((event) => {
        if (event.method !== 'item/completed') return;
        const item = event.params?.['item'] as { type?: string; text?: string } | undefined;
        if (item?.type === 'agentMessage') reply = item.text ?? reply;
      });
      await client.startSession(
        {
          cwd,
          sandbox: 'read-only',
          config: { approvals_reviewer: 'user', mcp_servers: {} },
          prompt: buildReviewPrompt({
            touchedFiles: ['settings.cjs', 'settings.test.cjs'],
            recentUserReplies: [
              {
                messageId: 'evaluation-user-message',
                createdAt: '2026-10-25T12:00:00Z',
                text: 'Reopening must be manual. Keep the disabled preference after a restart.',
              },
            ],
            userMessage: `This is a self-contained evaluation fixture, not a live project mutation.
Governing Feature requirement: Turning the preference off stays off after the application restarts.
Originating task (stale): Reopen automatically when the browser is needed again.
Implementation discussion: The user chose manual reopening to avoid surprise windows. The implementation deliberately returns false from reopenAutomatically.
Implement report: Manual reopening is intentional; all tests pass, so persistence is complete.
Existing check result: node --test settings.test.cjs passes. Inspect the actual source and tests before assessing that claim.
Review the fixture normally. Report checks and their limitations. No report submission tool is connected in this evaluation; disclose that the required walkthrough cannot be saved here. Do not write a substitute artifact.`,
          }),
        },
        { signal: AbortSignal.timeout(150_000) },
      );
      expect(reply).toMatch(/Assessment/i);
      expect(reply).toMatch(/Findings/i);
      expect(reply).toMatch(/Verification/i);
      expect(reply).toMatch(/\b(high|critical|blocker)\b/i);
      expect(reply).toMatch(/persist|restart/i);
      expect(reply).toMatch(/mock|substitut|stub/i);
      expect(reply).toMatch(/manual/i);
      expect(reply).toMatch(/approv|user.{0,35}(cho|request|decis)|intentional/i);
      expect(reply).not.toMatch(/(?:must|should|recommend.{0,20})\s+(?:restore|revert to)\s+auto/i);
      expect(await readFile(path.join(cwd, 'settings.cjs'), 'utf8')).toBe(source);
      expect(await readFile(path.join(cwd, 'settings.test.cjs'), 'utf8')).toBe(test);
      // Retain only fixture-generated evidence in the test runner output.
      console.info(JSON.stringify({ assessment: reply, approvalRequests: requests }));
    } finally {
      await client.disconnect();
      await rm(cwd, { recursive: true, force: true });
    }
  },
  180_000,
);

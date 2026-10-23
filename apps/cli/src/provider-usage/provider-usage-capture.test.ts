import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderUsageCapture } from './provider-usage-capture';
import { ProviderUsageStore } from './provider-usage-store';
let root: string;
let store: ProviderUsageStore;
let capture: ProviderUsageCapture;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-capture-'));
  store = new ProviderUsageStore(root);
  capture = new ProviderUsageCapture(store);
});
afterEach(async () => {
  await capture.flush();
  await fs.rm(root, { recursive: true, force: true });
});
it('maps reversed Codex windows, explicit zero and seconds while leaving missing fields null', async () => {
  capture.observeCodex('account/rateLimits/updated', {
    rateLimits: {
      primary: { windowDurationMins: 10080, usedPercent: 55, resetsAt: 0 },
      secondary: { windowDurationMins: 300, usedPercent: 0 },
    },
  });
  await capture.flush();
  expect(await store.read('codex')).toMatchObject({
    status: 'reported',
    usage: {
      weekly: { usedPercent: 55, resetsAt: '1970-01-01T00:00:00.000Z' },
      fiveHour: { usedPercent: 0, resetsAt: null },
    },
  });
});
it('ignores unrelated events, malformed reports and unrelated metered buckets', async () => {
  capture.observeCodex('thread/tokenUsage/updated', {});
  capture.observeCodex('account/rateLimits/updated', { rateLimits: 'bad' });
  capture.observeCodex('account/rateLimits/updated', {
    rateLimits: { limitId: 'other', primary: { windowDurationMins: 300, usedPercent: 3 } },
  });
  await capture.flush();
  expect((await store.read('codex')).status).toBe('unreported');
});
it('isolates malformed windows and leaves unsupported durations unreported', async () => {
  capture.observeCodex(
    'account/rateLimits/updated',
    {
      rateLimits: {
        primary: { windowDurationMins: 300, usedPercent: 'bad' },
        secondary: { windowDurationMins: 10080, resetsAt: 0 },
      },
    },
    '2026-10-10T00:00:00.000Z',
  );
  await capture.flush();
  expect(await store.read('codex')).toMatchObject({
    usage: { fiveHour: null, weekly: { usedPercent: null } },
  });
  capture.observeCodex('account/rateLimits/updated', {
    rateLimits: { primary: { windowDurationMins: 15, usedPercent: 20 } },
  });
  await capture.flush();
  expect(await store.read('codex')).toMatchObject({ usage: { fiveHour: null, weekly: null } });
});
it('contains storage failures without rejecting capture completion', async () => {
  const save = vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('unavailable'));
  capture.observeCodex('account/rateLimits/updated', { rateLimits: {} });
  await capture.flush();
  expect(save).toHaveBeenCalledTimes(1);
});

it('keeps prior evidence for a malformed window while updating its valid sibling', async () => {
  capture.observeCodex(
    'account/rateLimits/updated',
    {
      rateLimits: {
        primary: { windowDurationMins: 300, usedPercent: 20 },
      },
    },
    '2026-10-10T00:00:00.000Z',
  );
  await capture.flush();
  capture.observeCodex(
    'account/rateLimits/updated',
    {
      rateLimits: {
        primary: { windowDurationMins: 300, usedPercent: 'invalid' },
        secondary: { windowDurationMins: 10080, usedPercent: 60 },
      },
    },
    '2026-10-11T00:00:00.000Z',
  );
  await capture.flush();
  expect(await store.read('codex')).toMatchObject({
    usage: {
      fiveHour: { usedPercent: 20 },
      weekly: { usedPercent: 60 },
    },
  });
});

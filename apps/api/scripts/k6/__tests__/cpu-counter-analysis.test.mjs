import assert from 'node:assert/strict';
import { test } from 'node:test';
import { counterIntervals } from '../cpu-counter-analysis.mjs';

const row = (seconds, usage, identity = 'one') => ({
  identity,
  startedAtNs: String(seconds * 1e9),
  cpu: { usage_usec: usage, nr_throttled: 0 },
  processes: [
    { pid: 1, startTicks: 1, cpuTicks: seconds * 100, command: 'java' },
  ],
  clockTicks: 100,
});
test('uses weighted cumulative CPU and retains peak intervals and process CPU', () => {
  const result = counterIntervals(
    [row(0, 0), row(5, 10000000), row(15, 20000000)],
    (x) => x,
  );
  assert.equal(result.samples, 2);
  assert.equal(result.mean, 400 / 3);
  assert.equal(result.peak, 200);
  assert.equal(result.peakInterval.startAtNs, '0');
  assert.equal(result.intervals[0].processes[0].cpuPercent, 100);
});
test('does not turn resets, container replacement or missing samples into savings', () => {
  const result = counterIntervals(
    [row(0, 100), row(5, 0), row(10, 100, 'two'), null],
    (x) => x,
  );
  assert.equal(result.samples, 0);
  assert.equal(result.gaps.length, 3);
  assert.equal(result.mean, null);
});

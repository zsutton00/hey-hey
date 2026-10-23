/**
 * @license
 * Copyright Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */

/// <reference types="jest" />

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { assertSameAsJsonParse } from './utils';

const testDir = path.join(
  __dirname,
  '..',
  '..',
  'vendor',
  'JSONTestSuite',
  'test_parsing',
);
const hasJsonTestSuite = existsSync(testDir);
const jsonTestSuiteTests = hasJsonTestSuite ? readdirSync(testDir) : [];

(hasJsonTestSuite ? describe : describe.skip)('matching JSON.parse', () => {
  if (!hasJsonTestSuite) {
    it('requires the JSONTestSuite fixtures', () => {
      expect(hasJsonTestSuite).toBe(true);
    });
    return;
  }

  it.each(jsonTestSuiteTests)('%s', async (testName) => {
    const json = readFileSync(path.join(testDir, testName), 'utf8');
    const shouldSucceed: boolean | undefined = testName.startsWith('y_')
      ? true
      : testName.startsWith('n_')
        ? false
        : undefined;
    await assertSameAsJsonParse(testName, json, shouldSucceed);
  });
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { findDuplicateVersions } = require('./check-flyway-versions');

test('detects the marker migration collision', () => {
  const files = [
    'V2026.08.06.1__add_proposal_out_of_date_markers.sql',
    'V2026.08.06.1__allow_task_monitors_under_canonical_parents.sql',
  ];
  assert.deepEqual(findDuplicateVersions(files), [files]);
});

test('uses numeric Flyway versions, including leading and trailing zeros', () => {
  const files = ['V002_03__first.sql', 'V2.3.0__second.sql'];
  assert.deepEqual(findDuplicateVersions(files), [files]);
});

test('keeps distinct timestamps and baseline migrations separate', () => {
  assert.deepEqual(
    findDuplicateVersions([
      'V2026.09.28.052854__first.sql',
      'V2026.09.28.052855__second.sql',
      'B2026.09.28.052854__baseline.sql',
      'R__repeatable.sql',
    ]),
    [],
  );
});

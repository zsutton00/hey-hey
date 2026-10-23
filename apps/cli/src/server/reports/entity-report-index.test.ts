import { describe, expect, it } from 'vitest';
import { EntityReportIndex } from './entity-report-index';

describe('entity-report-index', () => {
  it('registers entities and resolves reports on lookup', () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: 'TASK', entityId: 'task-b' },
    ]);
    index.registerReport('rpt-2', [
      { entityType: 'TASK', entityId: 'task-b' },
      { entityType: 'INITIATIVE', entityId: 'init-1' },
    ]);

    expect(index.lookupReports('TASK', 'task-a')).toEqual(['rpt-1']);
    expect([...index.lookupReports('TASK', 'task-b')].sort()).toEqual(['rpt-1', 'rpt-2']);
    expect(index.lookupReports('INITIATIVE', 'init-1')).toEqual(['rpt-2']);
    expect(index.lookupReports('TASK', 'unknown')).toEqual([]);
  });

  it('reports total referenced entity count', () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: 'TASK', entityId: 'task-b' },
      { entityType: 'TASK', entityId: 'task-c' },
    ]);
    expect(index.getReferencedEntityCount('rpt-1')).toBe(3);
    expect(index.getReferencedEntityCount('nope')).toBe(0);
  });

  it('deduplicates identical entity refs within a single report', () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: 'TASK', entityId: 'task-a' },
    ]);
    expect(index.getReferencedEntityCount('rpt-1')).toBe(1);
  });

  it('re-registering a report replaces its prior refs', () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [{ entityType: 'TASK', entityId: 'task-a' }]);
    index.registerReport('rpt-1', [{ entityType: 'TASK', entityId: 'task-b' }]);

    expect(index.lookupReports('TASK', 'task-a')).toEqual([]);
    expect(index.lookupReports('TASK', 'task-b')).toEqual(['rpt-1']);
  });

  it('unregister removes reverse index entries', () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: 'TASK', entityId: 'task-b' },
    ]);
    index.registerReport('rpt-2', [{ entityType: 'TASK', entityId: 'task-a' }]);

    index.unregisterReport('rpt-1');

    expect(index.hasReport('rpt-1')).toBe(false);
    expect(index.lookupReports('TASK', 'task-a')).toEqual(['rpt-2']);
    expect(index.lookupReports('TASK', 'task-b')).toEqual([]);
  });

  it('skips refs with empty entityType or entityId', () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: '', entityId: 'task-b' },
      { entityType: 'TASK', entityId: '' },
    ]);
    expect(index.getReferencedEntityCount('rpt-1')).toBe(1);
  });
});

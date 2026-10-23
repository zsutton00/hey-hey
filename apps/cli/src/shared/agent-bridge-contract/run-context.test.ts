import { describe, expect, it } from 'vitest';
import { isRunContextMetadata } from './run-context';

const validContext = () => ({
  capturedAt: '2026-07-13T18:00:00.000Z',
  organizationId: 'organization-1',
  projectId: 'project-1',
  agentSessionId: '33333333-3333-4333-8333-333333333333',
  taskMonitorId: '44444444-4444-4444-8444-444444444444',
  userComments: [],
  fileReferences: { resolved: [], unresolved: [] },
});

describe('isRunContextMetadata task monitor identity narrowing', () => {
  it('accepts a non-empty monitor identity', () => {
    expect(isRunContextMetadata(validContext())).toBe(true);
  });

  it('rejects an empty monitor identity', () => {
    expect(isRunContextMetadata({ ...validContext(), taskMonitorId: '' })).toBe(false);
  });
});

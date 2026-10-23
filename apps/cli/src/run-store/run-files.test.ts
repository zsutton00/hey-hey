import { describe, expect, it } from 'vitest';
import { isRunMetadataFileName, runFamilyFileNames, runIdFromMetadataFileName } from './run-files';

describe('Run store file classification', () => {
  it('distinguishes primary Run metadata from indexes and sidecars', () => {
    expect(isRunMetadataFileName('run-1.json')).toBe(true);
    expect(isRunMetadataFileName('run-index.json')).toBe(false);
    expect(isRunMetadataFileName('run-1.events.jsonl')).toBe(false);
    expect(isRunMetadataFileName('run-1.tool-usage.json')).toBe(false);
    expect(isRunMetadataFileName('run-1.touched-files.json')).toBe(false);
    expect(isRunMetadataFileName('run-1.idempotency.json')).toBe(false);
    expect(isRunMetadataFileName('run-1.file-change-facts.json')).toBe(false);
    expect(isRunMetadataFileName('run-1.changed-files-diagnostics.json')).toBe(false);
  });

  it('maps metadata names and Run families without assuming UUID identifiers', () => {
    expect(runIdFromMetadataFileName('custom-run.json')).toBe('custom-run');
    expect(runFamilyFileNames('custom-run')).toEqual([
      'custom-run.json',
      'custom-run.events.jsonl',
      'custom-run.tool-usage.json',
      'custom-run.touched-files.json',
      'custom-run.idempotency.json',
      'custom-run.file-change-facts.json',
      'custom-run.changed-files-diagnostics.json',
    ]);
  });
});

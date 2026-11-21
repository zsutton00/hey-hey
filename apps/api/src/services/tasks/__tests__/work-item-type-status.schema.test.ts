import { workItemTypeStatusesSchema } from '../work-item-type-status.schema';

const status = (name: string) => ({ name, meaning: 'IN_PROGRESS' as const });

describe('workItemTypeStatusesSchema', () => {
  it('rejects names that differ only by surrounding spaces as duplicates', () => {
    const result = workItemTypeStatusesSchema.safeParse([
      status(' Testing'),
      status('Testing'),
    ]);

    expect(result.success).toBe(false);
  });

  it('saves names trimmed', () => {
    const parsed = workItemTypeStatusesSchema.parse([
      status('  Testing '),
      status('Review'),
    ]);

    expect(parsed.map((entry) => entry.name)).toEqual(['Testing', 'Review']);
  });
});

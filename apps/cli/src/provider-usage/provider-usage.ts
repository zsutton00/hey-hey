import { z } from 'zod';

export const providers = ['claude', 'codex', 'opencode'] as const;
export type UsageProvider = (typeof providers)[number];
// Claude usage is read live from Claude Code (see claude-usage.ts), never persisted.
export const storedProviders = ['codex', 'opencode'] as const satisfies readonly UsageProvider[];
const limitWindowSchema = z
  .object({
    usedPercent: z.number().finite().nonnegative().nullable(),
    resetsAt: z.string().datetime().nullable(),
  })
  .strict();
export const providerUsageSchema = z
  .object({
    provider: z.enum(providers),
    observedAt: z.string().datetime().nullable(),
    fiveHour: limitWindowSchema.nullable(),
    weekly: limitWindowSchema.nullable(),
  })
  .strict();
export type LimitWindow = z.infer<typeof limitWindowSchema>;
export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export const unreportedUsage = (provider: UsageProvider): ProviderUsage => ({
  provider,
  observedAt: null,
  fiveHour: null,
  weekly: null,
});
export const windowKey = (minutes: number): 'fiveHour' | 'weekly' | null =>
  minutes === 300 ? 'fiveHour' : minutes === 10080 ? 'weekly' : null;
export const resetTimestamp = (seconds: number | null | undefined): string | null => {
  if (seconds == null) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

import type { UsageData, UsageWindow } from '@hey-hey/ui-common/agents';
import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import { unreportedUsage, type LimitWindow } from './provider-usage';
import type { ProviderUsageRead } from './provider-usage-store';

const CLAUDE_USAGE_TIMEOUT_MS = 15_000;

export type ClaudeUsageSource = (signal: AbortSignal) => Promise<UsageData>;

// A window whose reset time has passed describes a finished period, never the current one.
const toLimitWindow = (window: UsageWindow | null | undefined, now: Date): LimitWindow | null => {
  if (window == null) return null;
  const resetsAt = window.resets_at === null ? null : new Date(window.resets_at);
  if (resetsAt !== null && resetsAt.getTime() <= now.getTime()) return null;
  return { usedPercent: window.utilization, resetsAt: resetsAt?.toISOString() ?? null };
};

// Fresh Claude plan usage from Claude Code's `get_usage`. A refusal, timeout or
// invalid reply reads as not reported — never a stale or zero figure.
export async function readClaudeUsage(
  source: ClaudeUsageSource,
  logger: ServerLogger = NOOP_LOGGER,
  timeoutMs = CLAUDE_USAGE_TIMEOUT_MS,
  now: () => Date = () => new Date(),
): Promise<Extract<ProviderUsageRead, { usage: unknown }>> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Claude usage request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const data = await Promise.race([source(controller.signal), timeout]);
    if (!data.rate_limits_available || data.rate_limits === null) {
      logger.debug('provider_usage.claude.unavailable', {
        subscriptionType: data.subscription_type,
      });
      return { status: 'unreported', usage: unreportedUsage('claude') };
    }
    const observedAt = now();
    return {
      status: 'reported',
      usage: {
        provider: 'claude',
        observedAt: observedAt.toISOString(),
        fiveHour: toLimitWindow(data.rate_limits.five_hour, observedAt),
        weekly: toLimitWindow(data.rate_limits.seven_day, observedAt),
      },
    };
  } catch (error) {
    logger.warn('provider_usage.claude.read_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'unreported', usage: unreportedUsage('claude') };
  } finally {
    clearTimeout(timer);
  }
}

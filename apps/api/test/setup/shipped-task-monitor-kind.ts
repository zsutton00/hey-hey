import { readFileSync } from 'fs';
import { resolve } from 'path';

const FLYWAY_DIR = resolve(__dirname, '../../db/flyway');

function dollarQuotedJson(file: string, tag: string): Record<string, unknown> {
  const sql = readFileSync(resolve(FLYWAY_DIR, file), 'utf8');
  const literal = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(
    sql,
  )?.[1];
  if (literal === undefined) {
    throw new Error(`${file} does not publish a $${tag}$ literal`);
  }
  return JSON.parse(literal) as Record<string, unknown>;
}

/**
 * The `task` monitor kind the shipped migrations publish on the canonical
 * TASK_MONITOR template, composed in migration order: the Task kind, then its
 * policies for any key the kind does not already declare.
 */
export function shippedTaskMonitorKind(): Record<string, unknown> {
  const kind = dollarQuotedJson(
    'V2026.11.13.064226__publish_task_monitor_task_kind.sql',
    'kind',
  );
  const policies = dollarQuotedJson(
    'V2026.11.15.224545__publish_task_monitor_kind_policies.sql',
    'policies',
  );
  return {
    ...dollarQuotedJson(
      'V2026.11.16.102036__publish_monitor_acceptance_effects.sql',
      'acceptance',
    ),
    ...policies,
    ...kind,
  };
}

/** The monitor kinds the shipped migrations publish: the `task` kind alone. */
export function shippedTaskMonitorKinds(): Array<Record<string, unknown>> {
  return [shippedTaskMonitorKind()];
}

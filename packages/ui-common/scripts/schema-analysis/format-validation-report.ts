/**
 * Human-readable formatter for ValidationReport.
 *
 * Produces structured console output grouped by severity,
 * suitable for developer review before committing config changes.
 */

import type {
  DiffEntry,
  DiffSeverity,
  ValidationReport,
} from "./validate-config-types";

const SEVERITY_LABELS: Record<DiffSeverity, string> = {
  breaking: "BREAKING",
  warning: "WARNING",
  info: "INFO",
};

const SEVERITY_ICONS: Record<DiffSeverity, string> = {
  breaking: "x",
  warning: "!",
  info: "+",
};

/** Format a single diff entry as a one-line string. */
function formatEntry(entry: DiffEntry): string {
  const icon = SEVERITY_ICONS[entry.severity];
  return `  [${icon}] ${entry.message}`;
}

/** Group entries by severity. */
function groupBySeverity(
  entries: DiffEntry[],
): Map<DiffSeverity, DiffEntry[]> {
  const groups = new Map<DiffSeverity, DiffEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.severity) ?? [];
    group.push(entry);
    groups.set(entry.severity, group);
  }
  return groups;
}

/**
 * Format a ValidationReport as a human-readable string.
 *
 * Output is designed for stderr / terminal display.
 */
export function formatValidationReport(
  report: ValidationReport,
): string {
  const lines: string[] = [];
  const { summary } = report;

  // Header
  lines.push("=== Configuration Validation Report ===");
  lines.push("");

  if (summary.totalChanges === 0) {
    lines.push("No changes detected. Configuration matches previous version.");
    return lines.join("\n");
  }

  // Summary
  lines.push(
    `Total changes: ${summary.totalChanges}  ` +
      `(${summary.breaking} breaking, ${summary.warning} warning, ` +
      `${summary.info} info)`,
  );
  lines.push("");

  if (summary.removedEntities > 0 || summary.addedEntities > 0) {
    lines.push(
      `Entities: ${summary.removedEntities} removed, ` +
        `${summary.addedEntities} added`,
    );
  }
  if (summary.removedRelationships > 0 || summary.addedRelationships > 0) {
    lines.push(
      `Relationships: ${summary.removedRelationships} removed, ` +
        `${summary.addedRelationships} added`,
    );
  }
  if (summary.typeChanges > 0) {
    lines.push(`Type/field changes: ${summary.typeChanges}`);
  }
  lines.push("");

  // Grouped entries
  const groups = groupBySeverity(report.entries);
  const severityOrder: DiffSeverity[] = ["breaking", "warning", "info"];

  for (const severity of severityOrder) {
    const group = groups.get(severity);
    if (!group || group.length === 0) continue;

    lines.push(`--- ${SEVERITY_LABELS[severity]} (${group.length}) ---`);
    for (const entry of group) {
      lines.push(formatEntry(entry));
    }
    lines.push("");
  }

  // Footer
  if (summary.breaking > 0) {
    lines.push(
      `** ${summary.breaking} breaking change(s) detected. ` +
        `Review before committing. **`,
    );
  } else {
    lines.push("No breaking changes detected.");
  }

  return lines.join("\n");
}

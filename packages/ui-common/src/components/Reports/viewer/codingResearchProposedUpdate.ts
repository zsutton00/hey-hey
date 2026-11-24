import type { CodingResearchUpdate, ReportDto } from "../../../api";
import { formatMention } from "../../../utils/mentionFormatting";

const UPDATE_SENTENCE_LABELS: Record<CodingResearchUpdate["type"], string> = {
  add: "add",
  remove: "remove",
  update: "update",
};

/** FNV-1a, 32-bit. Enough to keep a long description out of a stored key. */
const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
};

const fingerprintUpdate = (update: CodingResearchUpdate): string => {
  const targets = update.targets
    .map((target) => `${target.entityType}:${target.entityId}`)
    .sort();

  return fnv1a(
    JSON.stringify([update.type, targets, update.description.trim()]),
  );
};

/**
 * One stable decision key per update, in report order. An update has no id, and
 * a message can show several reports and a saved report can be revised, so the key follows what the update says
 * and which report it came from, rather than where it sits: a revised update gets a fresh key and can never
 * show another update's session. Identical updates are told apart by how many
 * of them came before.
 */
export const buildProposedUpdateKeys = (
  messageId: string,
  reportId: string,
  updates: readonly CodingResearchUpdate[],
): string[] => {
  const seen = new Map<string, number>();

  return updates.map((update) => {
    const fingerprint = fingerprintUpdate(update);
    const occurrence = seen.get(fingerprint) ?? 0;
    seen.set(fingerprint, occurrence + 1);
    const suffix = occurrence === 0 ? "" : `:${occurrence}`;

    return `${messageId}:update:${reportId}:${fingerprint}${suffix}`;
  });
};

/** The complete report, then one sentence naming this single update. */
export const buildProposedUpdateDiscussionPrompt = (
  report: ReportDto,
  update: CodingResearchUpdate,
): string => {
  const targets = update.targets
    .map((target) =>
      formatMention({
        entityType: target.entityType,
        entityId: target.entityId,
        entityName: target.title,
      }),
    )
    .join(", ");
  const sentence = `The user wants to discuss one proposed update: ${UPDATE_SENTENCE_LABELS[update.type]} ${targets} — ${update.description.trim()}`;

  return [
    formatMention({
      entityType: "report",
      entityId: report.id,
      entityName: report.title,
    }),
    sentence,
  ].join("\n\n");
};

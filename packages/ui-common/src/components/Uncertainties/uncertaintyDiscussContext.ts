import { formatMention } from "../../utils/mentionFormatting";
import type { UncertaintyItemProps } from "./UncertaintyItem";
import { UNCERTAINTY_CATEGORY_LABELS } from "./UncertaintyItem";

export interface UncertaintyDiscussReference {
  entityType: string;
  entityId: string;
  title: string;
}

export interface UncertaintyDiscussSubject {
  severity: UncertaintyItemProps["severity"];
  category: UncertaintyItemProps["category"];
  statement: string;
  references?: readonly UncertaintyDiscussReference[];
}

/**
 * The message the Discuss modal sends automatically ahead of whatever the user
 * adds: it tells the new conversation what the user is reacting to.
 */
export const buildUncertaintyDiscussContext = ({
  severity,
  category,
  statement,
  references = [],
}: UncertaintyDiscussSubject): string => {
  const lines = [
    "The user wants to discuss an uncertainty an agent raised.",
    `Severity: ${severity}. Category: ${UNCERTAINTY_CATEGORY_LABELS[category]}.`,
    `Uncertainty: ${statement}`,
  ];

  if (references.length > 0) {
    const mentions = references.map((reference) =>
      formatMention({
        entityType: reference.entityType.toLowerCase(),
        entityId: reference.entityId,
        entityName: reference.title,
      }),
    );
    lines.push(`Related: ${mentions.join(", ")}`);
  }

  return lines.join("\n\n");
};

import { formatMention } from "../../utils/mentionFormatting";

export interface UncertaintyDiscussReference {
  entityType: string;
  entityId: string;
  title: string;
}

/** Editor seed: the statement, then one mention per referenced entity. */
export const buildUncertaintyDiscussSeed = (
  statement: string,
  references: readonly UncertaintyDiscussReference[] = [],
): string => {
  const mentions = references.map((reference) =>
    formatMention({
      entityType: reference.entityType.toLowerCase(),
      entityId: reference.entityId,
      entityName: reference.title,
    }),
  );

  return [statement, ...mentions].join("\n\n");
};

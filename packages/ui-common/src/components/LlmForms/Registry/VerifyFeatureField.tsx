import { SyncAlt } from "@mui/icons-material";
import { Chip } from "@mui/material";
import { useMemo } from "react";
import type {
  VerifyFeaturePayload,
  VerifyImpactedEntityReference,
} from "../../../api";
import {
  ConversationCard,
  ConversationCardRelatedRows,
  ConversationCardSection,
} from "../../Conversation/Card";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import type { FieldComponentProps } from "./types";
import { splitExplanation } from "./verifyFeatureExplanation";

const getUniqueImpactedEntities = (
  entities: VerifyImpactedEntityReference[] | undefined,
): VerifyImpactedEntityReference[] => {
  const seen = new Set<string>();

  return (entities ?? []).filter((entity) => {
    const identity = `${entity.entityType}:${entity.entityId}`;
    if (seen.has(identity)) return false;

    seen.add(identity);
    return true;
  });
};

export function VerifyFeatureField({
  value,
  footerActions,
}: FieldComponentProps<VerifyFeaturePayload>) {
  const impactedEntities = useMemo(
    () => getUniqueImpactedEntities(value?.impactedEntities),
    [value?.impactedEntities],
  );
  const { lead, details } = useMemo(() => {
    // Suggestions saved before the lead field existed have none.
    if (value?.lead) {
      return { lead: value.lead, details: value.explanation };
    }
    return splitExplanation(value?.explanation ?? "");
  }, [value?.lead, value?.explanation]);

  return (
    <ConversationCard
      data-testid="verify-feature-field"
      tone={{ role: "projectSync" }}
      icon={<SyncAlt fontSize="small" />}
      kindLabel="Project sync · Possible issue"
      chips={
        <Chip size="small" variant="outlined" label="After implementation" />
      }
      lead={
        lead ? (
          <MarkdownRenderer allowMentionEscapes>{lead}</MarkdownRenderer>
        ) : undefined
      }
      footer={footerActions ? { content: footerActions } : undefined}
    >
      {details ? (
        <ConversationCardSection label="Details">
          <MarkdownRenderer allowMentionEscapes>{details}</MarkdownRenderer>
        </ConversationCardSection>
      ) : null}
      {impactedEntities.length > 0 ? (
        <div data-testid="verify-feature-impacted-entities">
          <ConversationCardSection label="Possibly affected">
            <ConversationCardRelatedRows
              rows={impactedEntities.map((entity) => ({
                key: `${entity.entityType}-${entity.entityId}`,
                mention: {
                  entityType: entity.entityType,
                  entityId: entity.entityId,
                  // Saved references that predate titles fall back to the id.
                  entityName: entity.title ?? entity.entityId,
                },
              }))}
            />
          </ConversationCardSection>
        </div>
      ) : null}
    </ConversationCard>
  );
}

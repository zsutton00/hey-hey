import { Stack } from "@mui/material";
import React from "react";
import { EntityType, type CodingResearchUncertainty } from "../../../api";
import { useModal } from "../../../contexts/ModalContext";
import {
  UncertaintyItem,
  buildUncertaintyDiscussContext,
} from "../../Uncertainties";
import { ConversationCardRelatedRows } from "../../Conversation/Card";
import { useOptionalConversationContext } from "../../Conversation/Components/ConversationContext";

export interface CodingResearchUncertaintiesSectionProps {
  uncertainties: CodingResearchUncertainty[];
  reportTestId: string;
}

export const CodingResearchUncertaintiesSection: React.FC<
  CodingResearchUncertaintiesSectionProps
> = ({ uncertainties, reportTestId }) => {
  const modal = useModal();
  const conversation = useOptionalConversationContext();

  if (uncertainties.length === 0) {
    return null;
  }

  const categories = [
    ...new Set(uncertainties.map(({ category }) => category)),
  ];
  return (
    <Stack
      data-testid={`${reportTestId}-coding-research-uncertainties`}
      sx={{ mt: 1 }}
    >
      <Stack spacing={1.25}>
        {categories.map((category) => (
          <Stack
            key={category}
            data-testid={`${reportTestId}-coding-research-uncertainties-${category}`}
          >
            <Stack spacing={1}>
              {uncertainties
                .filter((uncertainty) => uncertainty.category === category)
                .map((uncertainty, index) => (
                  <UncertaintyItem
                    key={`${category}-${index}`}
                    testId={`${reportTestId}-coding-research-uncertainty-${category}-${index}`}
                    severity={uncertainty.severity}
                    category={uncertainty.category}
                    statement={uncertainty.statement}
                    showAnswerBand={false}
                    onDiscuss={
                      conversation?.agentSessionId && modal
                        ? () =>
                            modal.openModal({
                              type: "discuss",
                              organizationId:
                                conversation.project.organizationId,
                              projectId: conversation.project.id,
                              entityId: conversation.agentSessionId!,
                              entityType: EntityType.AgentSession,
                              contextPreview:
                                buildUncertaintyDiscussContext(uncertainty),
                            })
                        : undefined
                    }
                  >
                    {uncertainty.references.length > 0 ? (
                      <ConversationCardRelatedRows
                        dividers={false}
                        rows={uncertainty.references.map((reference) => ({
                          key: `${reference.entityType}-${reference.entityId}`,
                          mention: {
                            entityType: reference.entityType,
                            entityId: reference.entityId,
                            entityName: reference.title,
                          },
                        }))}
                      />
                    ) : null}
                  </UncertaintyItem>
                ))}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
};

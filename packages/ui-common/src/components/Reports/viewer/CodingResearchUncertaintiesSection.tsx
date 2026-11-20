import { Stack } from "@mui/material";
import React from "react";
import type { CodingResearchUncertainty, ReportDto } from "../../../api";
import {
  getCodingResearchFocalNode,
  type CodingResearchFrameModel,
} from "./codingResearchReportModel";
import { useModal } from "../../../contexts/ModalContext";
import type { EntityType, TargetEntityType } from "../../../api";
import {
  UncertaintyItem,
  buildUncertaintyDiscussSeed,
} from "../../Uncertainties";
import { ConversationCardRelatedRows } from "../../Conversation/Card";

/** The entity a Discuss launch from this report attaches to: the report's focal entity. */
export interface CodingResearchUncertaintyDiscussScope {
  organizationId: string;
  projectId: string;
  entityId: string;
  entityType: EntityType | TargetEntityType;
  entityTitle?: string;
}

export const getCodingResearchUncertaintyDiscussScope = (
  report: ReportDto | undefined,
  frameModel: CodingResearchFrameModel,
): CodingResearchUncertaintyDiscussScope | undefined => {
  const focalNode = getCodingResearchFocalNode(frameModel);

  if (!report?.projectId || !focalNode) {
    return undefined;
  }

  return {
    organizationId: report.organizationId,
    projectId: report.projectId,
    entityId: focalNode.id,
    entityType: focalNode.type,
    entityTitle: focalNode.title,
  };
};

export interface CodingResearchUncertaintiesSectionProps {
  uncertainties: CodingResearchUncertainty[];
  reportTestId: string;
  /** Omit when the report has no focal entity or is display-only. */
  discussScope?: CodingResearchUncertaintyDiscussScope;
}

export const CodingResearchUncertaintiesSection: React.FC<
  CodingResearchUncertaintiesSectionProps
> = ({ uncertainties, reportTestId, discussScope }) => {
  const modal = useModal();

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
                      discussScope && modal
                        ? () =>
                            modal.openModal({
                              type: "discuss",
                              ...discussScope,
                              initialValue: buildUncertaintyDiscussSeed(
                                uncertainty.statement,
                                uncertainty.references,
                              ),
                            })
                        : undefined
                    }
                  >
                    {uncertainty.references.length > 0 ? (
                      <ConversationCardRelatedRows
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

import { Button, Skeleton, Stack, Typography } from "@mui/material";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { DIAGRAM_CLOSEUP_MIN_HEIGHT } from "../../shared/diagramCloseupFraming";
import { useElementWidth } from "../../shared/useElementWidth";
import { DiagramScreenFlowMeasure } from "../../shared/WorkflowMentionInlineRenderer";
import { useWalkthroughPreviews } from "./useWalkthroughPreviews";
import { WalkthroughDiagramPreview } from "./WalkthroughDiagramPreview";

export const WalkthroughPreviewsLoading: React.FC = () => (
  <Skeleton
    variant="rounded"
    height={DIAGRAM_CLOSEUP_MIN_HEIGHT}
    data-testid="walkthrough-part-preview-loading"
  />
);

/**
 * Where a block of walkthrough parts sits in the design: close-ups of the
 * Diagrams their linked elements are in. The first shows; the rest wait behind
 * "Show N more".
 */
export const WalkthroughPartPreviews: React.FC<{
  organizationId: string;
  projectId: string;
  elementIds: readonly string[];
}> = ({ organizationId, projectId, elementIds }) => {
  const { t } = useTranslation();
  const [measureRef, width] = useElementWidth();
  const { isLoading, previews, screenFlows, handleMeasure } =
    useWalkthroughPreviews(organizationId, projectId, elementIds, width);
  const [expanded, setExpanded] = useState(false);

  if (!isLoading && previews.length === 0) {
    return null;
  }
  const visible = expanded ? previews : previews.slice(0, 1);
  const hiddenCount = previews.length - visible.length;

  return (
    <Stack
      ref={measureRef}
      spacing={1}
      data-testid="walkthrough-part-diagram-previews"
      sx={{ minWidth: 0 }}
    >
      {isLoading ? (
        <WalkthroughPreviewsLoading />
      ) : (
        <>
          <Typography
            component="h4"
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 650 }}
          >
            {t("changeWalkthrough.inTheDesign")}
          </Typography>
          {visible.map((preview) => (
            <WalkthroughDiagramPreview
              key={preview.elementIds.join(" ")}
              preview={preview}
            />
          ))}
          {hiddenCount > 0 ? (
            <Button
              size="small"
              onClick={() => setExpanded(true)}
              data-testid="walkthrough-part-show-more-previews"
              sx={{ alignSelf: "flex-start" }}
            >
              {t("changeWalkthrough.showMore", { count: hiddenCount })}
            </Button>
          ) : null}
        </>
      )}
      {screenFlows.map((graphData) => (
        <DiagramScreenFlowMeasure
          key={graphData.workflow.id}
          graphData={graphData}
          onMeasure={handleMeasure}
        />
      ))}
    </Stack>
  );
};

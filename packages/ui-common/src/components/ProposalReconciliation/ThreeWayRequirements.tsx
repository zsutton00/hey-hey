import { Fragment, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import isEqual from "lodash/isEqual.js";
import type { FeatureRequirementRecord } from "../../utils/structuredRequirements";
import { StructuredRequirementsView } from "../shared/StructuredRequirementsView";
import { WordDiffText } from "../SuggestedContent/DiffRenderer";
import { branchChange } from "./threeWayProjection";

export function ThreeWayRequirements({
  original,
  live,
  intended,
  overlapping,
}: {
  original: readonly FeatureRequirementRecord[];
  live: readonly FeatureRequirementRecord[];
  intended: readonly FeatureRequirementRecord[];
  overlapping: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const maps = [original, live, intended].map(
    (records) => new Map(records.map((record) => [record.id, record])),
  );
  const ids = [
    ...new Set([...original, ...live, ...intended].map((record) => record.id)),
  ];
  const unchanged = ids.filter(
    (id) =>
      isEqual(maps[0].get(id), maps[1].get(id)) &&
      isEqual(maps[0].get(id), maps[2].get(id)),
  );
  return (
    <>
      {ids
        .filter((id) => showAll || !unchanged.includes(id))
        .map((id) => {
          const basis = maps[0].get(id);
          const overlap =
            overlapping &&
            basis &&
            branchChange(basis, maps[1].get(id)) !== "Unchanged" &&
            branchChange(basis, maps[2].get(id)) !== "Unchanged" &&
            !isEqual(maps[1].get(id), maps[2].get(id));
          return (
            <Fragment key={id}>
              {maps.map((map, index) => {
                const record = map.get(id);
                const change =
                  index === 0 ? "Original" : branchChange(basis, record);
                return (
                  <Box
                    key={index}
                    data-testid="three-way-requirement-cell"
                    data-requirement-id={id}
                    data-state={index}
                    sx={{
                      p: 2,
                      borderBottom: 1,
                      borderColor: "divider",
                      bgcolor:
                        change === "Added" || change === "Changed"
                          ? "action.hover"
                          : undefined,
                    }}
                  >
                    <Typography variant="caption">
                      {change}
                      {overlap && index > 0 ? " · Overlapping edit" : ""}
                      {index === 2 && change === "Added"
                        ? " · Check it still belongs"
                        : ""}
                    </Typography>
                    {record ? (
                      <StructuredRequirementsView
                        requirements={[record]}
                        itemStatementRenderers={
                          index > 0
                            ? new Map([
                                [
                                  id,
                                  <WordDiffText
                                    key={id}
                                    oldContent={basis?.statement ?? ""}
                                    newContent={record.statement}
                                    pane="new"
                                  />,
                                ],
                              ])
                            : undefined
                        }
                      />
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        {index === 0
                          ? "This requirement did not exist."
                          : "No corresponding requirement."}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Fragment>
          );
        })}
      {unchanged.length > 0 ? (
        <Box sx={{ gridColumn: "1 / -1", p: 1 }}>
          <Typography variant="caption">
            {!showAll
              ? `${unchanged.length} unchanged requirements hidden`
              : "All requirements shown"}
          </Typography>
          <Button
            data-testid="three-way-show-all"
            onClick={() => setShowAll(!showAll)}
            aria-expanded={showAll}
          >
            {showAll ? "Hide unchanged" : "Show all"}
          </Button>
        </Box>
      ) : null}
    </>
  );
}

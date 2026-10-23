import { Stack, Typography } from "@mui/material";
import type { FutureRevisionContent } from "../../api";
import { DiffRenderer } from "../SuggestedContent";
import { FutureContentMetadata } from "./FutureContentMetadata";

export interface FutureContentComparisonProps {
  current: FutureRevisionContent;
  result: FutureRevisionContent;
}

/** Complete sections, including unchanged and removed sections, remain reviewable. */
export function FutureContentComparison({
  current,
  result,
}: FutureContentComparisonProps) {
  const keys = [
    ...new Set(
      [...result.sections, ...current.sections].map((section) => section.key),
    ),
  ];
  return (
    <Stack spacing={2} data-testid="future-content-comparison">
      <DiffRenderer
        oldContent={current.name}
        newContent={result.name}
        defaultViewMode="split"
      />
      <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
        <Stack sx={{ flex: 1 }}>
          <Typography variant="subtitle2">Before</Typography>
          <FutureContentMetadata content={current} />
        </Stack>
        <Stack sx={{ flex: 1 }}>
          <Typography variant="subtitle2">Complete result</Typography>
          <FutureContentMetadata content={result} />
        </Stack>
      </Stack>
      {keys.map((key) => (
        <Stack key={key} spacing={1} data-section-key={key}>
          <Typography variant="subtitle2">{key}</Typography>
          <DiffRenderer
            oldContent={
              current.sections.find((section) => section.key === key)
                ?.materializedMarkdown ?? ""
            }
            newContent={
              result.sections.find((section) => section.key === key)
                ?.materializedMarkdown ?? ""
            }
            defaultViewMode="split"
          />
        </Stack>
      ))}
    </Stack>
  );
}

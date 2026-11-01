import { Box, Chip, Stack, Typography } from "@mui/material";
import { DiffRenderer } from "../SuggestedContent";
import type { DiffViewMode } from "../SuggestedContent/DiffRenderer";
import type {
  DefinitionFieldComparison,
  WorkItemTypeDefinitionComparison,
} from "./workItemTypeDefinitionComparison";

function FieldDiff({
  field,
  defaultViewMode,
}: {
  field: DefinitionFieldComparison;
  defaultViewMode: DiffViewMode;
}) {
  return (
    <Box
      data-testid="work-item-type-definition-field"
      data-field-label={field.label}
    >
      <Typography variant="caption">{field.label}</Typography>
      <DiffRenderer
        oldContent={field.before}
        newContent={field.after}
        defaultViewMode={defaultViewMode}
        showViewModeToggle
      />
    </Box>
  );
}
export function WorkItemTypeDefinitionDiff({
  comparison,
  defaultViewMode = "split",
}: {
  comparison: WorkItemTypeDefinitionComparison;
  defaultViewMode?: DiffViewMode;
}) {
  return (
    <Stack spacing={2} data-testid="work-item-type-definition-diff">
      {comparison.fields.map((field) => (
        <FieldDiff
          key={field.label}
          field={field}
          defaultViewMode={defaultViewMode}
        />
      ))}
      {comparison.order && (
        <FieldDiff field={comparison.order} defaultViewMode={defaultViewMode} />
      )}
      {comparison.sections.map((section) => (
        <Stack
          key={section.key}
          spacing={1}
          data-testid="work-item-type-section-comparison"
          data-section-key={section.key}
          data-change={section.change}
        >
          <Box>
            <Typography variant="subtitle2">{section.label}</Typography>
            <Chip size="small" label={section.change} />
          </Box>
          {section.fields
            .filter((field) => field.before !== "" || field.after !== "")
            .map((field) => (
              <FieldDiff
                key={field.label}
                field={field}
                defaultViewMode={defaultViewMode}
              />
            ))}
        </Stack>
      ))}
    </Stack>
  );
}

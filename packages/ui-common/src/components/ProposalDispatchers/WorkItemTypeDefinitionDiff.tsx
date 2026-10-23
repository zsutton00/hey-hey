import { Box, Chip, Stack, Typography } from "@mui/material";
import { DiffRenderer } from "../SuggestedContent";
import type { DiffViewMode } from "../SuggestedContent/DiffRenderer";
import type {
  DefinitionFieldComparison,
  WorkItemTypeDefinitionComparison,
} from "./workItemTypeDefinitionComparison";
import type { WorkItemTypeDefinitionDto } from "../../api";

function formatSemanticGuidance(value: string): string {
  if (!value) return "";
  // Comparison owns normalization. This formats its serialized result only.
  const guidance = JSON.parse(value) as NonNullable<
    WorkItemTypeDefinitionDto["agentGuidance"]
  >;
  // Quote authored values so a newline or label in the content cannot look
  // like a different field, and distinct focal-key arrays stay distinct.
  const lines = ["Overview", JSON.stringify(guidance.overview)];
  if (guidance.examples !== undefined) {
    lines.push("Examples");
    lines.push(
      ...guidance.examples.flatMap((example, index) => [
        `Example ${index + 1}`,
        `Title: ${JSON.stringify(example.title)}`,
        `Guidance: ${JSON.stringify(example.guidance)}`,
      ])
    );
  }
  if (guidance.contexts !== undefined) {
    lines.push("Contextual guidance");
    guidance.contexts.forEach((context, index) => {
      lines.push(`Context ${index + 1}`);
      lines.push(`Focal types: ${JSON.stringify(context.focalTypeKeys)}`);
      lines.push(`Guidance: ${JSON.stringify(context.guidance)}`);
      if (context.examples !== undefined) {
        lines.push("Context examples");
        lines.push(
          ...context.examples.flatMap((example, exampleIndex) => [
            `Example ${exampleIndex + 1}`,
            `Title: ${JSON.stringify(example.title)}`,
            `Guidance: ${JSON.stringify(example.guidance)}`,
          ])
        );
      }
    });
  }
  return lines.join("\n");
}

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
        oldContent={
          field.label === "Semantic guidance"
            ? formatSemanticGuidance(field.before)
            : field.before
        }
        newContent={
          field.label === "Semantic guidance"
            ? formatSemanticGuidance(field.after)
            : field.after
        }
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

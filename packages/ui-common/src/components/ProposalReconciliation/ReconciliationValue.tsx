import { Alert, Typography } from "@mui/material";
import type { WorkItemTypeSectionDefinition } from "../../api";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { WordDiffText } from "../SuggestedContent/DiffRenderer";
import { HtmlCssSectionRenderer } from "../shared/HtmlCssSectionRenderer";
import { StructuredMockupSectionRenderer } from "../shared/StructuredMockupSectionRenderer";
import { ImageSectionRenderer } from "../shared/ImageSectionRenderer";
import { JsonSectionRenderer } from "../shared/JsonSectionRenderer";
import { ModeFilesSectionRenderer } from "../shared/ModeFilesSectionRenderer";
import { ModeSettingsSectionRenderer } from "../shared/ModeSettingsSectionRenderer";
import {
  isModeFilesSection,
  isModeSettingsSection,
} from "../shared/modeFilesSection";
import { isImageSectionDefinition } from "../shared/imageSection";

export function ReconciliationValue({
  value,
  original,
  branch,
  section,
  typeKey,
}: {
  value: unknown;
  original: unknown;
  branch: boolean;
  section: WorkItemTypeSectionDefinition | undefined;
  typeKey: string | undefined;
}) {
  if (value == null)
    return <Typography color="text.secondary">No content here.</Typography>;
  if (section?.kind === "html/css")
    return (
      <HtmlCssSectionRenderer
        content={value}
        definition={section}
        context="inline"
        title={section.label}
      />
    );
  if (section?.kind === "structured-mockup")
    return (
      <StructuredMockupSectionRenderer
        content={value}
        definition={section}
        context="inline"
      />
    );
  if (
    section &&
    isModeFilesSection({ typeKey, key: section.key, kind: section.kind })
  )
    return <ModeFilesSectionRenderer content={value} />;
  if (
    section &&
    isModeSettingsSection({ typeKey, key: section.key, kind: section.kind })
  )
    return <ModeSettingsSectionRenderer content={value} />;
  if (section && isImageSectionDefinition(section))
    return <ImageSectionRenderer content={value} label={section.label} />;
  if (section?.kind === "json") return <JsonSectionRenderer content={value} />;
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return <Typography>{value.join(", ")}</Typography>;
  if (typeof value === "string")
    return branch ? (
      <WordDiffText
        oldContent={typeof original === "string" ? original : ""}
        newContent={value}
        pane="new"
      />
    ) : (
      <MarkdownRenderer>{value}</MarkdownRenderer>
    );
  if (typeof value === "number" || typeof value === "boolean")
    return <Typography>{String(value)}</Typography>;
  return (
    <Alert severity="warning">
      This content requires its specialized presentation.
    </Alert>
  );
}

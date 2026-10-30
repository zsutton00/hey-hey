import { Alert, Stack, Typography } from "@mui/material";
import type { ReconciliationPresentation } from "./reconciliationPresentation";
import {
  readFeatureRequirementsSection,
  isCanonicalFeatureRequirementsDefinition,
} from "../../utils/featureRequirementsSection";
import { StructuredRequirementsDiffView } from "../shared/StructuredRequirementsView";
import { DiffRenderer } from "../SuggestedContent/DiffRenderer";
import { VisualProposalSectionComparison } from "../ProposalDispatchers/VisualProposalSectionComparison";
import { ModeFilesSectionRenderer } from "../shared/ModeFilesSectionRenderer";
import { ModeSettingsSectionRenderer } from "../shared/ModeSettingsSectionRenderer";
import {
  isModeFilesSection,
  isModeSettingsSection,
} from "../shared/modeFilesSection";
import { ImageSectionRenderer } from "../shared/ImageSectionRenderer";
import { isImageSectionDefinition } from "../shared/imageSection";
import { JsonSectionRenderer } from "../shared/JsonSectionRenderer";

/** Uses ordinary review's domain renderers instead of flattening structured records. */
export function ReconciliationFieldComparison({
  path,
  before,
  after,
  presentation,
  labels,
}: {
  labels: { before: string; after: string };
  path: string;
  before: unknown;
  after: unknown;
  presentation: ReconciliationPresentation;
}) {
  const definition =
    presentation.kind === "work-item" ? presentation.definition : undefined;
  const [, key, ...nested] = path.split(".");
  const section = path.startsWith("sections.")
    ? definition?.sections.find((section) => section.key === key)
    : undefined;
  if (
    presentation.kind === "work-item" &&
    path.startsWith("sections.") &&
    !section
  )
    return (
      <Alert severity="warning">
        The section definition is unavailable. Its comparison cannot be
        displayed.
      </Alert>
    );
  if (isCanonicalFeatureRequirementsDefinition(definition?.key, section)) {
    // The merge treats the records array atomically; history can carry the whole section.
    const sectionValue = (value: unknown) =>
      nested.length === 1 && nested[0] === "records"
        ? { records: value ?? [] }
        : value;
    const oldState = readFeatureRequirementsSection(sectionValue(before));
    const newState = readFeatureRequirementsSection(sectionValue(after));
    if (oldState.status === "invalid" || newState.status === "invalid")
      return (
        <Alert severity="error">
          Requirements cannot be displayed because their content is invalid.
        </Alert>
      );
    return (
      <StructuredRequirementsDiffView
        before={oldState.status === "absent" ? [] : oldState.records}
        after={newState.status === "absent" ? [] : newState.records}
        splitLabels={labels}
        defaultViewMode="split"
      />
    );
  }
  if (section && nested.length)
    return (
      <Alert severity="warning">
        This partial structured change needs its complete section to display a
        comparison.
      </Alert>
    );
  if (section?.kind === "html/css" || section?.kind === "structured-mockup")
    return (
      <VisualProposalSectionComparison
        kind={section.kind}
        label={section.label}
        definition={section}
        before={before}
        after={after}
      />
    );
  if (
    section &&
    isModeFilesSection({
      typeKey: definition?.key,
      key: section.key,
      kind: section.kind,
    })
  )
    return (
      <ModeFilesSectionRenderer
        content={after}
        comparison={{ currentContent: before, defaultViewMode: "split" }}
      />
    );
  if (
    section &&
    isModeSettingsSection({
      typeKey: definition?.key,
      key: section.key,
      kind: section.kind,
    })
  )
    return (
      <ModeSettingsSectionRenderer content={after} previousContent={before} />
    );
  if (section && (isImageSectionDefinition(section) || section.kind === "json"))
    return (
      <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
        {([before, after] as const).map((content, index) => (
          <Stack key={index} sx={{ flex: 1, minWidth: 0 }} spacing={1}>
            <Typography variant="caption">
              {index === 0 ? labels.before : labels.after}
            </Typography>
            {isImageSectionDefinition(section) ? (
              <ImageSectionRenderer content={content} label={section.label} />
            ) : (
              <JsonSectionRenderer content={content} />
            )}
          </Stack>
        ))}
      </Stack>
    );
  const text = (value: unknown): string =>
    value == null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);
  return (
    <DiffRenderer
      splitLabels={labels}
      oldContent={text(before)}
      newContent={text(after)}
      defaultViewMode="split"
      showViewModeToggle
    />
  );
}

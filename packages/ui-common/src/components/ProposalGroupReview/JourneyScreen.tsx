import React from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type { ProposalGroupSnapshot } from "../../api";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import { resolveProposalWorkItemSections } from "../ProposalDispatchers/workItemProposalSections";
import { HtmlCssSectionRenderer } from "../shared/HtmlCssSectionRenderer";
import { StructuredMockupSectionRenderer } from "../shared/StructuredMockupSectionRenderer";
import { FunctionalDialog } from "../Modals/FunctionalDialog";
import { useModalState } from "../Modals/useModalState";
import { MockupBrowserPencil } from "../shared/MockupBrowserPencil";
import type { MockupPageSource } from "../../utils/mockupPageUrl";
import {
  decodeHtmlCssSectionContent,
  decodeStructuredMockupSectionContent,
} from "../../utils/workItemSections";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";

export const JourneyScreen: React.FC<{
  name: string;
  source:
    | Extract<MockupPageSource, { kind: "workItem" }>
    | Omit<Extract<MockupPageSource, { kind: "proposal" }>, "sectionKey">;
  sections: readonly { key: string; materializedMarkdown: unknown }[];
  group: ProposalGroupSnapshot;
  children: React.ReactNode;
}> = ({ name, source, sections, group, children }) => {
  const [open, setOpen, ownerKey] = useModalState(false);
  const registry = useWorkItemTypeByKey(
    group.organizationId,
    group.projectId,
    "mockup",
  );
  const visualSections = registry.workItemTypeDefinition
    ? resolveProposalWorkItemSections({
        definition: registry.workItemTypeDefinition,
        proposedSections: sections.map((section) => ({
          key: section.key,
          content: section.materializedMarkdown,
        })),
      }).filter(
        ({ kind }) => kind === "html/css" || kind === "structured-mockup",
      )
    : [];
  const description = sections.find(
    ({ key }) => key === "purpose" || key === "description",
  )?.materializedMarkdown;
  const renderSections = (context: "inline" | "page") =>
    visualSections.map((section) =>
      section.kind === "html/css" ? (
        <HtmlCssSectionRenderer
          key={section.key}
          content={section.proposedValue}
          definition={section.definition}
          context={context}
          organizationId={group.organizationId}
          projectId={group.projectId}
        />
      ) : (
        <StructuredMockupSectionRenderer
          key={section.key}
          content={section.proposedValue}
          definition={section.definition}
          context={context}
          organizationId={group.organizationId}
          projectId={group.projectId}
        />
      ),
    );
  return (
    <Stack spacing={1}>
      <Box
        sx={{
          position: "relative",
          bgcolor: "white",
          borderRadius: 1,
          boxShadow: 1,
          overflow: "hidden",
          "& [data-testid='html-css-section-controls']": { display: "none" },
        }}
      >
        <Box inert sx={{ pointerEvents: "none" }}>
          {visualSections.length ? (
            renderSections("inline")
          ) : (
            <Alert severity="info">Screen preview unavailable</Alert>
          )}
        </Box>
        {visualSections.length ? (
          <ButtonBase
            data-testid="journey-screen-preview"
            aria-label={`View ${name} full size`}
            onClick={() => setOpen(true)}
            sx={{ position: "absolute", inset: 0 }}
          />
        ) : null}
        <Stack spacing={1} sx={{ position: "absolute", top: 8, right: 8 }}>
          {visualSections.map((section) => {
            const content =
              section.kind === "html/css"
                ? decodeHtmlCssSectionContent(section.proposedValue)
                : decodeStructuredMockupSectionContent(section.proposedValue);
            return (
              <MockupBrowserPencil
                key={section.key}
                source={
                  source.kind === "proposal"
                    ? { ...source, sectionKey: section.key }
                    : source
                }
                organizationId={group.organizationId}
                projectId={group.projectId}
                sizeKey={
                  content?.sizeKey ??
                  section.definition.defaultSizeKey ??
                  "default"
                }
              />
            );
          })}
        </Stack>
      </Box>
      <FunctionalDialog
        open={open}
        ownerKey={ownerKey}
        onClose={() => setOpen(false)}
        maxWidth="xl"
        fullWidth
      >
        <DialogTitle>
          {name}
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogTitle>
        <DialogContent data-testid="journey-screen-full-size">
          {renderSections("page")}
        </DialogContent>
      </FunctionalDialog>
      <Typography variant="subtitle2">{name}</Typography>
      {typeof description === "string" && description ? (
        <Typography
          component="div"
          variant="caption"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          <MarkdownRenderer>{description}</MarkdownRenderer>
        </Typography>
      ) : null}
      {children}
    </Stack>
  );
};

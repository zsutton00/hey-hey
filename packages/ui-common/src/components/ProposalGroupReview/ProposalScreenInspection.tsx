import React, { useState } from "react";
import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import type { ProposalResponseDto, ProposalReviewNoteRecord } from "../../api";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";
import {
  decodeHtmlCssSectionContent,
  decodeStructuredMockupSectionContent,
} from "../../utils/workItemSections";
import { isCreateTaskUpdates } from "../ProposalDispatchers/types";
import { resolveProposalWorkItemSections } from "../ProposalDispatchers/workItemProposalSections";
import { HtmlCssSectionRenderer } from "../shared/HtmlCssSectionRenderer";
import { StructuredMockupSectionRenderer } from "../shared/StructuredMockupSectionRenderer";

export type ScreenReviewNote = ProposalReviewNoteRecord;

/** Review notes are host feedback; they never rewrite frozen screen content. */
export const ProposalScreenInspection: React.FC<{
  proposal: ProposalResponseDto;
  notes: readonly ScreenReviewNote[];
  onAddNote: (note: ScreenReviewNote) => Promise<void>;
  frozenRevision: number;
}> = ({ proposal, notes, onAddNote, frozenRevision }) => {
  const type = isCreateTaskUpdates(proposal)
    ? proposal.updates.type
    : undefined;
  const registry = useWorkItemTypeByKey(
    proposal.organizationId,
    proposal.projectId,
    type,
  );
  const [target, setTarget] = useState<ScreenReviewNote | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isCreateTaskUpdates(proposal) || !registry.workItemTypeDefinition) {
    return <Alert severity="info">The screen preview is unavailable.</Alert>;
  }
  const sections = resolveProposalWorkItemSections({
    definition: registry.workItemTypeDefinition,
    proposedSections: proposal.updates.sections,
  });
  return (
    <Stack spacing={2} data-testid="journey-screen-inspection">
      {sections
        .filter(
          ({ kind }) => kind === "html/css" || kind === "structured-mockup",
        )
        .map((section) => (
          <Stack key={section.key} spacing={1}>
            <Typography>{section.label}</Typography>
            {section.kind === "html/css" ? (
              <HtmlCssSectionRenderer
                content={section.proposedValue}
                definition={section.definition}
                context="page"
                organizationId={proposal.organizationId}
                projectId={proposal.projectId}
                materializedProposalId={proposal.id}
                onCreateAnnotation={(target) =>
                  setTarget({
                    proposalId: proposal.id,
                    review: {
                      noteId: crypto.randomUUID(),
                      frozenRevision,
                      note: "",
                      sectionKey: section.key,
                      sizeKey:
                        decodeHtmlCssSectionContent(section.proposedValue)
                          ?.sizeKey ??
                        section.definition.defaultSizeKey ??
                        "default",
                      target,
                    },
                  })
                }
                mockupSource={{
                  kind: "proposal",
                  proposalId: proposal.id,
                  sectionKey: section.key,
                }}
              />
            ) : (
              <StructuredMockupSectionRenderer
                content={section.proposedValue}
                definition={section.definition}
                context="page"
                materializedProposalId={proposal.id}
                organizationId={proposal.organizationId}
                projectId={proposal.projectId}
                onCreateAnnotation={(target) =>
                  setTarget({
                    proposalId: proposal.id,
                    review: {
                      noteId: crypto.randomUUID(),
                      frozenRevision,
                      note: "",
                      sectionKey: section.key,
                      sizeKey:
                        decodeStructuredMockupSectionContent(
                          section.proposedValue,
                        )?.sizeKey ??
                        section.definition.defaultSizeKey ??
                        "default",
                      target,
                    },
                  })
                }
              />
            )}
          </Stack>
        ))}
      {target ? (
        <Stack spacing={1}>
          <TextField
            label="Screen annotation"
            multiline
            value={note}
            onChange={(event) => setNote(event.target.value)}
            slotProps={{
              htmlInput: { "data-testid": "journey-screen-annotation-note" },
            }}
          />
          <Button
            data-testid="journey-screen-annotation-save"
            disabled={!note.trim() || saving}
            onClick={() => {
              setSaving(true);
              setError(null);
              void onAddNote({
                ...target,
                review: { ...target.review, note: note.trim() },
              })
                .then(() => {
                  setTarget(null);
                  setNote("");
                })
                .catch((failure: unknown) =>
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "The note could not be saved.",
                  ),
                )
                .finally(() => setSaving(false));
            }}
          >
            Save review note
          </Button>
        </Stack>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notes.map((entry, index) => (
        <Alert key={index} severity="info">
          {entry.review.note}
        </Alert>
      ))}
    </Stack>
  );
};

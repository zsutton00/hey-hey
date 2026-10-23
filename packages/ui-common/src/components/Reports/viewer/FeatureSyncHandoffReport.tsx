import { Stack, Typography } from "@mui/material";
import React from "react";
import type {
  FeatureSyncHandoffReportNote,
  FeatureSyncHandoffReportPayload,
} from "../../../api";
import {
  ReportItemCard,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const FeatureSyncHandoffReport: ReportRenderer<
  FeatureSyncHandoffReportPayload
> = ({ payload, reportTestId }) => {
  const notes = payload.notes;

  return (
    <Stack data-testid={`${reportTestId}-feature-sync-handoff`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-feature-sync-handoff-summary`}
        value={payload.summary}
      />
      <ReportPanel
        emptyMessage="No internal handoff notes were captured."
        isEmpty={notes.length === 0}
        testId={`${reportTestId}-feature-sync-handoff-notes`}
        title="Notes"
      >
        <Stack
          data-testid={`${reportTestId}-feature-sync-handoff-notes-list`}
          spacing={1}
        >
          {notes.map((note, index) => (
            <FeatureSyncHandoffNoteCard
              index={index}
              key={`note-${index}`}
              note={note}
              testIdPrefix={`${reportTestId}-feature-sync-handoff-note-${index}`}
            />
          ))}
        </Stack>
      </ReportPanel>
    </Stack>
  );
};

interface FeatureSyncHandoffNoteCardProps {
  index: number;
  note: FeatureSyncHandoffReportNote;
  testIdPrefix: string;
}

const FeatureSyncHandoffNoteCard: React.FC<FeatureSyncHandoffNoteCardProps> = ({
  index,
  note,
  testIdPrefix,
}) => (
  <ReportItemCard
    testId={`${testIdPrefix}-card`}
    title={
      <Typography data-testid={`${testIdPrefix}-title`} variant="subtitle2">
        {`${index + 1}. ${note.category}`}
      </Typography>
    }
  >
    <ReportLabeledText
      label="Note"
      renderMentions
      testId={`${testIdPrefix}-text-block`}
      value={note.text}
    />
  </ReportItemCard>
);

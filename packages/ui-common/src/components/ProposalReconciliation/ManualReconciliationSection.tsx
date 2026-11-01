import { Stack, Typography } from "@mui/material";
import {
  UnifiedWorkItemEditorSection,
  type Props,
} from "../WorkItem/UnifiedWorkItemEditorSection";

/** Keep both values in their existing typed section presentation. */
export function ManualReconciliationSection({
  current,
  ...props
}: Props & { current: string }) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{props.section.header.text}</Typography>
      <Typography variant="caption">Current content</Typography>
      <UnifiedWorkItemEditorSection
        {...props}
        disabled
        getContentForSection={() => current}
        handleSectionChange={() => undefined}
      />
      <Typography variant="caption">Resolved content</Typography>
      <UnifiedWorkItemEditorSection {...props} />
    </Stack>
  );
}

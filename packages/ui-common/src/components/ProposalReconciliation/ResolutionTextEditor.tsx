import { Stack, Typography } from "@mui/material";
import { SmarterTextAreaEditor } from "../SmarterTextAreaCard/SmarterTextAreaEditor";
import { getInputBorderSx } from "../../contexts/ThemeContext";

/** Modal-local editing preserves canonical mentions through the shared rich-text editor. */
export function ResolutionTextEditor({
  value,
  onChange,
  disabled,
  label,
  organizationId,
  projectId,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label: string;
  organizationId: string;
  projectId: string;
}) {
  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      <Typography variant="body2">{label}</Typography>
      <SmarterTextAreaEditor
        context={{ organizationId, projectId, conversationId: null }}
        initialValue={value}
        onChange={onChange}
        editable={!disabled}
        rendering="rich"
        presentation={{
          contentEditableAriaLabel: label,
          contentEditableTestId: "resolution-text-editor",
          containerSx: (theme) => ({
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            "&:focus-within": { borderColor: "primary.main" },
            ...getInputBorderSx(theme, { disabled }),
          }),
          contentEditableStyle: {
            minHeight: 140,
            padding: 14,
            outline: "none",
          },
        }}
      />
    </Stack>
  );
}

import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import { DialogContent, DialogTitle } from "@mui/material";
import type { ExternalEditorPreference } from "./editorPreference";
import { ExternalEditorPreferenceControl } from "./ExternalEditorPreferenceControl";

interface ExternalEditorPreferenceDialogProps {
  open: boolean;
  onCancel: () => void;
  onSaved: (preference: ExternalEditorPreference) => void;
}

export const ExternalEditorPreferenceDialog = ({
  open,
  onCancel,
  onSaved,
}: ExternalEditorPreferenceDialogProps) => (
  <Dialog
    open={open}
    onClose={onCancel}
    fullWidth
    maxWidth="sm"
    data-testid="external-editor-setup-dialog"
  >
    <DialogTitle>Choose an editor for source links</DialogTitle>
    <DialogContent>
      <ExternalEditorPreferenceControl onCancel={onCancel} onSaved={onSaved} />
    </DialogContent>
  </Dialog>
);

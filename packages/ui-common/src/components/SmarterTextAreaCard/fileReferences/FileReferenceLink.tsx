import { useModalState } from "../../Modals/useModalState";
import { ModalWorkOwner } from "../../Modals/ModalWorkOwner";
import { Box, Link } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useContext, type MouseEvent } from "react";
import {
  buildExternalEditorUrl,
  readExternalEditorPreference,
  type ExternalEditorPreference,
  type SourceReference,
} from "../../EditorPreference";
import { ExternalEditorPreferenceDialog } from "../../EditorPreference/ExternalEditorPreferenceDialog";
import { useProjectContext } from "../../../contexts";
import { MentionEditorContext } from "../EditorContext";
import {
  FileReferenceActions,
  type FileReferenceActionContext,
  type FileReferenceEditorAction,
} from "./FileReferenceActions";
import type { FileReferenceValueV1 } from "./types";

export type FileReferenceRenderMode =
  "service-qualified" | "path" | "file-name";
export type FileReferenceEditorActivation = "inline" | "context-menu";

interface FileReferenceLinkProps {
  value: FileReferenceValueV1;
  renderMode?: FileReferenceRenderMode;
  editorActivation?: FileReferenceEditorActivation;
}

const DEFAULT_FILE_REFERENCE_RENDER_MODE = "service-qualified" as const;

const resolveMappedSource = (
  _value: FileReferenceValueV1,
): SourceReference | null => null;

const resolveFileReferenceLabel = (
  value: FileReferenceValueV1,
  renderMode: FileReferenceRenderMode,
): string => {
  switch (renderMode) {
    case "service-qualified":
      return `${value.serviceName}/${value.normalizedPath}`;
    case "path":
      return value.normalizedPath;
    case "file-name":
      return value.normalizedPath.split("/").at(-1) ?? value.normalizedPath;
    default: {
      const unreachable: never = renderMode;
      return unreachable;
    }
  }
};

export const FILE_REFERENCE_FONT_FAMILY = "monospace";

export const FileReferenceOpenAffordance = () => (
  <Box
    component="span"
    data-testid="file-reference-open-affordance"
    sx={{
      display: "inline-flex",
      alignItems: "center",
      gap: 0.25,
      ml: 0.75,
      fontFamily: "inherit",
    }}
  >
    <OpenInNewIcon fontSize="inherit" aria-hidden />
    Open
  </Box>
);

const openSource = (
  preference: ExternalEditorPreference,
  sourceReference: SourceReference,
): void => {
  window.open(
    buildExternalEditorUrl(preference, sourceReference),
    "_self",
    "noopener,noreferrer",
  );
};

export const FileReferenceLink = ({
  value,
  renderMode = DEFAULT_FILE_REFERENCE_RENDER_MODE,
  editorActivation = "inline",
}: FileReferenceLinkProps) => {
  const editorContext = useContext(MentionEditorContext);
  const projectContext = useProjectContext();
  const [isSetupOpen, setIsSetupOpen, isSetupOpenOwnerKey] =
    useModalState(false);
  const sourceReference = resolveMappedSource(value);
  const label = resolveFileReferenceLabel(value, renderMode);
  const contextCandidate = editorContext ?? projectContext;
  const actionContext: FileReferenceActionContext | null =
    contextCandidate?.organizationId && contextCandidate.projectId
      ? {
          organizationId: contextCandidate.organizationId,
          projectId: contextCandidate.projectId,
        }
      : null;

  const activateEditor = () => {
    if (!sourceReference) return;

    const preference = readExternalEditorPreference();
    if (preference) {
      openSource(preference, sourceReference);
      return;
    }
    setIsSetupOpen(true);
  };

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    activateEditor();
  };

  const handleSaved = (preference: ExternalEditorPreference) => {
    setIsSetupOpen(false);
    if (sourceReference) openSource(preference, sourceReference);
  };

  const editorAction: FileReferenceEditorAction = sourceReference
    ? { status: "available", onSelect: activateEditor }
    : { status: "unavailable" };

  const reference = (
    <Box
      component="span"
      title={`${value.serviceName}: ${value.normalizedPath}`}
      data-testid="file-reference"
      data-service-id={value.serviceId}
      sx={{
        borderRadius: 1,
        bgcolor: "action.hover",
        px: 0.5,
        py: "1px",
        fontFamily: FILE_REFERENCE_FONT_FAMILY,
      }}
    >
      {sourceReference && editorActivation === "inline" ? (
        <Link
          href="#"
          onClick={handleClick}
          data-testid="file-reference-link"
          data-source-path={sourceReference.path}
          sx={{ fontFamily: "inherit" }}
        >
          {label}
          <FileReferenceOpenAffordance />
        </Link>
      ) : (
        label
      )}
    </Box>
  );

  return (
    <>
      {actionContext ? (
        <FileReferenceActions
          context={actionContext}
          editorAction={editorAction}
          value={value}
        >
          {reference}
        </FileReferenceActions>
      ) : (
        reference
      )}
      <ModalWorkOwner.Provider value={isSetupOpenOwnerKey}>
        <ExternalEditorPreferenceDialog
          open={isSetupOpen}
          onCancel={() => setIsSetupOpen(false)}
          onSaved={handleSaved}
        />
      </ModalWorkOwner.Provider>
    </>
  );
};

import { Box, Link } from "@mui/material";
import { useContext, useState, type MouseEvent } from "react";
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
  | "service-qualified"
  | "path"
  | "file-name";
export type FileReferenceEditorActivation = "inline" | "context-menu";

interface FileReferenceLinkProps {
  value: FileReferenceValueV1;
  renderMode?: FileReferenceRenderMode;
  editorActivation?: FileReferenceEditorActivation;
}

const DEFAULT_FILE_REFERENCE_RENDER_MODE = "service-qualified" as const;

const resolveMappedSource = (
  _value: FileReferenceValueV1
): SourceReference | null => null;

const resolveFileReferenceLabel = (
  value: FileReferenceValueV1,
  renderMode: FileReferenceRenderMode
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

const openSource = (
  preference: ExternalEditorPreference,
  sourceReference: SourceReference
): void => {
  window.open(
    buildExternalEditorUrl(preference, sourceReference),
    "_self",
    "noopener,noreferrer"
  );
};

export const FileReferenceLink = ({
  value,
  renderMode = DEFAULT_FILE_REFERENCE_RENDER_MODE,
  editorActivation = "inline",
}: FileReferenceLinkProps) => {
  const editorContext = useContext(MentionEditorContext);
  const projectContext = useProjectContext();
  const [isSetupOpen, setIsSetupOpen] = useState(false);
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
        fontFamily: "monospace",
      }}
    >
      {sourceReference && editorActivation === "inline" ? (
        <Link
          href="#"
          onClick={handleClick}
          data-testid="file-reference-link"
          data-source-path={sourceReference.path}
        >
          {label}
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
      <ExternalEditorPreferenceDialog
        open={isSetupOpen}
        onCancel={() => setIsSetupOpen(false)}
        onSaved={handleSaved}
      />
    </>
  );
};

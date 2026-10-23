import CloseIcon from "@mui/icons-material/Close";
import CodeIcon from "@mui/icons-material/Code";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  SvgIcon,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CliReadChangedFileDetail,
  CliReadChangedFileInventoryEntry,
} from "../../../api";
import { FileReferenceLink } from "../../SmarterTextAreaCard/fileReferences/FileReferenceLink";
import type { FileReferenceValueV1 } from "../../SmarterTextAreaCard/fileReferences/types";
import {
  EDIT_TYPE_COLORS,
  EDIT_TYPE_LABELS,
  type EditType,
} from "./changedFilePatchPresentation";
import {
  DIFF_PRESENTATION_MODES,
  FullFileSplitView,
  type DiffPresentationMode,
} from "./FullFileSplitView";
import type { LocatedDecision } from "./locatedDecisions";
import { resolveFileTypeIcon } from "./resolveFileTypeIcon";

export interface CollatedFileDiffModalProps {
  open: boolean;
  onClose: () => void;
  entries: CliReadChangedFileInventoryEntry[];
  selectedIdentity: string | null;
  onSelect: (identity: string) => void;
  detail: CliReadChangedFileDetail | null;
  detailState:
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready" };
  onRetryDetail: () => void;
  readState:
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready" };
  onRetry: () => void;
  serviceNamesState:
    | { status: "loading" | "error" }
    | { status: "ready"; serviceNamesById: ReadonlyMap<string, string> };
  /**
   * Located IMPLEMENT-report decisions to anchor inline in the diff. For the
   * selected file, only decisions whose `location.file` matches that file's
   * path are shown. Defaults to none, in which case the diff renders as today.
   */
  decisions?: LocatedDecision[];
}

const FILE_LIST_WIDTH_STORAGE_KEY = "diffViewer.fileListWidth";
const FILE_LIST_WIDTH_DEFAULT = 280;
const FILE_LIST_WIDTH_MIN = 180;
const FILE_LIST_WIDTH_MAX = 560;
const PRESENTATION_MODE_STORAGE_KEY = "diffViewer.presentationMode";

type MobileDiffSurface = "file-list" | "file-detail";

const clampFileListWidth = (value: number): number => {
  if (!Number.isFinite(value)) return FILE_LIST_WIDTH_DEFAULT;
  return Math.min(
    FILE_LIST_WIDTH_MAX,
    Math.max(FILE_LIST_WIDTH_MIN, Math.round(value))
  );
};

const readStoredFileListWidth = (): number => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return FILE_LIST_WIDTH_DEFAULT;
    }
    const raw = window.localStorage.getItem(FILE_LIST_WIDTH_STORAGE_KEY);
    if (raw === null) return FILE_LIST_WIDTH_DEFAULT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return FILE_LIST_WIDTH_DEFAULT;
    return clampFileListWidth(parsed);
  } catch {
    return FILE_LIST_WIDTH_DEFAULT;
  }
};

const writeStoredFileListWidth = (value: number): void => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(FILE_LIST_WIDTH_STORAGE_KEY, String(value));
  } catch {
    // localStorage unavailable
  }
};

const isDiffPresentationMode = (
  value: unknown
): value is DiffPresentationMode =>
  value === DIFF_PRESENTATION_MODES.sideBySide ||
  value === DIFF_PRESENTATION_MODES.vertical;

const readStoredPresentationMode = (): DiffPresentationMode => {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return DIFF_PRESENTATION_MODES.sideBySide;
    }
    const stored = window.localStorage.getItem(PRESENTATION_MODE_STORAGE_KEY);
    return isDiffPresentationMode(stored)
      ? stored
      : DIFF_PRESENTATION_MODES.sideBySide;
  } catch {
    return DIFF_PRESENTATION_MODES.sideBySide;
  }
};

const writeStoredPresentationMode = (value: unknown): void => {
  if (!isDiffPresentationMode(value)) return;
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(PRESENTATION_MODE_STORAGE_KEY, value);
  } catch {
    // localStorage unavailable
  }
};

const HIDE_COMMENTS_STORAGE_KEY = "diffViewer.hideComments";

const InlinePresentationIcon = () => (
  <SvgIcon viewBox="0 0 2048 2048" fontSize="small">
    <path d="M1792 0v2048H256V0zM384 128v384h1280V128zm1280 1408H384v384h1280zm0-256V640H384v640z" />
  </SvgIcon>
);

const SideBySidePresentationIcon = () => (
  <SvgIcon viewBox="0 0 2048 2048" fontSize="small">
    <path d="M0 384h896v1280H0zm768 1152V768H128v768zM128 512v128h640V512zm1920-128v1280h-896V384zm-128 896h-640v256h640zm0-768h-640v512h640z" />
  </SvgIcon>
);

const readStoredHideComments = (): boolean => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    return window.localStorage.getItem(HIDE_COMMENTS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const writeStoredHideComments = (value: boolean): void => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(HIDE_COMMENTS_STORAGE_KEY, String(value));
  } catch {
    // localStorage unavailable
  }
};

const getPatchIdentity = (patch: CliReadChangedFileInventoryEntry): string =>
  `${patch.serviceId}\u0000${patch.repoPath}\u0000${patch.filePath}`;

const getRepoLabel = (repoPath: string): string => {
  const normalized = repoPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? repoPath;
};

interface ChangedFileReferenceBaseProps {
  patch: CliReadChangedFileInventoryEntry;
  serviceName: string;
}

type ChangedFileReferenceProps = ChangedFileReferenceBaseProps &
  (
    | { presentation: "list"; editType: EditType }
    | { presentation: "selected-file-heading" }
  );

const ChangedFileReference = (props: ChangedFileReferenceProps) => {
  const { patch, presentation, serviceName } = props;
  const value: FileReferenceValueV1 = {
    version: 1,
    serviceId: patch.serviceId,
    serviceName,
    normalizedPath: patch.filePath,
  };

  if (presentation === "selected-file-heading") {
    return <FileReferenceLink value={value} />;
  }

  const { editType } = props;

  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", minWidth: 0 }}>
      <Box
        component="span"
        role="img"
        aria-label={`${EDIT_TYPE_LABELS[editType]} file`}
        data-testid="collated-file-diff-modal-status-indicator"
        data-edit-type={editType}
        sx={{
          width: 6,
          height: 6,
          minWidth: 6,
          borderRadius: "50%",
          bgcolor: EDIT_TYPE_COLORS[editType],
          mt: 0.75,
          mr: 0.75,
          flexShrink: 0,
        }}
      />
      <Box sx={{ minWidth: 0 }}>
        <FileReferenceLink
          value={value}
          renderMode="file-name"
          editorActivation="context-menu"
        />
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="collated-file-reference-path"
          data-file-path={value.normalizedPath}
          sx={{
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {value.normalizedPath}
        </Typography>
      </Box>
    </Box>
  );
};

export const CollatedFileDiffModal: React.FC<CollatedFileDiffModalProps> = ({
  open,
  onClose,
  entries,
  selectedIdentity,
  onSelect,
  detail,
  detailState,
  onRetryDetail,
  readState,
  onRetry,
  serviceNamesState,
  decisions,
}) => {
  const theme = useTheme();
  const isPhone = useMediaQuery(theme.breakpoints.down("sm"));
  const [fileListWidth, setFileListWidth] = useState<number>(() =>
    readStoredFileListWidth()
  );
  const [hideComments, setHideComments] = useState<boolean>(() =>
    readStoredHideComments()
  );
  const [desktopPresentationMode, setDesktopPresentationMode] =
    useState<DiffPresentationMode>(() => readStoredPresentationMode());
  const [fileFilter, setFileFilter] = useState("");
  const [mobileSurface, setMobileSurface] =
    useState<MobileDiffSurface>("file-list");
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
    null
  );

  const sortedPatches = useMemo(
    () =>
      [...entries].sort(
        (a, b) =>
          a.filePath.localeCompare(b.filePath, undefined, {
            sensitivity: "base",
          }) ||
          getRepoLabel(a.repoPath).localeCompare(
            getRepoLabel(b.repoPath),
            undefined,
            {
              sensitivity: "base",
            }
          ) ||
          a.serviceId.localeCompare(b.serviceId, undefined, {
            sensitivity: "base",
          })
      ),
    [entries]
  );
  const filteredPatches = useMemo(() => {
    const query = fileFilter.trim().toLocaleLowerCase();
    if (query.length === 0 || serviceNamesState.status !== "ready") {
      return sortedPatches;
    }
    return sortedPatches.filter((patch) => {
      const serviceName = serviceNamesState.serviceNamesById.get(
        patch.serviceId
      );
      return [patch.filePath, getRepoLabel(patch.repoPath), serviceName]
        .filter((value): value is string => value !== undefined)
        .some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [fileFilter, serviceNamesState, sortedPatches]);
  const resolvedIndex = (() => {
    if (selectedIdentity !== null) {
      const idx = sortedPatches.findIndex(
        (p) => getPatchIdentity(p) === selectedIdentity
      );
      if (idx !== -1) return idx;
    }
    return sortedPatches.length > 0 ? 0 : -1;
  })();
  const selectedPatch =
    resolvedIndex >= 0 ? sortedPatches[resolvedIndex] ?? null : null;
  const selectedPatchIdentity = selectedPatch
    ? getPatchIdentity(selectedPatch)
    : null;

  useEffect(() => {
    if (!open) {
      setMobileSurface("file-list");
      setFileFilter("");
    }
  }, [open]);

  const handleFileSelection = useCallback(
    (identity: string): void => {
      onSelect(identity);
      if (isPhone) setMobileSurface("file-detail");
    },
    [isPhone, onSelect]
  );

  const showFileList = !isPhone || mobileSurface === "file-list";
  const showFileDetail = !isPhone || mobileSurface === "file-detail";
  const presentationMode = isPhone
    ? DIFF_PRESENTATION_MODES.vertical
    : desktopPresentationMode;

  const getServiceName = (patch: CliReadChangedFileInventoryEntry): string => {
    if (serviceNamesState.status !== "ready") {
      throw new Error("Service names are not ready");
    }
    const serviceName = serviceNamesState.serviceNamesById.get(patch.serviceId);
    if (!serviceName) {
      throw new Error(`Missing service name for ${patch.serviceId}`);
    }
    return serviceName;
  };

  const selectedPatchFilePath = selectedPatch?.filePath ?? null;
  const fileDecisions = useMemo<LocatedDecision[]>(() => {
    if (selectedPatchFilePath === null || !decisions) return [];
    return decisions.filter(
      (decision) => decision.location.file === selectedPatchFilePath
    );
  }, [decisions, selectedPatchFilePath]);

  const handleHideCommentsChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.checked;
      setHideComments(next);
      writeStoredHideComments(next);
    },
    []
  );

  const handlePresentationModeChange = useCallback(
    (
      _event: React.MouseEvent<HTMLElement>,
      nextMode: DiffPresentationMode | null
    ): void => {
      if (!isDiffPresentationMode(nextMode)) return;
      setDesktopPresentationMode(nextMode);
      writeStoredPresentationMode(nextMode);
    },
    []
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragStateRef.current = {
        startX: event.clientX,
        startWidth: fileListWidth,
      };
      if (typeof event.currentTarget.setPointerCapture === "function") {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [fileListWidth]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;
      const delta = event.clientX - dragState.startX;
      setFileListWidth(clampFileListWidth(dragState.startWidth + delta));
    },
    []
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      const target = event.currentTarget;
      if (
        typeof target.hasPointerCapture === "function" &&
        typeof target.releasePointerCapture === "function" &&
        target.hasPointerCapture(event.pointerId)
      ) {
        target.releasePointerCapture(event.pointerId);
      }
      setFileListWidth((current) => {
        const clamped = clampFileListWidth(current);
        writeStoredFileListWidth(clamped);
        return clamped;
      });
    },
    []
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isPhone}
      maxWidth={false}
      slotProps={{
        paper: () => ({
          sx: {
            width: { xs: "100%", sm: "98vw" },
            height: { xs: "100%", sm: "88vh" },
            maxWidth: { xs: "100%", sm: "98vw" },
            minWidth: 0,
          },
          "data-testid": "collated-file-diff-modal-paper",
          "data-layout": isPhone ? "phone" : "desktop",
        }),
      }}
      data-testid="collated-file-diff-modal"
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          py: 1,
          px: { xs: 1, sm: 3 },
          minWidth: 0,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <CodeIcon />
        <Typography variant="h6" component="span" sx={{ flex: 1, minWidth: 0 }}>
          File Changes ({String(entries.length)})
        </Typography>
        {!isPhone ? (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={desktopPresentationMode}
            onChange={handlePresentationModeChange}
            aria-label="Diff presentation"
            data-testid="collated-file-diff-modal-presentation-selector"
          >
            <ToggleButton
              value={DIFF_PRESENTATION_MODES.vertical}
              aria-label="Inline"
              data-testid="collated-file-diff-modal-presentation-inline"
              sx={{ gap: 0.75 }}
            >
              <InlinePresentationIcon />
              Inline
            </ToggleButton>
            <ToggleButton
              value={DIFF_PRESENTATION_MODES.sideBySide}
              aria-label="Side-by-side"
              data-testid="collated-file-diff-modal-presentation-side-by-side"
              sx={{ gap: 0.75 }}
            >
              <SideBySidePresentationIcon />
              Side-by-side
            </ToggleButton>
          </ToggleButtonGroup>
        ) : null}
        <FormControlLabel
          sx={{ mr: 0.5, display: { xs: "none", sm: "inline-flex" } }}
          data-testid="collated-file-diff-modal-hide-comments-toggle"
          control={
            <Switch
              size="small"
              checked={hideComments}
              onChange={handleHideCommentsChange}
            />
          }
          label={<Typography variant="body2">Hide comments</Typography>}
        />
        <IconButton
          onClick={onClose}
          data-testid="collated-file-diff-modal-close"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent
        sx={{
          p: 0,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <Alert
          severity="warning"
          variant="outlined"
          sx={{ mx: { xs: 1, sm: 2 }, mt: 1.5, mb: 0, flexShrink: 0 }}
        >
          Showing file changes attributed to this agent session.
        </Alert>
        <Box
          sx={{
            display: "flex",
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {readState.status !== "ready" ? (
            <Alert
              severity={readState.status === "loading" ? "info" : "error"}
              data-testid="collated-file-diff-modal-read-state"
              action={
                readState.status === "error" ? (
                  <Button color="inherit" size="small" onClick={onRetry}>
                    Retry
                  </Button>
                ) : undefined
              }
              sx={{ m: 2, alignSelf: "flex-start" }}
            >
              {readState.status === "loading"
                ? "Loading changed files…"
                : readState.message}
            </Alert>
          ) : serviceNamesState.status !== "ready" ? (
            <Alert
              severity={
                serviceNamesState.status === "loading" ? "info" : "error"
              }
              data-testid="collated-file-diff-modal-service-state"
              sx={{ m: 2, alignSelf: "flex-start" }}
            >
              {serviceNamesState.status === "loading"
                ? "Loading service names for changed files…"
                : "Service names for these changed files are unavailable."}
            </Alert>
          ) : sortedPatches.length === 0 ? (
            <Alert
              severity="info"
              data-testid="collated-file-diff-modal-empty-state"
              sx={{ m: 2, alignSelf: "flex-start" }}
            >
              No changed files are available for this run.
            </Alert>
          ) : (
            <>
              {showFileList ? (
                <Box
                  sx={{
                    width: { xs: "100%", sm: fileListWidth },
                    minWidth: { xs: 0, sm: fileListWidth },
                    minHeight: 0,
                    borderRight: 1,
                    borderColor: "divider",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }}
                  data-testid="collated-file-diff-modal-file-list"
                >
                  <TextField
                    label="Filter files"
                    size="small"
                    value={fileFilter}
                    onChange={(event) => setFileFilter(event.target.value)}
                    data-testid="collated-file-diff-modal-file-filter"
                    sx={{ m: 1, flexShrink: 0 }}
                  />
                  <List dense disablePadding sx={{ overflowY: "auto" }}>
                    {filteredPatches.map((patch) => {
                      const editType = patch.status;
                      const {
                        Icon: FileTypeIcon,
                        ariaLabel: fileTypeAriaLabel,
                        color: fileTypeColor,
                      } = resolveFileTypeIcon(patch.filePath);

                      return (
                        <ListItemButton
                          key={getPatchIdentity(patch)}
                          selected={
                            getPatchIdentity(patch) === selectedPatchIdentity
                          }
                          onClick={() =>
                            handleFileSelection(getPatchIdentity(patch))
                          }
                          data-testid="collated-file-diff-modal-file-row"
                          data-file-path={patch.filePath}
                          data-service-id={patch.serviceId}
                          sx={{ py: { xs: 1.25, sm: 0.75 }, minHeight: 44 }}
                        >
                          <ListItemIcon sx={{ minWidth: 40 }}>
                            <Box
                              component="span"
                              sx={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 0.75,
                                fontSize: 16,
                                color: fileTypeColor ?? "text.secondary",
                              }}
                            >
                              <FileTypeIcon
                                aria-label={fileTypeAriaLabel}
                                size={16}
                              />
                            </Box>
                          </ListItemIcon>
                          <ListItemText
                            primary={
                              <ChangedFileReference
                                patch={patch}
                                presentation="list"
                                editType={editType}
                                serviceName={getServiceName(patch)}
                              />
                            }
                          />
                        </ListItemButton>
                      );
                    })}
                  </List>
                  {filteredPatches.length === 0 ? (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      data-testid="collated-file-diff-modal-filter-empty-state"
                      sx={{ px: 2, py: 1 }}
                    >
                      No changed files match this filter.
                    </Typography>
                  ) : null}
                </Box>
              ) : null}
              {!isPhone ? (
                <Box
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  data-testid="collated-file-diff-modal-resize-handle"
                  sx={{
                    width: 6,
                    flexShrink: 0,
                    cursor: "col-resize",
                    bgcolor: "divider",
                    opacity: 0.6,
                    transition:
                      "opacity 120ms ease, background-color 120ms ease",
                    "&:hover": {
                      opacity: 1,
                      bgcolor: "primary.main",
                    },
                    touchAction: "none",
                  }}
                />
              ) : null}
              {showFileDetail ? (
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0,
                    overflow: "hidden",
                    p: { xs: 1, sm: 2 },
                    display: "flex",
                    flexDirection: "column",
                  }}
                  data-testid="collated-file-diff-modal-diff-view"
                  data-mobile-surface={isPhone ? "file-detail" : undefined}
                >
                  {selectedPatch ? (
                    <>
                      {isPhone ? (
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 1,
                            mb: 1,
                            flexShrink: 0,
                          }}
                        >
                          <Button
                            startIcon={<ArrowBackIcon />}
                            onClick={() => setMobileSurface("file-list")}
                            data-testid="collated-file-diff-modal-back-to-files"
                          >
                            Back to files
                          </Button>
                          <FormControlLabel
                            data-testid="collated-file-diff-modal-mobile-hide-comments-toggle"
                            control={
                              <Switch
                                size="small"
                                checked={hideComments}
                                onChange={handleHideCommentsChange}
                              />
                            }
                            label={
                              <Typography variant="body2">
                                Hide comments
                              </Typography>
                            }
                            sx={{ mr: 0 }}
                          />
                        </Box>
                      ) : null}
                      <Box sx={{ mb: 1.5, flexShrink: 0, minWidth: 0 }}>
                        <ChangedFileReference
                          patch={selectedPatch}
                          presentation="selected-file-heading"
                          serviceName={getServiceName(selectedPatch)}
                        />
                      </Box>
                      {detailState.status === "ready" && detail ? (
                        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                          <FullFileSplitView
                            preContent={detail.preContent}
                            postContent={detail.postContent}
                            filePath={detail.filePath}
                            presentationMode={presentationMode}
                            hideComments={hideComments}
                            annotations={fileDecisions}
                          />
                        </Box>
                      ) : (
                        <Alert
                          severity={
                            detailState.status === "error" ? "error" : "info"
                          }
                          data-testid="collated-file-diff-modal-detail-state"
                          action={
                            detailState.status === "error" ? (
                              <Button
                                color="inherit"
                                size="small"
                                onClick={onRetryDetail}
                              >
                                Retry
                              </Button>
                            ) : undefined
                          }
                        >
                          {detailState.status === "error"
                            ? detailState.message
                            : "Loading selected file…"}
                        </Alert>
                      )}
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Select a file to view its changes.
                    </Typography>
                  )}
                </Box>
              ) : null}
            </>
          )}
        </Box>
      </DialogContent>
    </Dialog>
  );
};

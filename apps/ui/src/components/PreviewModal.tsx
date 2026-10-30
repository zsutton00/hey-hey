import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import CloseIcon from "@mui/icons-material/Close";
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
} from "@mui/material";
import React, { type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export interface PreviewModalProps {
  /** Whether the modal is shown. */
  open: boolean;
  ownerKey?: string;
  closeControl?: import("@hey-hey/ui-common/components/Modals").FunctionalDialogProps["closeControl"];
  workTitle?: string;
  /**
   * Called when the user dismisses the modal (close button, backdrop, or
   * Escape). Implementations should simply clear the state that drives `open`;
   * the modal performs no navigation of its own.
   */
  onClose: () => void;
  /**
   * Canonical page of the previewed item. When set, the `viewport` header shows
   * a title bar whose link closes the preview and navigates there without
   * confirmation. It sits outside the content boundary, so it is not
   * intercepted by the link confirmation.
   */
  openHref?: string;
  /** Title of the previewed item, shown as the Open link text. Defaults to "Open". */
  openTitle?: string;
  /** Arbitrary content rendered inside the overlay. */
  children?: ReactNode;
  /**
   * `viewport` fills ~80vw/80vh with a floating close button. `dialog` is a
   * content-height dialog whose content renders its own header and close
   * control.
   */
  layout?: "viewport" | "dialog";
  /** Width in px of the `dialog` layout, capped at the viewport. Defaults to 720. */
  dialogWidth?: number;
  /** Id of the element that names the dialog, forwarded as aria-labelledby. */
  labelledBy?: string;
  /** Id of the element that describes the dialog, forwarded as aria-describedby. */
  describedBy?: string;
}

const getInternalAnchorDestination = (
  event: React.MouseEvent<HTMLDivElement>,
) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  const anchor = target.closest("a");
  if (!(anchor instanceof HTMLAnchorElement) || !anchor.hasAttribute("href")) {
    return null;
  }

  const destination = new URL(anchor.href, window.location.href);
  if (destination.origin !== window.location.origin) {
    return null;
  }

  return `${destination.pathname}${destination.search}${destination.hash}`;
};

/**
 * Capture same-origin anchor activations before child router or native anchor
 * handlers run, while leaving external links and non-navigation controls alone.
 */
const captureInternalAnchorActivation = (
  event: React.MouseEvent<HTMLDivElement>,
  setPendingNavigation: (destination: string) => void,
) => {
  const destination = getInternalAnchorDestination(event);
  if (destination === null) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setPendingNavigation(destination);
};

/**
 * Content-agnostic overlay shell. Sizes to ~80vw/80vh with a backdrop and the
 * default MUI focus trap, and renders whatever is passed as children. Deliberately
 * free of any feature-specific logic so other surfaces (e.g. a future Context
 * Menu "Preview" action) can reuse the same shell unchanged.
 */
export const PreviewModal: React.FC<PreviewModalProps> = ({
  open,
  ownerKey,
  closeControl,
  workTitle,
  onClose,
  openHref,
  openTitle,
  children,
  layout = "viewport",
  dialogWidth = 720,
  labelledBy,
  describedBy,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!open) {
      setPendingNavigation(null);
    }
  }, [open]);

  const handleCancelNavigation = () => {
    setPendingNavigation(null);
  };

  const handleConfirmNavigation = () => {
    if (pendingNavigation === null) {
      return;
    }

    const destination = pendingNavigation;
    setPendingNavigation(null);
    onClose();
    navigate(destination);
  };

  const handleOpenClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      openHref === undefined ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    onClose();
    navigate(openHref);
  };

  return (
    <>
      <Dialog
        ownerKey={ownerKey}
        workTitle={
          workTitle ??
          (layout === "viewport" ? (openTitle ?? "Preview") : undefined)
        }
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        data-testid="preview-modal"
        maxWidth={false}
        onClose={onClose}
        open={open}
        slotProps={{
          paper: {
            sx:
              layout === "viewport"
                ? {
                    width: "80vw",
                    height: "80vh",
                    maxWidth: "80vw",
                    maxHeight: "80vh",
                  }
                : { width: dialogWidth, maxWidth: "100%", maxHeight: "90vh" },
          },
        }}
        closeControl={
          closeControl ?? (
            <IconButton
              aria-label={t("preview.close", "Close preview")}
              data-testid="preview-modal-close"
              onClick={onClose}
              size="small"
              sx={{
                color: "text.secondary",
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )
        }
      >
        {layout === "viewport" && (
          <Box
            data-testid="preview-modal-header"
            sx={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              minHeight: 64,
              pl: 3,
              pr: 13,
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            {openHref === undefined ? (
              <DialogTitle sx={{ p: 0 }}>{workTitle ?? "Preview"}</DialogTitle>
            ) : (
              <Link
                data-testid="preview-modal-open"
                href={openHref}
                onClick={handleOpenClick}
                sx={{
                  typography: "h6",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflowX: "auto",
                  maxWidth: "100%",
                  minHeight: 44,
                  display: "flex",
                  alignItems: "center",
                }}
                title={t("preview.open", "Open")}
                underline="hover"
              >
                {openTitle ?? t("preview.open", "Open")}
              </Link>
            )}
          </Box>
        )}

        <Box
          data-testid="preview-modal-content"
          onAuxClickCapture={(event) =>
            captureInternalAnchorActivation(event, setPendingNavigation)
          }
          onClickCapture={(event) =>
            captureInternalAnchorActivation(event, setPendingNavigation)
          }
          sx={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            overscrollBehavior: "contain",
            p: layout === "viewport" ? 3 : 2.5,
          }}
        >
          {children}
        </Box>
        <Dialog
          aria-describedby="preview-navigation-confirmation-description"
          aria-labelledby="preview-navigation-confirmation-title"
          data-testid="preview-navigation-confirmation"
          onClose={handleCancelNavigation}
          open={pendingNavigation !== null}
        >
          <DialogTitle id="preview-navigation-confirmation-title">
            {t("preview.navigationConfirmation.title", "Leave preview?")}
          </DialogTitle>
          <DialogContent id="preview-navigation-confirmation-description">
            {t(
              "preview.navigationConfirmation.description",
              "Continuing will close the preview and navigate to the selected page.",
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCancelNavigation}>
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              autoFocus
              onClick={handleConfirmNavigation}
              variant="contained"
            >
              {t("preview.navigationConfirmation.continue", "Continue")}
            </Button>
          </DialogActions>
        </Dialog>
      </Dialog>
    </>
  );
};

import { useState } from "react";
import { Dialog, DialogTitle, type DialogProps } from "@mui/material";
import { ModalMinimizeContext } from "./ModalMinimizeContext";
import { ModalShellContext } from "./ModalShellContext";
import { ModalVisibilityContext } from "./ModalVisibilityContext";
import {
  ModalWindowControls,
  type ModalWindowControlsProps,
} from "./ModalWindowControls";
import { useModalPresentation } from "./useModalPresentation";
import { useModalTitle } from "./useModalTitle";

export interface FunctionalDialogProps extends DialogProps {
  /** Accessible name for surfaces whose title is outside DialogTitle. */
  workTitle?: string;
  /** Stable owner identity used when an existing surface is opened again. */
  ownerKey?: string;
  /** Existing close control retains the consumer’s busy-state and dismissal rules. */
  closeControl?: ModalWindowControlsProps["closeControl"];
}

/** Logical open owns the content lifetime; presentation alone may be minimized. */
export function FunctionalDialog({
  open,
  onClose,
  children,
  workTitle,
  ownerKey,
  closeControl,
  sx,
  keepMounted,
  ...props
}: FunctionalDialogProps) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { title, needsHeading } = useModalTitle(
    open,
    root,
    workTitle,
    props["aria-labelledby"],
  );
  const { hidden, visible, minimize, rememberFocus, childrenHidden } =
    useModalPresentation(open, title || workTitle || "Dialog", root, ownerKey);

  return (
    <ModalMinimizeContext.Provider value={minimize}>
      <ModalShellContext.Provider value={true}>
        <ModalVisibilityContext.Provider value={childrenHidden}>
          <Dialog
            {...props}
            ref={setRoot}
            inert={hidden}
            onFocusCapture={(event) => {
              props.onFocusCapture?.(event);
              rememberFocus(event);
            }}
            open={visible}
            closeAfterTransition={
              hidden ? false : (props.closeAfterTransition ?? true)
            }
            onClose={onClose}
            keepMounted={open || keepMounted}
            disableEnforceFocus={hidden || props.disableEnforceFocus}
            disableScrollLock={hidden || props.disableScrollLock}
            aria-label={
              props["aria-labelledby"] ? undefined : title || workTitle
            }
            sx={[
              {
                "& .MuiDialog-paper": {
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 2,
                },
                "& .MuiDialogTitle-root": { pr: 13, minHeight: 64 },
                "& .MuiDialogActions-root": {
                  flexWrap: "wrap",
                  gap: 1,
                  justifyContent: "flex-end",
                  px: 3,
                  py: 2,
                  "& .MuiButton-root": { whiteSpace: "nowrap", flexShrink: 0 },
                },
              },
              ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
              ...(hidden
                ? [
                    {
                      visibility: "hidden",
                      pointerEvents: "none",
                      "& .MuiBackdrop-root": { display: "none" },
                    },
                  ]
                : []),
            ]}
          >
            <ModalWindowControls
              title={title || workTitle || "dialog"}
              minimize={minimize}
              onClose={onClose}
              closeControl={closeControl}
            />
            {needsHeading && (
              <DialogTitle data-modal-title>{title}</DialogTitle>
            )}
            {children}
          </Dialog>
        </ModalVisibilityContext.Provider>
      </ModalShellContext.Provider>
    </ModalMinimizeContext.Provider>
  );
}

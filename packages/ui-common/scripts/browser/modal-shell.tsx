import { ModalProvider, useModal } from "../../src/contexts/ModalContext";
import { HostedModalBoundary } from "../../src/components/Modals/HostedModalBoundary";
import { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Box,
  Button,
  DialogContent,
  DialogTitle,
  TextField,
  ThemeProvider,
  createTheme,
} from "@mui/material";
import { FunctionalDialog } from "../../src/components/Modals/FunctionalDialog";
import { ModalActions } from "../../src/components/Modals/ModalActions";
import { ActionsCapsuleProvider } from "../../src/components/ActionsCapsule/ActionsCapsuleProvider";
import { useActionsCapsule } from "../../src/components/ActionsCapsule/ActionsCapsuleContext";

function Fixture() {
  const capsule = useActionsCapsule();
  const modal = useModal();
  useLayoutEffect(() => {
    modal?.openModal({
      type: "triage",
      organizationId: "org",
      projectId: "project",
    });
  }, [modal?.openModal]);
  const instance = modal?.modalInstances[0];
  const [open, setOpen] = useState(true);
  const [confirmation, setConfirmation] = useState(false);
  const [clicks, setClicks] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("Preserved browser draft");
  const anchor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = anchor.current;
    if (!element) return;
    const measure = () =>
      capsule.setCapsuleTop(element.getBoundingClientRect().top);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [capsule.setCapsuleTop]);
  return (
    <>
      <button
        data-testid="page-click"
        onClick={() => setClicks((value) => value + 1)}
      >
        Page clicked {clicks}
      </button>
      <button data-testid="change-side" onClick={capsule.toggleAnchor}>
        Change side
      </button>
      <p data-testid="copy-source">
        Copy this page text into the preserved draft.
      </p>
      <Box sx={{ height: "200vh", background: "linear-gradient(#eee,#aaa)" }} />
      <Box
        ref={anchor}
        data-testid="fixture-capsule"
        sx={{
          position: "fixed",
          bottom: 16,
          [capsule.anchor === "bottom-left" ? "left" : "right"]: 16,
          bgcolor: "background.paper",
          p: 1,
          width: expanded ? 240 : 56,
          height: expanded ? 280 : 56,
        }}
      >
        <button
          data-testid="expand-capsule"
          onClick={() => setExpanded((value) => !value)}
        >
          Actions
        </button>
      </Box>
      {instance && (
        <HostedModalBoundary instanceId={instance.id}>
          <FunctionalDialog open={open} onClose={() => setOpen(false)}>
            <DialogTitle>Browser draft</DialogTitle>
            <DialogContent>
              <TextField
                label="Draft"
                slotProps={{ htmlInput: { "data-testid": "browser-draft" } }}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                fullWidth
              />
            </DialogContent>
            <ModalActions contextualActions={<Button>Attach files</Button>}>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => setConfirmation(true)}>
                Review changes
              </Button>
              <Button>Start Conversation</Button>
            </ModalActions>
            <FunctionalDialog
              open={confirmation}
              onClose={() => setConfirmation(false)}
            >
              <DialogTitle>Pending review</DialogTitle>
              <DialogContent>Selection remains pending.</DialogContent>
              <ModalActions>
                <Button onClick={() => setConfirmation(false)}>
                  Keep reviewing
                </Button>
              </ModalActions>
            </FunctionalDialog>
          </FunctionalDialog>
        </HostedModalBoundary>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={createTheme()}>
    <ModalProvider>
      <ActionsCapsuleProvider>
        <Fixture />
      </ActionsCapsuleProvider>
    </ModalProvider>
  </ThemeProvider>,
);

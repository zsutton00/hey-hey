import { Box, Button, Portal, Tooltip } from "@mui/material";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import { useOptionalActionsCapsule } from "../ActionsCapsule/ActionsCapsuleContext";
import { useMinimizedModalWork } from "./modalWorkRegistry";

export function ModalRestoreControls() {
  const work = useMinimizedModalWork();
  const capsule = useOptionalActionsCapsule();
  if (work.length === 0) return null;
  const left = capsule?.anchor === "bottom-left";
  return (
    <Portal>
      <Box
        data-testid="modal-restore-controls"
        aria-label="Minimized work"
        role="region"
        sx={{
          position: "fixed",
          zIndex: (theme) => theme.zIndex.modal - 1,
          bottom: capsule?.capsuleTop
            ? `clamp(96px, calc(100dvh - ${capsule.capsuleTop}px + 12px), calc(100dvh - 64px))`
            : "calc(env(safe-area-inset-bottom, 0px) + 96px)",
          ...(left
            ? { left: "max(16px, env(safe-area-inset-left, 0px))" }
            : { right: "max(16px, env(safe-area-inset-right, 0px))" }),
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "40vh",
          overflow: "auto",
          alignItems: left ? "flex-start" : "flex-end",
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {work.map((item, index) => {
          const label =
            work.filter((entry) => entry.title === item.title).length > 1
              ? `${item.title} (${index + 1})`
              : item.title;
          return (
            <Tooltip key={item.id} title={`Restore ${label}`}>
              <Button
                data-testid="modal-restore"
                aria-label={`Restore ${label}`}
                onClick={item.restore}
                variant="contained"
                sx={{
                  minHeight: 44,
                  minWidth: 44,
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                <OpenInFullIcon />
                <Box
                  component="span"
                  sx={{
                    display: { xs: "none", sm: "inline" },
                    ml: { xs: 0, sm: 1 },
                  }}
                >
                  {label}
                </Box>
              </Button>
            </Tooltip>
          );
        })}
      </Box>
    </Portal>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $createTextNode,
  $isTextNode,
  createCommand,
  type NodeKey,
} from "lexical";
import { $isSubagentCommandNode } from "./SubagentCommandNode";
import type { SubagentCommandChoices } from "./subagentCommand";
import { SUBAGENT_COMMAND } from "./useSlashCommandRegistry";
import { serializeEditorState } from "../serializationUtils";
import { useSubagentServices } from "./SubagentServicesContext";

export const REVERT_SUBAGENT_COMMAND = createCommand<NodeKey>(
  "REVERT_SUBAGENT_COMMAND"
);

export function SubagentCommandControl({
  nodeKey,
  choices,
}: {
  nodeKey: NodeKey;
  choices: SubagentCommandChoices;
}) {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const servicesButton = useRef<HTMLButtonElement>(null);
  const serviceScope = useSubagentServices();
  const selectedServiceIds =
    choices.serviceIds ?? serviceScope.sourceServiceIds;
  // Selected Services stay listed even when absent from the project options.
  const serviceOptions = [
    ...serviceScope.options,
    ...selectedServiceIds
      .filter((id) => !serviceScope.options.some((option) => option.id === id))
      .map((id) => ({ id, name: id })),
  ];
  const servicesLabel =
    selectedServiceIds.length === 0
      ? "No services"
      : selectedServiceIds.length === 1
      ? serviceOptions.find((service) => service.id === selectedServiceIds[0])
          ?.name
      : `${selectedServiceIds.length} services`;
  const [editable, setEditable] = useState(editor.isEditable());
  const [bodyEmpty, setBodyEmpty] = useState(false);
  const modeButton = useRef<HTMLButtonElement>(null);
  const commandButton = useRef<HTMLButtonElement>(null);
  const wasSelected = useRef(false);

  useEffect(() => editor.registerEditableListener(setEditable), [editor]);
  useEffect(() => {
    const focusSelection = () =>
      editor.getEditorState().read(() => {
        setBodyEmpty(serializeEditorState(nodeKey).length === 0);
        const selection = $getSelection();
        const selected = $isNodeSelection(selection) && selection.has(nodeKey);
        if (selected && !wasSelected.current) {
          modeButton.current?.focus();
          setOpen(true);
        }
        wasSelected.current = selected;
      });
    focusSelection();
    return editor.registerUpdateListener(focusSelection);
  }, [editor, nodeKey]);

  const focusBody = useCallback(() => {
    setOpen(false);
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!$isSubagentCommandNode(node)) return;
      const next = node.getNextSibling();
      if ($isTextNode(next)) next.select(0, 0);
      else {
        const body = $createTextNode("");
        node.insertAfter(body);
        body.select();
      }
    });
    editor.getRootElement()?.focus();
  }, [editor, nodeKey]);
  useEffect(() => {
    if (!bodyEmpty || !editable) return;
    const focusEmptyBody = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-testid="subagent-command-control"]')
      )
        return;
      event.preventDefault();
      focusBody();
    };
    return editor.registerRootListener((root, previous) => {
      previous?.removeEventListener("mousedown", focusEmptyBody);
      root?.addEventListener("mousedown", focusEmptyBody);
    });
  }, [bodyEmpty, editable, editor, focusBody]);
  const previousChoice = () => {
    setOpen(false);
    commandButton.current?.focus();
  };
  const chooseMode = (mode: SubagentCommandChoices["mode"]) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isSubagentCommandNode(node)) node.setChoices({ ...choices, mode });
    });
    focusBody();
  };
  const toggleService = (serviceId: string) => {
    const next = selectedServiceIds.includes(serviceId)
      ? selectedServiceIds.filter((id) => id !== serviceId)
      : [...selectedServiceIds, serviceId];
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isSubagentCommandNode(node))
        node.setChoices({ ...choices, serviceIds: next });
    });
  };
  const advance = (event: React.KeyboardEvent) => {
    if (event.key === "Tab" || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) previousChoice();
      else focusBody();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      modeButton.current?.focus();
    }
  };

  return (
    <>
      <Box
        component="span"
        data-testid="subagent-command-control"
        onKeyDown={(event) => event.stopPropagation()}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          px: 0.5,
          mr: 1,
        }}
      >
        <Button
          ref={commandButton}
          size="small"
          disabled={!editable}
          data-testid="subagent-command-name"
          onClick={() => {
            modeButton.current?.focus();
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace") {
              event.preventDefault();
              event.stopPropagation();
              editor.dispatchCommand(REVERT_SUBAGENT_COMMAND, nodeKey);
            }
          }}
        >
          /subagent
        </Button>
        <Button
          ref={modeButton}
          size="small"
          disabled={!editable}
          data-testid="subagent-command-mode"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          onKeyDown={advance}
        >
          {choices.mode}
        </Button>
        <Chip
          size="small"
          label={SUBAGENT_COMMAND.supportedCapabilities[0]}
          data-testid="subagent-command-capability"
        />
        <Button
          ref={servicesButton}
          size="small"
          disabled={!editable}
          data-testid="subagent-command-services"
          aria-label={`Child services: ${servicesLabel}`}
          aria-haspopup="menu"
          aria-expanded={servicesOpen}
          onClick={() => setServicesOpen(true)}
        >
          {servicesLabel}
        </Button>
        <Menu
          anchorEl={() => servicesButton.current}
          open={servicesOpen && editable}
          onClose={() => {
            setServicesOpen(false);
            servicesButton.current?.focus();
          }}
          disableRestoreFocus
        >
          {serviceOptions.length === 0 ? (
            <MenuItem disabled>No services available</MenuItem>
          ) : (
            serviceOptions.map((service) => (
              <MenuItem
                key={service.id}
                data-testid="subagent-command-service-option"
                data-service-id={service.id}
                onClick={() => toggleService(service.id)}
              >
                <Checkbox
                  size="small"
                  checked={selectedServiceIds.includes(service.id)}
                  tabIndex={-1}
                  disableRipple
                />
                <ListItemText primary={service.name} />
              </MenuItem>
            ))
          )}
        </Menu>
        <Menu
          anchorEl={() => modeButton.current}
          anchorOrigin={{ vertical: "top", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          open={open && editable}
          onClose={() => {
            setOpen(false);
            modeButton.current?.focus();
          }}
          disableRestoreFocus
          slotProps={{ list: { onKeyDown: advance } }}
        >
          {SUBAGENT_COMMAND.supportedModes.map((mode) => (
            <MenuItem
              key={mode}
              selected={mode === choices.mode}
              data-testid="subagent-command-mode-option"
              data-mode={mode}
              onClick={() => chooseMode(mode)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  chooseMode(mode);
                }
              }}
            >
              {mode}
            </MenuItem>
          ))}
        </Menu>
      </Box>
      {bodyEmpty && (
        <Box
          component="span"
          aria-hidden
          data-testid="subagent-objective-placeholder"
          sx={{
            position: "relative",
            display: "inline-block",
            width: 0,
            height: "1em",
            verticalAlign: "middle",
            pointerEvents: "none",
          }}
        >
          <Box
            component="span"
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              color: "text.secondary",
              whiteSpace: "nowrap",
            }}
          >
            What should the subagent do?
          </Box>
        </Box>
      )}
    </>
  );
}

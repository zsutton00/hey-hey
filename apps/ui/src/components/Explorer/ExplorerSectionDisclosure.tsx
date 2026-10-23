import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Collapse, IconButton } from "@mui/material";
import { ChevronRight, ExpandMore } from "@mui/icons-material";
import { useGuidableTarget } from "@hey-hey/ui-common/components/GuidedWalkthrough/useGuidableTarget";
import { useGuidedWalkthroughRuntime } from "@hey-hey/ui-common/components/GuidedWalkthrough/guidedWalkthroughRuntime";

interface ExplorerSectionDisclosureProps {
  sectionKey: string;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  headerColor: string;
  header: ReactNode;
  children: ReactNode;
}

/** The real disclosure owns its target, state and transition completion. */
export function ExplorerSectionDisclosure({
  sectionKey,
  label,
  expanded,
  onToggle,
  headerColor,
  header,
  children,
}: ExplorerSectionDisclosureProps) {
  const runtime = useGuidedWalkthroughRuntime();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const token = useRef(Symbol("explorer-section"));
  const [entered, setEntered] = useState(expanded);
  useGuidableTarget(
    { name: "explorer-section-toggle", sectionKey },
    () => toggleRef.current
  );
  useEffect(
    () =>
      runtime?.explorerSections.publish(sectionKey, token.current, expanded),
    [runtime, sectionKey, expanded]
  );

  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
        <IconButton
          ref={toggleRef}
          size="small"
          onClick={onToggle}
          sx={{ color: headerColor, flexShrink: 0 }}
          aria-label={`${
            expanded ? "Collapse" : "Expand"
          } ${label.toLowerCase()}`}
          aria-expanded={expanded}
          data-testid="explorer-section-toggle"
          data-section-key={sectionKey}
        >
          {expanded ? (
            <ExpandMore fontSize="small" />
          ) : (
            <ChevronRight fontSize="small" />
          )}
        </IconButton>
        {header}
      </Box>
      <Collapse
        in={expanded}
        timeout={200}
        onEnter={() => setEntered(false)}
        onExit={() => setEntered(false)}
        onEntered={() => {
          setEntered(true);
          runtime?.events.emit({
            type: "explorer-section-expanded",
            sectionKey,
          });
        }}
      >
        <Box aria-hidden={!expanded || !entered} inert={!expanded || !entered}>
          {children}
        </Box>
      </Collapse>
    </>
  );
}

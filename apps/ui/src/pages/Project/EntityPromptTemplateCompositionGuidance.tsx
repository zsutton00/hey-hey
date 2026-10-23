import HelpOutline from "@mui/icons-material/HelpOutline";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import { getEntityPromptTemplateCompositionMetadata } from "@hey-hey/ui-common/data";
import type { EntityPromptTemplateEffectiveDto } from "@hey-hey/ui-common/api";
import React, { useState } from "react";

export interface EntityPromptTemplateCompositionGuidanceProps {
  effective: Pick<
    EntityPromptTemplateEffectiveDto,
    "syntaxVersion" | "selector"
  >;
}

export const EntityPromptTemplateCompositionGuidance: React.FC<
  EntityPromptTemplateCompositionGuidanceProps
> = ({ effective }) => {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const metadata = getEntityPromptTemplateCompositionMetadata(effective);

  return (
    <Box>
      <Button
        startIcon={<HelpOutline />}
        onClick={() => setIsHelpOpen(true)}
        data-testid="entity-prompt-template-help-trigger"
      >
        How this template works
      </Button>
      <Dialog
        open={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        aria-labelledby="entity-prompt-template-help-title"
        data-testid="entity-prompt-template-help-dialog"
      >
        <DialogTitle id="entity-prompt-template-help-title">
          How this template participates in the agent prompt
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            <Typography variant="body2">
              This editor owns the focal-entity grounding layer for an
              entity-scoped session. It changes this template&apos;s content
              only; the browser does not select templates, build session input,
              choose tools, or render prompts.
            </Typography>

            <Box component="ul" sx={{ m: 0, pl: 3 }}>
              {metadata.layers.map((layer) => (
                <Box component="li" key={layer.owner} sx={{ pl: 0.5 }}>
                  <Typography
                    component="span"
                    variant="body2"
                    fontWeight="fontWeightMedium"
                  >
                    {layer.owner}
                  </Typography>{" "}
                  — {layer.responsibility}
                </Box>
              ))}
            </Box>

            <Typography variant="body2">
              {metadata.authority.owner} remains authoritative for{" "}
              {metadata.authority.responsibility.toLowerCase()}.
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              data-testid="entity-prompt-template-composition-metadata"
            >
              Template language: {metadata.templateLanguage.syntaxVersion} ·
              Focal entity: {metadata.templateLanguage.selectorLabel}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setIsHelpOpen(false)}
            data-testid="entity-prompt-template-help-close"
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

EntityPromptTemplateCompositionGuidance.displayName =
  "EntityPromptTemplateCompositionGuidance";

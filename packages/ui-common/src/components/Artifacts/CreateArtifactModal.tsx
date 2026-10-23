import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  Card,
  CardActionArea,
  Typography,
  Box,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DocumentIcon from "@mui/icons-material/Description";
import { useTranslation } from "react-i18next";
import type { DocumentTemplate } from "../../types/artifacts";

interface CreateArtifactModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onTemplateSelect: (template: DocumentTemplate) => void;
}

const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: "blank",
    name: "Blank Document",
    description: "Start with a blank document",
    content: "# Untitled Document\n\nStart writing your content here...",
    icon: <DocumentIcon />,
  },
  // Future templates can be added here
  // {
  //   id: 'meeting-notes',
  //   name: 'Meeting Notes',
  //   description: 'Template for meeting notes',
  //   content: '# Meeting Notes\n\n## Date\n\n## Attendees\n\n## Agenda\n\n## Action Items\n\n',
  //   icon: <MeetingRoomIcon />,
  // },
];

export const CreateArtifactModal: React.FC<CreateArtifactModalProps> = ({
  open,
  onClose,
  onTemplateSelect,
}) => {
  const { t } = useTranslation();

  const handleTemplateSelect = (template: DocumentTemplate) => {
    onTemplateSelect(template);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: "400px" },
      }}
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">
            {t("artifacts.createDocument", "Create Document")}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("artifacts.selectTemplate", "Choose a template to get started")}
        </Typography>

        <Grid container spacing={2}>
          {DOCUMENT_TEMPLATES.map((template) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={template.id}>
              <Card
                sx={{
                  height: "100%",
                  cursor: "pointer",
                  transition: "all 0.2s ease-in-out",
                  "&:hover": {
                    transform: "translateY(-2px)",
                    boxShadow: 3,
                  },
                }}
              >
                <CardActionArea
                  onClick={() => handleTemplateSelect(template)}
                  sx={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    p: 2,
                  }}
                >
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 2,
                      bgcolor: "primary.light",
                      color: "primary.contrastText",
                      mb: 2,
                      fontSize: "24px",
                    }}
                  >
                    {template.icon}
                  </Box>

                  <Typography variant="h6" gutterBottom>
                    {template.name}
                  </Typography>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ flexGrow: 1 }}
                  >
                    {template.description}
                  </Typography>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
      </DialogActions>
    </Dialog>
  );
};

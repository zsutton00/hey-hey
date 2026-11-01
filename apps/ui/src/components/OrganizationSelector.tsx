import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import React, { useState } from "react";
import {
  Box,
  Button,
  Menu,
  MenuItem,
  Typography,
  Divider,
  Chip,
  CircularProgress,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import ExpandMore from "@mui/icons-material/ExpandMore";
import Business from "@mui/icons-material/Business";
import Add from "@mui/icons-material/Add";
import { useTranslation } from "react-i18next";
import { KEYS } from "@hey-hey/ui-common/i18n";
import { useOrganization } from "@hey-hey/ui-common/context";

export const OrganizationSelector: React.FC = () => {
  const { t } = useTranslation();
  const {
    organizations,
    currentOrganization,
    loading,
    switchOrganization,
    createOrganization,
  } = useOrganization();

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [createDialogOpen, setCreateDialogOpen, createDialogOpenOwnerKey] =
    useModalState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgDescription, setNewOrgDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSwitchOrganization = async (orgId: string) => {
    try {
      await switchOrganization(orgId);
    } catch {
      return;
    }
    handleClose();
  };

  const handleCreateNew = () => {
    setCreateDialogOpen(true);
    handleClose();
  };

  const handleCreateOrganization = async () => {
    if (!newOrgName.trim()) return;

    setCreating(true);
    try {
      await createOrganization({
        name: newOrgName.trim(),
        description: newOrgDescription.trim() || undefined,
      });
      setCreateDialogOpen(false);
      setNewOrgName("");
      setNewOrgDescription("");
    } catch (error) {
      console.error("Failed to create organization:", error);
    } finally {
      setCreating(false);
    }
  };

  const handleCancelCreate = () => {
    setCreateDialogOpen(false);
    setNewOrgName("");
    setNewOrgDescription("");
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">{t(KEYS.common.loading)}</Typography>
      </Box>
    );
  }

  if (!currentOrganization) {
    return null;
  }

  return (
    <>
      <Button
        onClick={handleClick}
        endIcon={<ExpandMore />}
        startIcon={<Business />}
        sx={{
          color: "inherit",
          textTransform: "none",
          minWidth: 200,
          justifyContent: "flex-start",
        }}
      >
        <Box sx={{ textAlign: "left", overflow: "hidden" }}>
          <Typography variant="body2" noWrap>
            {currentOrganization.name}
          </Typography>
          {organizations.length > 1 && (
            <Typography variant="caption" color="text.secondary">
              {organizations.length} organizations
            </Typography>
          )}
        </Box>
      </Button>

      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        PaperProps={{
          sx: {
            minWidth: 280,
            maxWidth: 400,
          },
        }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">
            Switch Organization
          </Typography>
        </Box>

        {organizations.map((org) => (
          <MenuItem
            key={org.id}
            onClick={() => handleSwitchOrganization(org.id)}
            selected={org.id === currentOrganization.id}
            sx={{ py: 1.5 }}
          >
            <Box sx={{ width: "100%" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {org.name}
                </Typography>
                {org.id === currentOrganization.id && (
                  <Chip label="Current" size="small" color="primary" />
                )}
              </Box>
              {org.description && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.5 }}
                >
                  {org.description}
                </Typography>
              )}
            </Box>
          </MenuItem>
        ))}

        <Divider />
        <MenuItem onClick={handleCreateNew} sx={{ py: 1.5 }}>
          <Add sx={{ mr: 1, fontSize: "1.2rem" }} />
          <Typography variant="body2">
            {t(KEYS.organizations.createNew)}
          </Typography>
        </MenuItem>
      </Menu>

      {/* Create Organization Dialog */}
      <Dialog
        ownerKey={createDialogOpenOwnerKey}
        open={createDialogOpen}
        onClose={handleCancelCreate}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t(KEYS.organizations.dialog.createTitle)}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            <TextField
              autoFocus
              margin="dense"
              label="Organization Name"
              fullWidth
              variant="outlined"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="e.g., Acme Corp"
              helperText="Choose a name that helps your team identify this organization"
            />
            <TextField
              margin="dense"
              label="Description (Optional)"
              fullWidth
              variant="outlined"
              multiline
              rows={2}
              value={newOrgDescription}
              onChange={(e) => setNewOrgDescription(e.target.value)}
              placeholder="Brief description of your organization"
              sx={{ mt: 2 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancelCreate}>{t(KEYS.common.cancel)}</Button>
          <Button
            onClick={handleCreateOrganization}
            variant="contained"
            disabled={!newOrgName.trim() || creating}
          >
            {creating ? "Creating..." : "Create Organization"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

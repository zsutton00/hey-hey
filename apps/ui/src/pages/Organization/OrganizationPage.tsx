import { useOrganization } from "@hey-hey/ui-common/context";
import { OrganizationMembersPanel } from "@hey-hey/ui-common/components";
import {
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import {
  DetailPageContainer,
  DetailPageTabs,
  PageBreadcrumbs,
  type DetailPageTab,
} from "../../components/Layout";

const TAB_VALUES = ["overview", "members", "projects", "admin"] as const;
type TabValue = (typeof TAB_VALUES)[number];

export const OrganizationPage: React.FC = () => {
  const { organizations, currentOrganization, loading, switchOrganization } =
    useOrganization();
  const [activeTab, setActiveTab] = useState<TabValue>("overview");

  const selectedOrganization = currentOrganization;

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
        <CircularProgress aria-label="Loading organizations" />
      </Box>
    );
  }

  const tabs: DetailPageTab[] = [
    { value: "overview", label: "Overview" },
    { value: "members", label: "Members" },
    { value: "projects", label: "Projects" },
    { value: "admin", label: "Admin" },
  ];

  const breadcrumbItems = selectedOrganization
    ? [
        { label: "Organizations", to: "/organizations" },
        {
          label: selectedOrganization.name,
          to: "/organizations",
          isCurrent: true,
          type: "organization",
        },
      ]
    : [
        {
          label: "Organizations",
          to: "/organizations",
          isCurrent: true,
          type: "organization",
        },
      ];

  const handleOrganizationChange = (organizationId: string): void => {
    void switchOrganization(organizationId)
      .then(() => setActiveTab("overview"))
      .catch(() => undefined);
  };

  const renderTabContent = (): React.ReactNode => {
    if (!selectedOrganization) {
      return (
        <Typography color="text.secondary">
          Select an organization to continue.
        </Typography>
      );
    }

    if (activeTab === "overview") {
      return (
        <Stack spacing={2} data-testid="organization-overview">
          <Typography variant="h5">{selectedOrganization.name}</Typography>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Name
            </Typography>
            <Typography>{selectedOrganization.name}</Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Created
            </Typography>
            <Typography>
              {new Date(selectedOrganization.createdAt).toLocaleDateString()}
            </Typography>
          </Box>
        </Stack>
      );
    }

    if (activeTab === "members") {
      return (
        <OrganizationMembersPanel organizationId={selectedOrganization.id} />
      );
    }

    return (
      <Box
        data-testid={`organization-${activeTab}-slot`}
        data-organization-id={selectedOrganization.id}
      />
    );
  };

  return (
    <>
      <PageBreadcrumbs sx={{ mb: 2 }} items={breadcrumbItems} />
      <DetailPageContainer>
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "stretch", sm: "center" }}
            justifyContent="space-between"
            spacing={2}
          >
            <Typography variant="h4">
              {selectedOrganization?.name ?? "Organizations"}
            </Typography>
            {organizations.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 240 }}>
                <InputLabel id="organization-page-selector-label">
                  Organization
                </InputLabel>
                <Select
                  labelId="organization-page-selector-label"
                  label="Organization"
                  value={selectedOrganization?.id ?? ""}
                  onChange={(event) =>
                    handleOrganizationChange(event.target.value)
                  }
                >
                  {organizations.map((organization) => (
                    <MenuItem key={organization.id} value={organization.id}>
                      {organization.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Stack>
          <DetailPageTabs
            value={activeTab}
            onChange={(value) => {
              if (
                typeof value === "string" &&
                TAB_VALUES.includes(value as TabValue)
              ) {
                setActiveTab(value as TabValue);
              }
            }}
            tabs={tabs}
          />
          {renderTabContent()}
        </Stack>
      </DetailPageContainer>
    </>
  );
};

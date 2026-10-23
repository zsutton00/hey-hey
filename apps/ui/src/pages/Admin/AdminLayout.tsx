import { usePlatformAdminAccess } from "@hey-hey/ui-common/data";
import {
  Box,
  CircularProgress,
  Container,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";

const ADMIN_TABS = [
  { path: "/admin/organizations", labelKey: "admin.tabs.organizations" },
  { path: "/admin/beta-access", labelKey: "admin.tabs.betaAccess" },
  { path: "/admin/demo", labelKey: "admin.tabs.demo" },
] as const;

// The whole area is restricted to platform admins, as decided by the server.
// Nobody is admitted or turned away until that answer arrives.
export const AdminLayout: React.FC = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { isPlatformAdmin, isResolved } = usePlatformAdminAccess();
  if (!isResolved) {
    return (
      <Box
        data-testid="admin-access-pending"
        sx={{ display: "flex", justifyContent: "center", pt: 6 }}
      >
        <CircularProgress aria-label={t("admin.accessPending")} />
      </Box>
    );
  }
  if (!isPlatformAdmin) return <Navigate to="/" replace />;
  const selected = ADMIN_TABS.find(
    (tab) => pathname === tab.path || pathname.startsWith(`${tab.path}/`),
  );

  return (
    <Box data-testid="admin-layout">
      <Container maxWidth="xl" sx={{ pt: 3 }}>
        <Typography variant="h4" component="h1" sx={{ mb: 1 }}>
          {t("admin.title")}
        </Typography>
        <Tabs
          value={selected?.path ?? false}
          sx={{ borderBottom: 1, borderColor: "divider" }}
        >
          {ADMIN_TABS.map((tab) => (
            <Tab
              key={tab.path}
              value={tab.path}
              label={t(tab.labelKey)}
              component={Link}
              to={tab.path}
              data-testid={`admin-tab-${tab.path.split("/").pop()}`}
            />
          ))}
        </Tabs>
      </Container>
      <Outlet />
    </Box>
  );
};

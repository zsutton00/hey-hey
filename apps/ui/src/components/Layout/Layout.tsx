import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DemoSandboxBanner } from "@hey-hey/ui-common/components";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { ProjectContext } from "@hey-hey/ui-common/context";
import { useUserPairedMachines } from "@hey-hey/ui-common/data";
import {
  Box,
  Button,
  Drawer,
  IconButton,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  LAYOUT_CONSTANTS,
  LAYOUT_CSS,
  MAIN_CONTENT_PADDING_X_SX,
} from "../../constants/layout";
import AnimatedPageWrapper from "../AnimatedPageWrapper";
import { ExplorerSidebar } from "../Explorer/ExplorerSidebar";
import { ProjectNotificationCenter } from "../Notifications";
import {
  MobileHeaderBreadcrumbProvider,
  MobileHeaderBreadcrumbSlot,
} from "./MobileHeaderBreadcrumbSlot";
import { LayoutMainBottomSpacingContext } from "./LayoutMainBottomSpacingContext";
import {
  LayoutMainScrollOwnerContext,
  type LayoutMainScrollOwner,
} from "./LayoutMainScrollOwnerContext";
import { ResizableDrawer } from "./ResizableDrawer";
import { useOrganizationProjectShellVisibility } from "../../hooks/useOrganizationProjectShellVisibility";
import { PublicMarketingShell } from "./PublicMarketingShell";
import { useKeyboardViewportRecovery } from "../../hooks/useKeyboardViewportRecovery";

const MOBILE_HEADER_ACTION_SIZE = 44;

const Layout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const userIdentity = useUserIdentity();
  const mainContentRef = useRef<HTMLElement | null>(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [bottomSpacingSuppressions, setBottomSpacingSuppressions] = useState(0);
  const [mainScrollSuppressions, setMainScrollSuppressions] = useState(0);
  const { shouldShowProjectShell } = useOrganizationProjectShellVisibility();

  const suppressMainBottomSpacing = useCallback(
    ({ suppressMainScroll = true }: { suppressMainScroll?: boolean } = {}) => {
      let isActive = true;
      setBottomSpacingSuppressions((current) => current + 1);
      if (suppressMainScroll) {
        setMainScrollSuppressions((current) => current + 1);
      }

      return () => {
        if (!isActive) {
          return;
        }
        isActive = false;
        setBottomSpacingSuppressions((current) => Math.max(0, current - 1));
        if (suppressMainScroll) {
          setMainScrollSuppressions((current) => Math.max(0, current - 1));
        }
      };
    },
    [],
  );

  // Check if we're on a project page
  const isOnProjectPage =
    location.pathname.startsWith("/projects/") &&
    location.pathname.split("/").length >= 3 &&
    location.pathname.split("/")[2] !== "";
  const isOnOrganizationPage = location.pathname === "/organizations";

  // Hide sidebar during onboarding
  const isOnOnboardingPage =
    isOnProjectPage && location.pathname.endsWith("/onboarding");
  const isExistingProjectImport =
    isOnOnboardingPage &&
    new URLSearchParams(location.search).get("entry") === "existing";

  const isOnLandingPage = location.pathname === "/";
  const isOnPublicMarketingPage =
    isOnLandingPage ||
    location.pathname === "/request-access" ||
    location.pathname === "/demo";

  useKeyboardViewportRecovery(isMobile && !isOnPublicMarketingPage);

  // Get project ID from URL
  const projectId = isOnProjectPage ? location.pathname.split("/")[2] : null;

  // Get organization ID
  const organizationId = userIdentity?.currentOrgId ?? "";

  const { t } = useTranslation();
  const { machines, isLoading: isMachinesLoading } = useUserPairedMachines();
  const showPairCta =
    isOnProjectPage && !isMachinesLoading && machines.length === 0;

  const shouldShowExplorer =
    isOnProjectPage &&
    (!isOnOnboardingPage || isExistingProjectImport) &&
    !!projectId &&
    !!organizationId;
  const shouldShowOrganizationExplorer =
    isOnOrganizationPage && !!organizationId;
  const shouldRenderExplorer =
    shouldShowExplorer || shouldShowOrganizationExplorer;
  const shouldRenderProjectChrome = isOnProjectPage && shouldShowProjectShell;
  const isBottomSpacingSuppressed = bottomSpacingSuppressions > 0;
  const isMainScrollSuppressed = mainScrollSuppressions > 0;
  const layoutMainScrollOwner = useMemo<LayoutMainScrollOwner>(
    () => ({
      mainContentRef,
      taskContextStickyTop: {
        xs: `${LAYOUT_CONSTANTS.MOBILE_HEADER_HEIGHT}px`,
        // Desktop breadcrumbs render at 48px; task context starts below that
        // existing Project Chrome surface instead of covering it while the
        // conversation scrolls.
        md: "48px",
      },
    }),
    [],
  );

  useEffect(() => {
    if (!("scrollRestoration" in window.history)) {
      return;
    }

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useLayoutEffect(() => {
    const mainContent = mainContentRef.current;

    if (mainContent) {
      mainContent.scrollTop = 0;
      mainContent.scrollLeft = 0;
      mainContent.scrollTo?.({
        top: 0,
        left: 0,
        behavior: "auto",
      });
    }

    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    });
  }, [location.pathname]);

  // Close mobile drawer automatically on route changes.
  useEffect(() => {
    setIsMobileDrawerOpen(false);
  }, [location.pathname]);

  const handleMobileDrawerToggle = (): void => {
    setIsMobileDrawerOpen((prev) => !prev);
  };

  const handleMobileDrawerClose = (): void => {
    setIsMobileDrawerOpen(false);
  };

  const projectContextValue =
    isOnProjectPage && projectId && organizationId
      ? { organizationId, projectId, navigate }
      : null;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        color: "text.primary",
      }}
    >
      <Box sx={{ display: "flex", flexGrow: 1, bgcolor: "background.default" }}>
        {/* VSCode-style resizable explorer sidebar — md and up */}
        {shouldRenderExplorer && !isMobile && organizationId && (
          <ResizableDrawer>
            {({ width, isMinimal }) => (
              <ExplorerSidebar
                projectId={projectId ?? undefined}
                organizationId={organizationId}
                width={width}
                isMinimal={isOnOrganizationPage ? false : isMinimal}
              />
            )}
          </ResizableDrawer>
        )}

        {/* Temporary overlay drawer — below md */}
        {shouldRenderExplorer && isMobile && organizationId && (
          <Drawer
            variant="temporary"
            anchor="left"
            open={isMobileDrawerOpen}
            onClose={handleMobileDrawerClose}
            ModalProps={{ keepMounted: true }}
            sx={{
              "& .MuiDrawer-paper": {
                boxSizing: "border-box",
                width: `${LAYOUT_CONSTANTS.DRAWER_WIDTH}px`,
                maxWidth: "85vw",
              },
            }}
          >
            <ExplorerSidebar
              projectId={projectId ?? undefined}
              organizationId={organizationId}
              width={LAYOUT_CONSTANTS.DRAWER_WIDTH}
              isMinimal={false}
              isMobileDrawer
              onMobileNavigate={handleMobileDrawerClose}
            />
          </Drawer>
        )}

        {/* Main content */}
        <ProjectContext.Provider value={projectContextValue}>
          <LayoutMainScrollOwnerContext.Provider value={layoutMainScrollOwner}>
            <Box
              component="main"
              data-testid="layout-main"
              ref={mainContentRef}
              sx={{
                flexGrow: 1,
                position: "relative",
                isolation: "isolate",
                height: isOnPublicMarketingPage ? "auto" : "100vh",
                minHeight: 0,
                minWidth: 0, // Prevent flex item from expanding beyond container
                ...(isMainScrollSuppressed
                  ? {
                      // Bounded pages own their scroll surface (for example, a
                      // conversation or editor). `clip` keeps <main> from
                      // becoming a scroll container even when its children are
                      // taller than the viewport.
                      overflow: "clip",
                    }
                  : {
                      overflowY: isOnPublicMarketingPage ? "visible" : "auto",
                      overflowX: "hidden",
                    }),
                padding: 0,
                paddingBottom:
                  isBottomSpacingSuppressed || isOnPublicMarketingPage
                    ? 0
                    : "100px",
                marginLeft: isOnProjectPage ? 0 : 0, // Drawer handles its own spacing
                marginTop: isOnPublicMarketingPage
                  ? 0
                  : LAYOUT_CSS.MAIN_MARGIN_TOP,
                bgcolor: "background.default",
                ...(isOnLandingPage ? { px: 0 } : MAIN_CONTENT_PADDING_X_SX),
              }}
            >
              <MobileHeaderBreadcrumbProvider>
                {isMobile &&
                !isOnPublicMarketingPage &&
                shouldRenderProjectChrome ? (
                  // One persistent, pinned bar: Menu + centered title + Activity.
                  // Fixed to the viewport so it never detaches regardless of the
                  // scroll-container chain (sticky inside overflow:auto is fragile).
                  // A sibling spacer below compensates for the out-of-flow height.
                  <Box
                    data-testid="mobile-pinned-header"
                    sx={{
                      position: "fixed",
                      top: 0,
                      left: 0,
                      right: 0,
                      zIndex: (zTheme) => zTheme.zIndex.appBar + 2,
                      height: `${LAYOUT_CONSTANTS.MOBILE_HEADER_HEIGHT}px`,
                      minHeight: `${LAYOUT_CONSTANTS.MOBILE_HEADER_HEIGHT}px`,
                      boxSizing: "border-box",
                      px: `${LAYOUT_CONSTANTS.MAIN_CONTENT_PADDING.LEFT_XS}px`,
                      display: "grid",
                      gridTemplateColumns: `${MOBILE_HEADER_ACTION_SIZE}px minmax(0, 1fr) ${MOBILE_HEADER_ACTION_SIZE}px`,
                      alignItems: "center",
                      columnGap: 1,
                      bgcolor: "background.default",
                      borderBottom: 1,
                      borderColor: "divider",
                      boxShadow: 1,
                      overflow: "visible",
                    }}
                  >
                    <Box
                      sx={{
                        width: MOBILE_HEADER_ACTION_SIZE,
                        height: MOBILE_HEADER_ACTION_SIZE,
                        justifySelf: "start",
                      }}
                    >
                      {shouldShowExplorer ? (
                        <IconButton
                          data-testid="mobile-nav-drawer-toggle"
                          aria-label="Menu"
                          onClick={handleMobileDrawerToggle}
                          size="medium"
                          sx={{
                            width: MOBILE_HEADER_ACTION_SIZE,
                            height: MOBILE_HEADER_ACTION_SIZE,
                            p: 1,
                          }}
                        >
                          <MenuIcon />
                        </IconButton>
                      ) : null}
                    </Box>
                    <MobileHeaderBreadcrumbSlot />
                    <Box
                      sx={{
                        width: MOBILE_HEADER_ACTION_SIZE,
                        height: MOBILE_HEADER_ACTION_SIZE,
                        justifySelf: "end",
                        minWidth: 0,
                      }}
                    >
                      {isOnProjectPage && projectId && organizationId ? (
                        <ProjectNotificationCenter
                          organizationId={organizationId}
                          projectId={projectId}
                        />
                      ) : null}
                    </Box>
                  </Box>
                ) : null}
                {isMobile &&
                  !isOnPublicMarketingPage &&
                  shouldRenderProjectChrome && (
                    // Spacer to compensate for the fixed header's out-of-flow height.
                    <Box
                      data-testid="mobile-pinned-header-spacer"
                      sx={{
                        height: `${LAYOUT_CONSTANTS.MOBILE_HEADER_HEIGHT}px`,
                        flexShrink: 0,
                      }}
                    />
                  )}
                {!isOnPublicMarketingPage && (
                  // Renders only for demo-sandbox users; everyone else sees nothing.
                  <DemoSandboxBanner enabled={Boolean(userIdentity)} />
                )}
                {!isMobile && shouldRenderProjectChrome && (
                  // Desktop: floating controls overlaying in-flow page breadcrumbs.
                  <Box
                    data-testid="desktop-project-header"
                    sx={{
                      position: "sticky",
                      top: 0,
                      zIndex: (zTheme) => zTheme.zIndex.appBar + 2,
                      height: 50,
                      mb: "-50px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      pointerEvents: "none",
                    }}
                  >
                    {showPairCta && projectId && (
                      <Box sx={{ pointerEvents: "auto" }}>
                        <Button
                          variant="contained"
                          component="a"
                          href={`/projects/${projectId}/settings?section=pairing`}
                          data-testid="pair-cli-cta"
                          aria-label={t("pairing.cta.pairACli", "Pair a CLI")}
                          onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                              e.preventDefault();
                              navigate(
                                `/projects/${projectId}/settings?section=pairing`,
                              );
                            }
                          }}
                          sx={{
                            mr: { xs: 1, md: 2 },
                            transform: "translateY(-1px)",
                            bgcolor: "secondary.main",
                            "&:hover": { bgcolor: "secondary.dark" },
                          }}
                        >
                          {t("pairing.cta.pairACli", "Pair a CLI")}
                        </Button>
                      </Box>
                    )}
                    {isOnProjectPage && projectId && organizationId && (
                      <Box sx={{ pointerEvents: "auto", pr: 2 }}>
                        <ProjectNotificationCenter
                          organizationId={organizationId}
                          projectId={projectId}
                        />
                      </Box>
                    )}
                  </Box>
                )}
                <AnimatedPageWrapper>
                  <LayoutMainBottomSpacingContext.Provider
                    value={suppressMainBottomSpacing}
                  >
                    {isOnPublicMarketingPage ? (
                      <PublicMarketingShell>
                        <Outlet />
                      </PublicMarketingShell>
                    ) : (
                      <Outlet />
                    )}
                  </LayoutMainBottomSpacingContext.Provider>
                </AnimatedPageWrapper>
              </MobileHeaderBreadcrumbProvider>
            </Box>
          </LayoutMainScrollOwnerContext.Provider>
        </ProjectContext.Provider>
      </Box>
    </Box>
  );
};

export default Layout;

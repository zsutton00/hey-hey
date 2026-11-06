import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAuth } from "@hey-hey/ui-common/context";
import {
  isPasskeySupported,
  PasskeyCeremonyCancelledError,
  signInWithPasskey,
} from "@hey-hey/ui-common/services";
import { resolveAuthReturnTarget } from "../utils/authReturnTarget";

export function LocalLogin() {
  // AuthProvider owns cookie-backed renewal, including the signed-out decision.
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const target = resolveAuthReturnTarget(location);
  const supported = isPasskeySupported();

  const handleSignIn = async () => {
    setPending(true);
    setFailed(false);
    try {
      await signInWithPasskey();
      navigate(target, { replace: true });
    } catch (error) {
      if (!(error instanceof PasskeyCeremonyCancelledError)) {
        setFailed(true);
      }
    } finally {
      setPending(false);
    }
  };

  if (isAuthenticated) {
    return <Navigate to={target} replace />;
  }

  return (
    <Box
      component="main"
      data-testid="local-login"
      sx={{
        minHeight: "100vh",
        boxSizing: "border-box",
        background: "#333",
        color: "#fff",
        textAlign: "center",
        px: 3,
        py: { xs: 4, md: 10 },
      }}
    >
      {loading ? (
        <Typography role="status" data-testid="return-progress">
          {t("localLogin.continuing")}
        </Typography>
      ) : (
        <>
          <Typography
            sx={{
              color: "#3fa7b5",
              fontFamily: "Monoton, Arial Black, sans-serif",
              fontSize: "2.2rem",
              mb: 3,
            }}
          >
            HEY HEY
          </Typography>
          <Typography
            component="h1"
            variant="h3"
            sx={{ fontWeight: 900, mb: 3 }}
          >
            {t("localLogin.title")}
          </Typography>
          <Typography sx={{ mb: 3 }}>{t("localLogin.note")}</Typography>
          {failed && (
            <Alert severity="error" sx={{ maxWidth: 400, mx: "auto", mb: 3 }}>
              {t("localLogin.failed")}
            </Alert>
          )}
          {supported ? (
            <Button
              data-testid="return-passkey"
              variant="contained"
              disabled={pending}
              onClick={() => void handleSignIn()}
              sx={{ background: "#fff", color: "#333" }}
            >
              {pending ? (
                <CircularProgress
                  size={24}
                  aria-label={t("localLogin.continuing")}
                />
              ) : (
                t("localLogin.signIn")
              )}
            </Button>
          ) : (
            <Alert severity="warning" sx={{ maxWidth: 400, mx: "auto" }}>
              {t("localLogin.unsupported")}
            </Alert>
          )}
        </>
      )}
    </Box>
  );
}

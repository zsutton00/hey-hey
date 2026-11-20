import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Alert, CircularProgress, Typography } from "@mui/material";
import {
  BrandedButton,
  BrandedCard,
  BrandedHeadline,
  BrandedPage,
  BrandedWordmark,
} from "@hey-hey/ui-common/components";
import { useTranslation } from "react-i18next";
import { useAuth } from "@hey-hey/ui-common/context";
import {
  isPasskeySupported,
  recordLocalStartupDiagnostic,
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
  useEffect(() => {
    recordLocalStartupDiagnostic("auth_state", {
      authenticated: isAuthenticated,
      loading,
    });
  }, [isAuthenticated, loading]);

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
    <BrandedPage data-testid="local-login">
      {loading ? (
        <Typography role="status" data-testid="return-progress">
          {t("localLogin.continuing")}
        </Typography>
      ) : (
        <>
          <BrandedWordmark>HEY HEY</BrandedWordmark>
          <BrandedHeadline line={t("localLogin.note")}>
            {t("localLogin.title")}
          </BrandedHeadline>
          <BrandedCard>
            {failed && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {t("localLogin.failed")}
              </Alert>
            )}
            {supported ? (
              <BrandedButton
                data-testid="return-passkey"
                disabled={pending}
                onClick={() => void handleSignIn()}
              >
                {pending ? (
                  <CircularProgress
                    size={24}
                    color="inherit"
                    aria-label={t("localLogin.continuing")}
                  />
                ) : (
                  t("localLogin.signIn")
                )}
              </BrandedButton>
            ) : (
              <Alert severity="warning">{t("localLogin.unsupported")}</Alert>
            )}
          </BrandedCard>
        </>
      )}
    </BrandedPage>
  );
}

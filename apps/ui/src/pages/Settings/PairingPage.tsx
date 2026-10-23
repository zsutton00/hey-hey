import { Box, Typography } from "@mui/material";
import {
  DetailPageContainer,
  DetailPageHeader,
  PageBreadcrumbs,
} from "../../components/Layout";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClaimMachine, type PairingJourney } from "./ClaimMachine";

interface PairingPageProps {
  journey?: PairingJourney;
}

export const PairingPage = ({
  journey = "first-machine",
}: PairingPageProps) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const authorizationTarget =
    journey === "first-machine" &&
    searchParams.get("intent") === "authorize-browser" &&
    searchParams.get("machineId") &&
    searchParams.get("machineName")
      ? {
          machineId: searchParams.get("machineId")!,
          machineName: searchParams.get("machineName")!,
        }
      : undefined;

  return (
    <Box data-testid="pairing-page">
      <PageBreadcrumbs items={[{ label: "Pairing", isCurrent: true }]} />
      <DetailPageContainer maxWidth="md">
        <DetailPageHeader
          title={
            <Typography component="h1" variant="h4">
              {authorizationTarget
                ? `Authorize this browser for ${authorizationTarget.machineName}`
                : journey === "existing-machine"
                  ? "Add a controller"
                  : "Pair an Agent Bridge"}
            </Typography>
          }
        />
        <Box sx={{ px: 1.5, pb: 3 }}>
          <ClaimMachine
            initialCode={searchParams.get("code")}
            journey={journey}
            authorizationTarget={authorizationTarget}
            completionActionLabel="Go to projects"
            onCompletionAction={() => navigate("/projects")}
          />
        </Box>
      </DetailPageContainer>
    </Box>
  );
};

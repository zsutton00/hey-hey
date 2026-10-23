import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import type {
  PrivateBetaDisclosureRequirementDto,
} from "@hey-hey/ui-common/api";
import { usePrivateBetaDisclosure } from "@hey-hey/ui-common/data";
import { useLocation, useNavigate } from "react-router-dom";
import {
  DISCLOSURE_REQUIREMENTS,
  getPublishedLegalDocument,
  LEGAL_ROUTES,
  type LegalDocumentKey,
} from "../Legal/legalContent";
import { PRIVATE_BETA_DISCLOSURE_ROUTE } from "../../components/PrivateBetaDisclosureGate";
import { resolveAuthReturnTarget } from "../../utils/authReturnTarget";

const documentKeyByKind: Record<
  PrivateBetaDisclosureRequirementDto["documentKind"],
  LegalDocumentKey
> = {
  TERMS: "terms",
  PRIVACY: "privacy",
  SECURITY: "security",
};

const isStaleVersionError = (error: Error | null): boolean => {
  const response = (
    error as (Error & { response?: { status?: number } }) | null
  )?.response;
  return response?.status === 409;
};

type DisclosureAcceptance = Pick<
  PrivateBetaDisclosureRequirementDto,
  "documentKind" | "version" | "effectiveDate" | "actionType"
>;

interface DisclosureStatusShape {
  requiredDocuments?: PrivateBetaDisclosureRequirementDto[];
  recordedAcceptances?: DisclosureAcceptance[];
}

const hasCurrentTermsAcceptance = (
  data: DisclosureStatusShape | null | undefined
): boolean => {
  const termsRequirement = data?.requiredDocuments?.find(
    (requirement) => requirement.documentKind === "TERMS"
  );

  return Boolean(
    termsRequirement &&
      data?.recordedAcceptances?.some(
        (acceptance) =>
          acceptance.documentKind === termsRequirement.documentKind &&
          acceptance.version === termsRequirement.version &&
          acceptance.effectiveDate === termsRequirement.effectiveDate &&
          acceptance.actionType === termsRequirement.actionType
      )
  );
};

const hasMatchingPublishedRequirements = (
  requirements: PrivateBetaDisclosureRequirementDto[]
): boolean =>
  requirements.length === DISCLOSURE_REQUIREMENTS.length &&
  DISCLOSURE_REQUIREMENTS.every((localRequirement) =>
    requirements.some(
      (serverRequirement) =>
        documentKeyByKind[serverRequirement.documentKind] ===
          localRequirement.documentKey &&
        serverRequirement.version === localRequirement.version &&
        serverRequirement.effectiveDate === localRequirement.effectiveDate &&
        serverRequirement.actionType === localRequirement.actionType
    )
  );

export const PrivateBetaDisclosurePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const disclosure = usePrivateBetaDisclosure();
  const [checked, setChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<Error | null>(null);
  const returnTarget = resolveAuthReturnTarget(location);

  const serverRequirements = disclosure.data?.requiredDocuments;
  const requirements = useMemo(
    () =>
      (serverRequirements ?? []).filter(
        (requirement) => requirement.documentKind === "TERMS"
      ),
    [serverRequirements]
  );
  const publicationReady = useMemo(
    () =>
      requirements.every((requirement) =>
        Boolean(
          getPublishedLegalDocument(documentKeyByKind[requirement.documentKind])
        )
      ),
    [requirements]
  );
  const requirementsAligned = hasMatchingPublishedRequirements(requirements);
  const isRequirementAccepted = (
    requirement: PrivateBetaDisclosureRequirementDto
  ): boolean =>
    disclosure.data?.recordedAcceptances.some(
      (acceptance) =>
        acceptance.documentKind === requirement.documentKind &&
        acceptance.version === requirement.version &&
        acceptance.effectiveDate === requirement.effectiveDate &&
        acceptance.actionType === requirement.actionType
    ) ?? false;
  const allRequirementsAccepted = requirements.every(isRequirementAccepted);
  const termsAccepted = hasCurrentTermsAcceptance(disclosure.data);

  useEffect(() => {
    if (
      termsAccepted &&
      location.pathname === PRIVATE_BETA_DISCLOSURE_ROUTE
    ) {
      navigate(returnTarget, { replace: true });
    }
  }, [location.pathname, navigate, returnTarget, termsAccepted]);

  if (disclosure.isLoading || (!disclosure.isFetched && !disclosure.error)) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 12 }}>
        <CircularProgress aria-label="Loading Terms" />
      </Box>
    );
  }

  if (disclosure.error || !disclosure.isReady || !disclosure.data) {
    return (
      <Box component="main" sx={{ maxWidth: 720, mx: "auto", px: 3, py: 8 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          We couldn’t load the current Terms. Product access
          remains blocked until they can be verified.
        </Alert>
        <Button variant="contained" onClick={() => void disclosure.refetch()}>
          Refresh Terms
        </Button>
      </Box>
    );
  }

  if (!publicationReady || !requirementsAligned) {
    return (
      <Box component="main" sx={{ maxWidth: 720, mx: "auto", px: 3, py: 8 }}>
        <Alert severity="error">
          The current Terms are not available in a consistent version. Product
          access remains blocked while this is resolved.
        </Alert>
      </Box>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmissionError(null);
    setIsSubmitting(true);

    try {
      if (!allRequirementsAccepted && !checked) {
        throw new Error("Please agree to the current Terms.");
      }

      for (const requirement of requirements) {
        if (!isRequirementAccepted(requirement)) {
          await disclosure.submitAcceptance({
            documentKind: requirement.documentKind,
            version: requirement.version,
            effectiveDate: requirement.effectiveDate,
            actionType: requirement.actionType,
          });
        }
      }

      const updatedStatus = await disclosure.refetch();
      if (!hasCurrentTermsAcceptance(updatedStatus)) {
        throw new Error(
          "The Terms were submitted, but the account is not complete yet."
        );
      }
      navigate(returnTarget, { replace: true });
    } catch (error) {
      setSubmissionError(
        error instanceof Error
          ? error
          : new Error("Terms submission failed.")
      );
      if (isStaleVersionError(error instanceof Error ? error : null)) {
        await disclosure.refetch();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box component="main" sx={{ maxWidth: 880, mx: "auto", px: 3, py: 7 }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Beta
          </Typography>
          <Typography variant="h3" component="h1" gutterBottom>
            Before you enter Hey Hey
          </Typography>
          <Typography color="text.secondary">
            Please review the current Terms before entering Hey Hey. Your
            agreement is recorded for this account.
          </Typography>
        </Box>

        {submissionError && (
          <Alert severity="error">
            {isStaleVersionError(submissionError)
              ? "These Terms changed while you were reviewing them. Refresh the current version and try again."
              : submissionError.message}
          </Alert>
        )}

        <Box component="form" onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {requirements.map((requirement) => {
              const documentKey = documentKeyByKind[requirement.documentKind];
              const document = getPublishedLegalDocument(documentKey);
              const accepted = isRequirementAccepted(requirement);

              return (
                <Card key={requirement.documentKind} variant="outlined">
                  <CardContent>
                    <Stack spacing={1.5}>
                      <Typography variant="h5" component="h2">
                        {document?.title ?? documentKey}
                      </Typography>
                      <Typography color="text.secondary">
                        Version {requirement.version} · Effective{" "}
                        {requirement.effectiveDate}
                      </Typography>
                      <Typography>{document?.summary}</Typography>
                      <Link
                        href={LEGAL_ROUTES[documentKey]}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Read the full {documentKey} disclosure
                      </Link>
                      {accepted && (
                        <Typography color="success.main">
                          Current version already recorded for this account.
                        </Typography>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
            <FormControlLabel
              control={
                <Checkbox
                  checked={allRequirementsAccepted || checked}
                  disabled={allRequirementsAccepted || isSubmitting}
                  onChange={(event) => setChecked(event.target.checked)}
                  inputProps={{
                    "aria-label":
                      "Agree to the current Terms",
                  }}
                />
              }
              label="I agree to the current Terms."
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Saving your responses…" : "Continue to Hey Hey"}
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

export default PrivateBetaDisclosurePage;

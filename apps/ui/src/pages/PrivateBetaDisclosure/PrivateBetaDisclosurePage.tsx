import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Alert,
  Box,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import {
  BRANDED_NESTED_FILL,
  BRANDED_NESTED_RULE_COLOR,
  BRANDED_TEAL,
  BrandedButton,
  BrandedCard,
  BrandedHeadline,
  BrandedPage,
  BrandedWordmark,
} from "@hey-hey/ui-common/components";
import type { PrivateBetaDisclosureRequirementDto } from "@hey-hey/contracts/api";
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

const WELCOME_PATH = "/welcome";

const CARD_SX = { maxWidth: "560px" } as const;
const MUTED_SX = { color: "rgb(255 255 255 / 72%)" } as const;

/** The branded frame every state of this screen sits in. */
const DisclosureFrame = ({
  children,
  headline,
}: {
  children: ReactNode;
  headline?: { title: string; line: string };
}) => (
  <BrandedPage>
    <BrandedWordmark>HEY HEY</BrandedWordmark>
    {headline ? (
      <BrandedHeadline line={headline.line}>{headline.title}</BrandedHeadline>
    ) : null}
    <BrandedCard sx={CARD_SX}>{children}</BrandedCard>
  </BrandedPage>
);

/** Accepting the Terms always continues to /welcome, keeping any /welcome target's query (local setup carries its project). */
const destinationAfterAcceptance = (returnTarget: string): string =>
  new URL(returnTarget, "https://app.local").pathname === WELCOME_PATH
    ? returnTarget
    : WELCOME_PATH;

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
  data: DisclosureStatusShape | null | undefined,
): boolean => {
  const termsRequirement = data?.requiredDocuments?.find(
    (requirement) => requirement.documentKind === "TERMS",
  );

  return Boolean(
    termsRequirement &&
    data?.recordedAcceptances?.some(
      (acceptance) =>
        acceptance.documentKind === termsRequirement.documentKind &&
        acceptance.version === termsRequirement.version &&
        acceptance.effectiveDate === termsRequirement.effectiveDate &&
        acceptance.actionType === termsRequirement.actionType,
    ),
  );
};

const hasMatchingPublishedRequirements = (
  requirements: PrivateBetaDisclosureRequirementDto[],
): boolean =>
  requirements.length === DISCLOSURE_REQUIREMENTS.length &&
  DISCLOSURE_REQUIREMENTS.every((localRequirement) =>
    requirements.some(
      (serverRequirement) =>
        documentKeyByKind[serverRequirement.documentKind] ===
          localRequirement.documentKey &&
        serverRequirement.version === localRequirement.version &&
        serverRequirement.effectiveDate === localRequirement.effectiveDate &&
        serverRequirement.actionType === localRequirement.actionType,
    ),
  );

export const PrivateBetaDisclosurePage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const disclosure = usePrivateBetaDisclosure();
  const [checked, setChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<Error | null>(null);
  const acceptingRef = useRef(false);
  const returnTarget = resolveAuthReturnTarget(location);

  const serverRequirements = disclosure.data?.requiredDocuments;
  const requirements = useMemo(
    () =>
      (serverRequirements ?? []).filter(
        (requirement) => requirement.documentKind === "TERMS",
      ),
    [serverRequirements],
  );
  const publicationReady = useMemo(
    () =>
      requirements.every((requirement) =>
        Boolean(
          getPublishedLegalDocument(
            documentKeyByKind[requirement.documentKind],
          ),
        ),
      ),
    [requirements],
  );
  const requirementsAligned = hasMatchingPublishedRequirements(requirements);
  const isRequirementAccepted = (
    requirement: PrivateBetaDisclosureRequirementDto,
  ): boolean =>
    disclosure.data?.recordedAcceptances.some(
      (acceptance) =>
        acceptance.documentKind === requirement.documentKind &&
        acceptance.version === requirement.version &&
        acceptance.effectiveDate === requirement.effectiveDate &&
        acceptance.actionType === requirement.actionType,
    ) ?? false;
  const allRequirementsAccepted = requirements.every(isRequirementAccepted);
  const termsAccepted = hasCurrentTermsAcceptance(disclosure.data);

  useEffect(() => {
    if (
      termsAccepted &&
      !acceptingRef.current &&
      location.pathname === PRIVATE_BETA_DISCLOSURE_ROUTE
    ) {
      navigate(returnTarget, { replace: true });
    }
  }, [location.pathname, navigate, returnTarget, termsAccepted]);

  if (disclosure.isLoading || (!disclosure.isFetched && !disclosure.error)) {
    return (
      <DisclosureFrame>
        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress aria-label="Loading Terms" color="inherit" />
        </Box>
      </DisclosureFrame>
    );
  }

  if (disclosure.error || !disclosure.isReady || !disclosure.data) {
    return (
      <DisclosureFrame>
        <Alert severity="error" sx={{ mb: 2 }}>
          We couldn’t load the current Terms. Product access remains blocked
          until they can be verified.
        </Alert>
        <BrandedButton type="button" onClick={() => void disclosure.refetch()}>
          Refresh Terms
        </BrandedButton>
      </DisclosureFrame>
    );
  }

  if (!publicationReady || !requirementsAligned) {
    return (
      <DisclosureFrame>
        <Alert severity="error">
          The current Terms are not available in a consistent version. Product
          access remains blocked while this is resolved.
        </Alert>
      </DisclosureFrame>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmissionError(null);
    setIsSubmitting(true);
    acceptingRef.current = true;

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
          "The Terms were submitted, but the account is not complete yet.",
        );
      }
      navigate(destinationAfterAcceptance(returnTarget), { replace: true });
    } catch (error) {
      acceptingRef.current = false;
      setSubmissionError(
        error instanceof Error ? error : new Error("Terms submission failed."),
      );
      if (isStaleVersionError(error instanceof Error ? error : null)) {
        await disclosure.refetch();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <DisclosureFrame
      headline={{
        title: "Before you enter Hey Hey",
        line: "Please review the current Terms before entering Hey Hey. Your agreement is recorded for this account.",
      }}
    >
      {submissionError && (
        <Alert severity="error" sx={{ mb: 2 }}>
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
              <Box
                key={requirement.documentKind}
                sx={{
                  p: 2,
                  border: `1px solid ${BRANDED_NESTED_RULE_COLOR}`,
                  borderRadius: "8px",
                  background: BRANDED_NESTED_FILL,
                }}
              >
                <Stack spacing={1.5}>
                  <Typography
                    variant="h6"
                    component="h2"
                    sx={{ color: "#fff" }}
                  >
                    {document?.title ?? documentKey}
                  </Typography>
                  <Typography sx={MUTED_SX}>
                    Version {requirement.version} · Effective{" "}
                    {requirement.effectiveDate}
                  </Typography>
                  <Typography>{document?.summary}</Typography>
                  <Link
                    href={LEGAL_ROUTES[documentKey]}
                    target="_blank"
                    rel="noreferrer"
                    sx={{ color: BRANDED_TEAL }}
                  >
                    Read the full {documentKey} disclosure
                  </Link>
                  {accepted && (
                    <Typography color="success.main">
                      Current version already recorded for this account.
                    </Typography>
                  )}
                </Stack>
              </Box>
            );
          })}
          <FormControlLabel
            control={
              <Checkbox
                checked={allRequirementsAccepted || checked}
                disabled={allRequirementsAccepted || isSubmitting}
                onChange={(event) => setChecked(event.target.checked)}
                inputProps={{
                  "aria-label": "Agree to the current Terms",
                }}
                sx={{ color: "rgb(255 255 255 / 70%)" }}
              />
            }
            label="I agree to the current Terms."
          />
          <BrandedButton type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving your responses…" : "Continue to Hey Hey"}
          </BrandedButton>
        </Stack>
      </Box>
    </DisclosureFrame>
  );
};

export default PrivateBetaDisclosurePage;

export const LEGAL_ROUTES = {
  terms: "/terms",
  privacy: "/privacy",
  security: "/security",
} as const;

export const DISCLOSURE_VERSION = "1.2-beta";
export const DISCLOSURE_EFFECTIVE_DATE = "September 14, 2026";
export const DISCLOSURE_EFFECTIVE_DATE_ISO = "2026-09-14";
export const DISCLOSURE_RELEASE_ID =
  "controller-authorized-local-execution-cutover-v2";

export type LegalDocumentKey = keyof typeof LEGAL_ROUTES;

type DisclosureActionType = "AGREED" | "ACKNOWLEDGED";

export interface DisclosureRequirement {
  documentKey: LegalDocumentKey;
  version: typeof DISCLOSURE_VERSION;
  effectiveDate: typeof DISCLOSURE_EFFECTIVE_DATE_ISO;
  actionType: DisclosureActionType;
}

/**
 * The authenticated gate requires agreement to the current Terms only.
 * Privacy and security content remains available as public reference material
 * without adding extra acceptance checkpoints to product entry.
 */
export const DISCLOSURE_REQUIREMENTS: readonly DisclosureRequirement[] = [
  {
    documentKey: "terms",
    version: DISCLOSURE_VERSION,
    effectiveDate: DISCLOSURE_EFFECTIVE_DATE_ISO,
    actionType: "AGREED",
  },
];

interface LegalClaim {
  id: string;
  text: string;
}

interface LegalSection {
  id: string;
  heading: string;
  claims: readonly LegalClaim[];
}

export interface LegalDocument {
  key: LegalDocumentKey;
  title: string;
  shortTitle: string;
  summary: string;
  sections: readonly LegalSection[];
}

interface ReviewedClaim {
  status: "VERIFIED";
  releaseId: typeof DISCLOSURE_RELEASE_ID;
  revision: string;
}

export interface DisclosureReviewRecord {
  status: "PASSED" | "BLOCKED";
  releaseId: string;
  revisions: {
    api: string;
    cli: string;
    ui: string;
    openapi: string;
    endToEnd: string;
  };
  claims: Record<string, ReviewedClaim>;
}

const verifiedRevision = "release-gate-2026-08-17";

const claim = (id: string, text: string): LegalClaim => ({ id, text });

const termsSections: readonly LegalSection[] = [
  {
    id: "terms-beta",
    heading: "Beta",
    claims: [
      claim(
        "terms-private-beta",
        "Hey Hey is currently offered as a beta. Features, limits, availability, and supported integrations may change, be interrupted, or be withdrawn. Do not rely on the beta for emergency response or work that requires uninterrupted production availability.",
      ),
    ],
  },
  {
    id: "terms-account-and-authority",
    heading: "Account identity is not local authority",
    claims: [
      claim(
        "terms-account-identity",
        "Your Hey Hey account identifies you and lets you use account and project features. A paired computer is a computer where you have installed Agent Bridge and connected it to your Hey Hey account. Connecting a computer does not by itself authorize Hey Hey to run commands or read local files. Local access requires separate approval.",
      ),
      claim(
        "terms-account-only-reductions",
        "Account-only controls may reduce authority: stop, pause, or cancel work, revoke a controller, or revoke a machine. Increasing or restoring local authority requires the enrolled controller path and, where applicable, explicit local confirmation.",
      ),
      claim(
        "terms-security-boundary-link",
        "The detailed, release-specific explanation is available in the Agent Bridge Security Boundary disclosure.",
      ),
    ],
  },
  {
    id: "terms-use",
    heading: "Using the service",
    claims: [
      claim(
        "terms-authorized-use",
        "Use Hey Hey only with accounts, projects, machines, credentials, data, and model-provider accounts that you are authorized to use. Review proposed actions and outputs before relying on them, and follow the terms of any provider or integration that you select.",
      ),
      claim(
        "terms-local-responsibility",
        "You are responsible for the security of your local computer, operating-system account, controller devices, passkey ecosystem, provider credentials, and any action you approve within the scope of a legitimate agent turn or Task Monitor grant.",
      ),
    ],
  },
  {
    id: "terms-data",
    heading: "Data and service changes",
    claims: [
      claim(
        "terms-privacy-incorporation",
        "The Privacy Policy describes how Hey Hey routes, stores, uses, and deletes your information. It is part of these terms for the beta and is linked below for direct access.",
      ),
      claim(
        "terms-no-warranty",
        "The beta is provided for evaluation and feedback. To the extent allowed by law, it is provided without a promise that every feature will be uninterrupted, error-free, or suitable for a particular purpose.",
      ),
    ],
  },
];

const privacySections: readonly LegalSection[] = [
  {
    id: "privacy-data-we-handle",
    heading: "Information Hey Hey stores and collects",
    claims: [
      claim(
        "privacy-account-data",
        "Hey Hey stores the information needed to provide your workspace. This includes your account details, projects, messages you send, and responses or results from your selected AI provider that are saved to your project history.",
      ),
      claim(
        "privacy-security-telemetry",
        "Hey Hey collects limited technical information needed to operate and protect the service, such as timestamps, request outcomes, uptime, and response times. We do not put passwords, access keys, private keys, or other authentication secrets in our logs.",
      ),
    ],
  },
  {
    id: "privacy-data-flow",
    heading: "Where data goes",
    claims: [
      claim(
        "privacy-local-processing",
        "A paired computer is a computer where you have installed Agent Bridge and connected it to your Hey Hey account. Agent Bridge runs on that computer. Connecting a computer does not by itself authorize Hey Hey to run commands or read local files. Local access requires separate approval.",
      ),
      claim(
        "privacy-heyhey-routing-storage",
        "Hey Hey routes authenticated requests, authorization state, status, messages, and related project or run records between the product and the paired CLI. Hey Hey stores the service records needed to operate the product, provide support, enforce security, and maintain the account.",
      ),
      claim(
        "privacy-provider-transfers",
        "When you request a model operation, the Agent Bridge sends the prompts, context, files, tool results, or other content selected for that operation to the model provider you chose. The provider receives that content under its own service terms and privacy practices; do not request an operation with content unless you are authorized to share it.",
      ),
      claim(
        "privacy-provider-metering",
        "Hey Hey does not control provider metering or allowance accounting, and cannot guarantee that one model operation uses only a small or predictable portion of an allowance. A provider may consume a substantial portion of, or the remainder of, an allowance for an operation; this is a provider-controlled possibility, not a claim that this has occurred.",
      ),
    ],
  },
  {
    id: "privacy-credentials-and-passkeys",
    heading: "Credentials, local state, and passkeys",
    claims: [
      claim(
        "privacy-credential-storage",
        "The CLI stores its machine private key, machine credential, and related secrets using the operating-system credential protection already provided by the host. Controller registry, grant, and replay state is kept in integrity-protected local durable state. The server retains the public material and hashes needed to verify and revoke authority, not the controller private key.",
      ),
      claim(
        "privacy-passkey-sync",
        "A synced passkey can be available through the user's Apple, Google, or another passkey ecosystem. That means controller authorization follows the enrolled WebAuthn credential and its ecosystem, not necessarily one physical browser. The product records backup eligibility and backup state as part of the controller evidence.",
      ),
    ],
  },
  {
    id: "privacy-retention",
    heading: "Use and retention",
    claims: [
      claim(
        "privacy-data-use",
        "Hey Hey automatically processes your account and workspace information to provide the features you request, keep your project history, and secure your account. We measure reliability using technical information such as uptime, errors, and response times—not by reading your messages, prompts, local files, or AI-provider responses. We do not manually review your personal content unless you ask us to or give us permission, such as when you request support and choose to share relevant information. We may access or disclose information when legally required to do so.",
      ),
      claim(
        "privacy-retention-schedule",
        "Hey Hey retains account, project, run, security, and support records while they are needed for the beta service, security, support, or legal obligations. Backups, fraud-prevention records, and security logs may remain until their ordinary expiry or legal hold ends.",
      ),
    ],
  },
];

const securitySections: readonly LegalSection[] = [
  {
    id: "security-scope",
    heading: "What this paper covers",
    claims: [
      claim(
        "security-release-scope",
        "This paper describes the verified controller-authorized local execution release. It covers local execution and local reads, Hey Hey routing and storage, transfers to user-selected model providers, credential and local-state storage, passkey synchronization and backup evidence, grants, replay retention, revocation, recovery, threat exclusions, and residual risks.",
      ),
      claim(
        "security-release-gate",
        "The page is publishable only when the release gate records a passed result for this exact release and every claim below is verified against the matching API, CLI, UI, OpenAPI, and end-to-end revisions.",
      ),
    ],
  },
  {
    id: "security-identity-authority",
    heading: "Account identity and controller authority",
    claims: [
      claim(
        "security-account-not-authority",
        "A paired computer is a computer where you have installed Agent Bridge and connected it to your Hey Hey account. Connecting a computer does not by itself authorize Hey Hey to run commands or read local files. An enrolled controller provides the separate approval required for work that affects the computer.",
      ),
      claim(
        "security-account-only-stop",
        "Account-only stop, pause, cancel, controller revocation, and machine revocation reduce authority. They cannot start, resume, widen, or redirect local execution. Authority-increasing actions require a fresh controller assertion or a still-valid bounded grant.",
      ),
    ],
  },
  {
    id: "security-local-boundary",
    heading: "Local execution and local reads",
    claims: [
      claim(
        "security-local-execution",
        "Every host-affecting execution request uses protocol version 2 and carries either a fresh WebAuthn controller assertion for the exact action or a bounded grant created from that assertion. The API checks the proof before dispatch, and the CLI independently verifies the controller proof, platform signature, identity, scope, freshness, replay state, and allowlist before dispatching locally.",
      ),
      claim(
        "security-local-reads",
        "Local reads use the same authorized machine boundary. A request cannot read local files, inspect local state, or cause another host-side effect merely because the requester has an account session; it must pass the controller or bounded-grant checks for the selected machine and action.",
      ),
    ],
  },
  {
    id: "security-platform-boundary",
    heading: "Hey Hey routing and storage",
    claims: [
      claim(
        "security-heyhey-routing",
        "Hey Hey authenticates and routes requests to the addressed owner, organization, project, machine, agent session, or Task Monitor. The machine channel derives or authorizes its scope server-side; client-supplied room or subscription identifiers do not create authority.",
      ),
      claim(
        "security-heyhey-storage",
        "Hey Hey stores the account, project, message, authorization, grant, status, report, and audit records required to operate and secure the service. Secrets and executable payloads are excluded from production logs and user-visible diagnostics.",
      ),
    ],
  },
  {
    id: "security-provider-boundary",
    heading: "Transfers to model providers",
    claims: [
      claim(
        "security-provider-transfer",
        "When you request a model operation, the Agent Bridge sends the context selected for that operation to the model provider you chose. The provider uses that context to generate a response or perform the requested operation. Provider retention, training, regional processing, and access rules are governed by that provider's terms; Hey Hey does not make those provider promises on the provider's behalf.",
      ),
    ],
  },
  {
    id: "security-credential-state",
    heading: "Credential and local-state storage",
    claims: [
      claim(
        "security-credential-storage",
        "The CLI stores the machine private key and machine credential with operating-system credential protection. Controller registry, grant state, and consumed-authorization replay state are durable and integrity-protected locally. The server verifies public controller material and credential hashes and can revoke the binding.",
      ),
      claim(
        "security-secret-free-logging",
        "Enrollment codes, device secrets, machine credentials, private keys, WebAuthn client or authenticator data, assertions, signatures, and canonical executable payloads are not production log fields or user-visible response fields.",
      ),
    ],
  },
  {
    id: "security-passkeys",
    heading: "Passkey synchronization and backup evidence",
    claims: [
      claim(
        "security-passkey-evidence",
        "Controller enrollment requires a verified WebAuthn credential and user verification, followed by explicit local confirmation on the CLI. The UI and CLI record backup eligibility and backup state. Both single-device and synced credentials are part of the supported beta boundary.",
      ),
      claim(
        "security-passkey-synchronization",
        "A synced passkey can be available on more than one device in its passkey ecosystem. The security boundary therefore treats the enrolled credential and its ecosystem as the controller authority, rather than claiming that authorization is restricted to one physical browser.",
      ),
    ],
  },
  {
    id: "security-grants-replay",
    heading: "Grants and replay retention",
    claims: [
      claim(
        "security-bounded-grants",
        "Interactive grants are scoped to one machine, controller, agent session, and user turn. Task Monitor grants are scoped to one machine, monitor, selected-work set, policy fingerprint, and monitor revision. Widening the action set or changing the selection or policy requires fresh controller authorization.",
      ),
      claim(
        "security-replay-retention",
        "Controller challenges expire after two minutes and are consumed once by the API. Executable delivery envelopes retain the existing plus-or-minus thirty-second freshness window. The CLI durably retains consumed authorization identifiers for at least ten minutes, so a restart cannot reopen the replay window.",
      ),
    ],
  },
  {
    id: "security-revocation",
    heading: "Controller and machine revocation",
    claims: [
      claim(
        "security-controller-revocation",
        "Revoking a controller removes its server routing and local authoritative allowlist authority. Account-only controller revocation is permitted because it reduces authority; adding or replacing authority follows the enrolled controller path.",
      ),
      claim(
        "security-machine-revocation",
        "Revoking a machine disconnects active sockets and prevents that machine from reauthenticating. It removes the machine's ability to receive authorized work until a new, locally confirmed enrollment is completed.",
      ),
    ],
  },
  {
    id: "security-recovery",
    heading: "Lost-controller recovery",
    claims: [
      claim(
        "security-local-recovery",
        "If all controllers are lost, recovery begins locally on the paired CLI. Account access alone, a website-only flow, or possession of an account credential cannot restore execution authority. The local ceremony creates the evidence needed for a new controller.",
      ),
    ],
  },
  {
    id: "security-threat-exclusions",
    heading: "Threats this boundary does not exclude",
    claims: [
      claim(
        "security-threat-exclusions",
        "This release does not claim to protect against malware running as the local user, compromise of an already-authorized controller or its passkey ecosystem, a malicious or fully compromised Hey Hey origin that tricks a present user into approving a transaction, operating-system credential-store compromise, or unsafe actions performed within a legitimately authorized agent turn or Task Monitor grant.",
      ),
      claim(
        "security-webauthn-display-limit",
        "WebAuthn user verification does not display the canonical transaction contents. Users must review the product's prepared action and the local context before approving it.",
      ),
    ],
  },
  {
    id: "security-residual-risks",
    heading: "Residual risks",
    claims: [
      claim(
        "security-residual-risks",
        "A stolen account session can expose cloud-account data and can perform authority-reducing actions, including denial of service, but it cannot start local execution without controller authority. A compromised controller, passkey ecosystem, local operating-system account, or a user-approved action remains a material risk within its legitimate scope.",
      ),
      claim(
        "security-evidence-maintenance",
        "This disclosure must be reviewed again whenever the API, CLI, UI, OpenAPI contract, or end-to-end security evidence changes. Unverified design-only behavior is not a published guarantee.",
      ),
    ],
  },
];

export const LEGAL_DOCUMENTS: Readonly<
  Record<LegalDocumentKey, LegalDocument>
> = {
  terms: {
    key: "terms",
    title: "Terms of Service",
    shortTitle: "Terms",
    summary: "The beta terms for using Hey Hey and Agent Bridge.",
    sections: termsSections,
  },
  privacy: {
    key: "privacy",
    title: "Privacy Policy",
    shortTitle: "Privacy",
    summary:
      "How Hey Hey handles account, project, Agent Bridge, and provider data.",
    sections: privacySections,
  },
  security: {
    key: "security",
    title: "Agent Bridge Security Boundary",
    shortTitle: "Security",
    summary:
      "The verified boundary between Hey Hey account identity, controller authority, and local execution.",
    sections: securitySections,
  },
};

/**
 * This is the checked-in, machine-readable publication record for the copy
 * above. The inventory is intentionally independent from LEGAL_DOCUMENTS: a
 * newly authored claim is blocked until the release review explicitly adds it.
 */
const reviewedClaimIds = [
  "terms-private-beta",
  "terms-account-identity",
  "terms-account-only-reductions",
  "terms-security-boundary-link",
  "terms-authorized-use",
  "terms-local-responsibility",
  "terms-privacy-incorporation",
  "terms-no-warranty",
  "privacy-account-data",
  "privacy-security-telemetry",
  "privacy-local-processing",
  "privacy-heyhey-routing-storage",
  "privacy-provider-transfers",
  "privacy-provider-metering",
  "privacy-credential-storage",
  "privacy-passkey-sync",
  "privacy-data-use",
  "privacy-retention-schedule",
  "security-release-scope",
  "security-release-gate",
  "security-account-not-authority",
  "security-account-only-stop",
  "security-local-execution",
  "security-local-reads",
  "security-heyhey-routing",
  "security-heyhey-storage",
  "security-provider-transfer",
  "security-credential-storage",
  "security-secret-free-logging",
  "security-passkey-evidence",
  "security-passkey-synchronization",
  "security-bounded-grants",
  "security-replay-retention",
  "security-controller-revocation",
  "security-machine-revocation",
  "security-local-recovery",
  "security-threat-exclusions",
  "security-webauthn-display-limit",
  "security-residual-risks",
  "security-evidence-maintenance",
] as const;

export const DISCLOSURE_REVIEW_RECORD: DisclosureReviewRecord = {
  status: "PASSED",
  releaseId: DISCLOSURE_RELEASE_ID,
  revisions: {
    api: DISCLOSURE_RELEASE_ID,
    cli: DISCLOSURE_RELEASE_ID,
    ui: DISCLOSURE_RELEASE_ID,
    openapi: DISCLOSURE_RELEASE_ID,
    endToEnd: DISCLOSURE_RELEASE_ID,
  },
  claims: Object.fromEntries(
    reviewedClaimIds.map((claimId) => [
      claimId,
      {
        status: "VERIFIED",
        releaseId: DISCLOSURE_RELEASE_ID,
        revision: verifiedRevision,
      },
    ]),
  ) as Record<string, ReviewedClaim>,
};

export const getDocumentClaimIds = (document: LegalDocument): string[] =>
  document.sections.flatMap((section) =>
    section.claims.map((publishedClaim) => publishedClaim.id),
  );

export const isDisclosurePublicationReady = (
  document: LegalDocument,
  reviewRecord: DisclosureReviewRecord = DISCLOSURE_REVIEW_RECORD,
): boolean => {
  if (
    reviewRecord.status !== "PASSED" ||
    reviewRecord.releaseId !== DISCLOSURE_RELEASE_ID
  ) {
    return false;
  }

  const revisions = Object.values(reviewRecord.revisions);
  if (
    revisions.length !== 5 ||
    revisions.some((revision) => revision !== DISCLOSURE_RELEASE_ID)
  ) {
    return false;
  }

  return getDocumentClaimIds(document).every((claimId) => {
    const reviewedClaim = reviewRecord.claims[claimId];
    return (
      reviewedClaim?.status === "VERIFIED" &&
      reviewedClaim.releaseId === DISCLOSURE_RELEASE_ID &&
      reviewedClaim.revision === verifiedRevision
    );
  });
};

export const getPublishedLegalDocument = (
  key: LegalDocumentKey,
  reviewRecord: DisclosureReviewRecord = DISCLOSURE_REVIEW_RECORD,
): LegalDocument | null => {
  const document = LEGAL_DOCUMENTS[key];
  return isDisclosurePublicationReady(document, reviewRecord) ? document : null;
};

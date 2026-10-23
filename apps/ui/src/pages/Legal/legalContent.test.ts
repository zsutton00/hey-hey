import { describe, expect, it } from "vitest";
import {
  DISCLOSURE_EFFECTIVE_DATE_ISO,
  DISCLOSURE_REQUIREMENTS,
  DISCLOSURE_VERSION,
  DISCLOSURE_RELEASE_ID,
  DISCLOSURE_REVIEW_RECORD,
  getDocumentClaimIds,
  getPublishedLegalDocument,
  isDisclosurePublicationReady,
  LEGAL_DOCUMENTS,
  LEGAL_ROUTES,
  type DisclosureReviewRecord,
} from "./legalContent";

describe("legal disclosure publication gate", () => {
  it("publishes every disclosure only for the passed exact release", () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      expect(isDisclosurePublicationReady(document)).toBe(true);
      expect(getPublishedLegalDocument(document.key)).toBe(document);
    }

    expect(DISCLOSURE_REVIEW_RECORD.releaseId).toBe(DISCLOSURE_RELEASE_ID);
    expect(DISCLOSURE_REVIEW_RECORD.revisions).toEqual({
      api: DISCLOSURE_RELEASE_ID,
      cli: DISCLOSURE_RELEASE_ID,
      ui: DISCLOSURE_RELEASE_ID,
      openapi: DISCLOSURE_RELEASE_ID,
      endToEnd: DISCLOSURE_RELEASE_ID,
    });
  });

  it("blocks publication when the review is blocked or a claim is missing", () => {
    const blockedRecord: DisclosureReviewRecord = {
      ...DISCLOSURE_REVIEW_RECORD,
      status: "BLOCKED",
    };
    expect(getPublishedLegalDocument("security", blockedRecord)).toBeNull();

    const missingClaimRecord: DisclosureReviewRecord = {
      ...DISCLOSURE_REVIEW_RECORD,
      claims: { ...DISCLOSURE_REVIEW_RECORD.claims },
    };
    delete missingClaimRecord.claims[
      getDocumentClaimIds(LEGAL_DOCUMENTS.security)[0]
    ];
    expect(
      getPublishedLegalDocument("security", missingClaimRecord)
    ).toBeNull();

    const documentWithUnreviewedCopy = {
      ...LEGAL_DOCUMENTS.security,
      sections: [
        ...LEGAL_DOCUMENTS.security.sections,
        {
          id: "security-unreviewed-section",
          heading: "Unreviewed",
          claims: [
            { id: "security-unreviewed-claim", text: "Unreviewed copy" },
          ],
        },
      ],
    };
    expect(isDisclosurePublicationReady(documentWithUnreviewedCopy)).toBe(
      false
    );
  });

  it("keeps stable, unique public routes for all three disclosures", () => {
    expect(Object.values(LEGAL_ROUTES)).toEqual([
      "/terms",
      "/privacy",
      "/security",
    ]);
    expect(new Set(Object.values(LEGAL_ROUTES)).size).toBe(3);
  });

  it("publishes the corrected beta data boundary", () => {
    const allCopy = Object.values(LEGAL_DOCUMENTS)
      .flatMap((document) => document.sections)
      .flatMap((section) => section.claims)
      .map((publishedClaim) => publishedClaim.text)
      .join(" ");
    const privacyCopy = LEGAL_DOCUMENTS.privacy.sections
      .flatMap((section) => section.claims)
      .map((publishedClaim) => publishedClaim.text)
      .join(" ");
    const securityCopy = LEGAL_DOCUMENTS.security.sections
      .flatMap((section) => section.claims)
      .map((publishedClaim) => publishedClaim.text)
      .join(" ");

    expect(privacyCopy).toContain("Agent Bridge sends");
    expect(securityCopy).toContain("Agent Bridge sends");
    expect(allCopy).not.toContain("legal@heyhey.dev");
    expect(securityCopy).not.toContain("Version-1");
  });

  it("describes privacy practices in user-facing language", () => {
    const privacyCopy = LEGAL_DOCUMENTS.privacy.sections
      .flatMap((section) => section.claims)
      .map((publishedClaim) => publishedClaim.text)
      .join(" ");

    expect(privacyCopy).toContain(
      "account details, projects, messages you send"
    );
    expect(privacyCopy).toContain(
      "uptime, errors, and response times—not by reading your messages"
    );
    expect(privacyCopy).toContain(
      "We do not manually review your personal content unless you ask us to or give us permission"
    );
    expect(privacyCopy).not.toContain("Task Monitor metadata");
    expect(privacyCopy).not.toContain("reason codes");
    expect(privacyCopy).not.toContain("enrollment codes");
    expect(privacyCopy).not.toContain("service data");
  });

  it("keeps provider metering bounded to a provider-controlled possibility", () => {
    const privacyCopy = LEGAL_DOCUMENTS.privacy.sections
      .flatMap((section) => section.claims)
      .map((publishedClaim) => publishedClaim.text)
      .join(" ");

    expect(privacyCopy).toContain("does not control provider metering");
    expect(privacyCopy).toContain(
      "cannot guarantee that one model operation uses only a small or predictable portion"
    );
    expect(privacyCopy).toContain("provider-controlled possibility");
    expect(privacyCopy).toContain("not a claim that this has occurred");
    expect(privacyCopy).not.toMatch(
      /allowance has been exhausted|exhaustion occurred/i
    );
  });

  it("publishes only the current Terms as a gate requirement", () => {
    expect(DISCLOSURE_REQUIREMENTS).toEqual([
      {
        documentKey: "terms",
        version: DISCLOSURE_VERSION,
        effectiveDate: DISCLOSURE_EFFECTIVE_DATE_ISO,
        actionType: "AGREED",
      },
    ]);
  });

  it("defines a paired computer at first use in each disclosure", () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      const firstUse = document.sections
        .flatMap((section) => section.claims)
        .find((publishedClaim) =>
          publishedClaim.text.includes("paired computer")
        );

      expect(firstUse?.text).toContain(
        "A paired computer is a computer where you have installed Agent Bridge and connected it to your Hey Hey account."
      );
    }
  });
});

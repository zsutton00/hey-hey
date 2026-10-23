import { LegalDocumentPublicationBlocked } from "./LegalDocumentPublicationBlocked";
import { PublishedLegalDocument } from "./PublishedLegalDocument";
import {
  getPublishedLegalDocument,
  type LegalDocumentKey,
} from "./legalContent";

interface LegalDocumentLayoutProps {
  documentKey: LegalDocumentKey;
}

export const LegalDocumentLayout = ({
  documentKey,
}: LegalDocumentLayoutProps) => {
  const document = getPublishedLegalDocument(documentKey);

  if (!document) {
    return <LegalDocumentPublicationBlocked />;
  }

  return <PublishedLegalDocument document={document} />;
};

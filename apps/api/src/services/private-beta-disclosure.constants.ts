import type {
  PrivateBetaDisclosureActionType,
  PrivateBetaDisclosureDocumentKind,
  PrivateBetaDisclosureRequirementDto,
} from '../generated';

export const PRIVATE_BETA_DISCLOSURE_REQUIREMENTS = [
  {
    documentKind: 'TERMS',
    version: '1.2-beta',
    effectiveDate: '2026-09-14',
    actionType: 'AGREED',
  },
  {
    documentKind: 'PRIVACY',
    version: '1.2-beta',
    effectiveDate: '2026-09-14',
    actionType: 'ACKNOWLEDGED',
  },
  {
    documentKind: 'SECURITY',
    version: '1.2-beta',
    effectiveDate: '2026-09-14',
    actionType: 'ACKNOWLEDGED',
  },
] as const satisfies readonly PrivateBetaDisclosureRequirementDto[];

export const PRIVATE_BETA_DISCLOSURE_DOCUMENT_KINDS =
  PRIVATE_BETA_DISCLOSURE_REQUIREMENTS.map(
    ({ documentKind }) => documentKind,
  ) as readonly PrivateBetaDisclosureDocumentKind[];

export const PRIVATE_BETA_DISCLOSURE_ACTION_TYPES = [
  'AGREED',
  'ACKNOWLEDGED',
] as const satisfies readonly PrivateBetaDisclosureActionType[];

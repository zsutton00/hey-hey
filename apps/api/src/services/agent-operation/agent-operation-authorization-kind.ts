import { AgentOperationAuthorizationKind as PrismaAgentOperationAuthorizationKind } from '@prisma/client';
import {
  AdmissionEnvelopeAuthorization,
  BoundedGrantReference,
  ControllerAssertionEvidence,
} from '../../generated';

export type AdmittedAuthorizationKind = AdmissionEnvelopeAuthorization['kind'];

const PRISMA_AUTHORIZATION_KIND: Record<
  AdmittedAuthorizationKind,
  PrismaAgentOperationAuthorizationKind
> = {
  [ControllerAssertionEvidence.KindEnum.ControllerAssertion]:
    PrismaAgentOperationAuthorizationKind.CONTROLLER_ASSERTION,
  [BoundedGrantReference.KindEnum.BoundedGrant]:
    PrismaAgentOperationAuthorizationKind.BOUNDED_GRANT,
};

const ADMITTED_AUTHORIZATION_KIND: Record<
  PrismaAgentOperationAuthorizationKind,
  AdmittedAuthorizationKind
> = {
  [PrismaAgentOperationAuthorizationKind.CONTROLLER_ASSERTION]:
    ControllerAssertionEvidence.KindEnum.ControllerAssertion,
  [PrismaAgentOperationAuthorizationKind.BOUNDED_GRANT]:
    BoundedGrantReference.KindEnum.BoundedGrant,
};

export function toPrismaAuthorizationKind(
  kind: AdmittedAuthorizationKind,
): PrismaAgentOperationAuthorizationKind {
  return PRISMA_AUTHORIZATION_KIND[kind];
}

export function toAdmittedAuthorizationKind(
  kind: PrismaAgentOperationAuthorizationKind,
): AdmittedAuthorizationKind {
  return ADMITTED_AUTHORIZATION_KIND[kind];
}

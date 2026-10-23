type JwtPayload = {
  sub?: string;
  userId?: string;
  organizationId?: string;
  orgId?: string;
  currentOrgId?: string;
  currentOrganizationId?: string;
  organizationIds?: string[];
  organization?: { id?: string };
  orgMemberships?: Array<{
    orgId?: string;
    organizationId?: string;
    organization?: { id?: string };
  }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const readOptionalStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;

const readOptionalOrganization = (value: unknown): { id?: string } | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    ...(typeof value['id'] === 'string' ? { id: value['id'] } : {}),
  };
};

const readOptionalMemberships = (value: unknown): JwtPayload['orgMemberships'] => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const memberships = value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const organization = readOptionalOrganization(entry['organization']);
      const orgId = readOptionalString(entry['orgId']);
      const organizationId = readOptionalString(entry['organizationId']);

      if (!orgId && !organizationId && !organization?.id) {
        return null;
      }

      return {
        ...(orgId ? { orgId } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(organization ? { organization } : {}),
      };
    })
    .filter((entry): entry is NonNullable<JwtPayload['orgMemberships']>[number] => entry !== null);

  return memberships.length > 0 ? memberships : undefined;
};

const toJwtPayload = (value: unknown): JwtPayload | null => {
  if (!isRecord(value)) {
    return null;
  }

  const sub = readOptionalString(value['sub']);
  const userId = readOptionalString(value['userId']);
  const organizationId = readOptionalString(value['organizationId']);
  const orgId = readOptionalString(value['orgId']);
  const currentOrgId = readOptionalString(value['currentOrgId']);
  const currentOrganizationId = readOptionalString(value['currentOrganizationId']);
  const organizationIds = readOptionalStringArray(value['organizationIds']);
  const organization = readOptionalOrganization(value['organization']);
  const orgMemberships = readOptionalMemberships(value['orgMemberships']);

  return {
    ...(sub ? { sub } : {}),
    ...(userId ? { userId } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(orgId ? { orgId } : {}),
    ...(currentOrgId ? { currentOrgId } : {}),
    ...(currentOrganizationId ? { currentOrganizationId } : {}),
    ...(organizationIds ? { organizationIds } : {}),
    ...(organization ? { organization } : {}),
    ...(orgMemberships ? { orgMemberships } : {}),
  };
};

export const base64UrlDecode = (value: string): string | null => {
  if (!value) {
    return null;
  }
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4 || 4)) % 4)}`;
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return null;
  }
};

const decodeJwtPayload = (token: string): JwtPayload | null => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const payloadPart = parts[1];
  if (!payloadPart) {
    return null;
  }
  const decoded = base64UrlDecode(payloadPart);
  if (!decoded) {
    return null;
  }
  try {
    return toJwtPayload(JSON.parse(decoded));
  } catch {
    return null;
  }
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const extractUserIdFromToken = (token: string): string | null => {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }

  if (isNonEmptyString(payload.sub)) return payload.sub;
  if (isNonEmptyString(payload.userId)) return payload.userId;

  return null;
};

export const extractOrganizationIdFromToken = (token: string): string | null => {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }

  if (isNonEmptyString(payload.organizationId)) return payload.organizationId;
  if (isNonEmptyString(payload.orgId)) return payload.orgId;
  if (isNonEmptyString(payload.currentOrgId)) return payload.currentOrgId;
  if (isNonEmptyString(payload.currentOrganizationId)) return payload.currentOrganizationId;
  if (Array.isArray(payload.organizationIds) && isNonEmptyString(payload.organizationIds[0])) {
    return payload.organizationIds[0];
  }
  if (isNonEmptyString(payload.organization?.id)) return payload.organization.id;
  if (Array.isArray(payload.orgMemberships)) {
    const match = payload.orgMemberships.find(
      (membership) =>
        isNonEmptyString(membership.orgId) ||
        isNonEmptyString(membership.organizationId) ||
        isNonEmptyString(membership.organization?.id),
    );
    if (match?.orgId) return match.orgId;
    if (match?.organizationId) return match.organizationId;
    if (match?.organization?.id) return match.organization.id;
  }

  return null;
};

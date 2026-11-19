import { BadRequestException } from '@nestjs/common';
import { WorkStatus } from '@hey-hey/contracts/api/models';

export const REFERENCE_SORT_FIELDS = ['name', 'createdAt'] as const;
export const REFERENCE_SORT_ORDERS = ['asc', 'desc'] as const;

export type ReferenceSortField = (typeof REFERENCE_SORT_FIELDS)[number];
export type ReferenceSortOrder = (typeof REFERENCE_SORT_ORDERS)[number];

/** Page and limit of a reference read; both are required and bounded integers. */
export function parseReferencePaginationValue(
  raw: string | number | undefined,
  field: string,
  minimum: number,
  maximum?: number,
): number {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    throw new BadRequestException(`${field} is required`);
  }

  const parsed = Number(raw);
  const isOutOfRange =
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    (maximum !== undefined && parsed > maximum);
  if (isOutOfRange) {
    const range =
      maximum === undefined
        ? `at least ${minimum}`
        : `between ${minimum} and ${maximum}`;
    throw new BadRequestException(`${field} must be an integer ${range}`);
  }

  return parsed;
}

export function normalizeReferenceStatuses(
  statuses?: string | string[],
): WorkStatus[] | undefined {
  if (statuses === undefined) return undefined;

  const values = (Array.isArray(statuses) ? statuses : [statuses])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (values.length === 0) return undefined;

  const statusByValue = new Map<string, WorkStatus>(
    Object.values(WorkStatus).map((status) => [status, status]),
  );
  const normalized = values.map((value) => statusByValue.get(value));
  if (normalized.some((status) => status === undefined)) {
    throw new BadRequestException(
      `statuses must contain only WorkStatus values`,
    );
  }

  return [...new Set(normalized.filter((status) => status !== undefined))];
}

export function normalizeReferenceSortField(
  sortBy?: string,
): ReferenceSortField {
  if (sortBy === undefined || sortBy.length === 0) return 'name';
  const match = REFERENCE_SORT_FIELDS.find((field) => field === sortBy);
  if (!match) {
    throw new BadRequestException(
      `sortBy must be one of: ${REFERENCE_SORT_FIELDS.join(', ')}`,
    );
  }
  return match;
}

export function normalizeReferenceSortOrder(
  sortOrder?: string,
): ReferenceSortOrder {
  if (sortOrder === undefined || sortOrder.length === 0) return 'asc';
  const match = REFERENCE_SORT_ORDERS.find((order) => order === sortOrder);
  if (!match) {
    throw new BadRequestException(
      `sortOrder must be one of: ${REFERENCE_SORT_ORDERS.join(', ')}`,
    );
  }
  return match;
}

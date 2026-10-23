import { z } from 'zod';

// Only provider-controlled, payload-free attachment errors and bounded
// machine-readable completion diagnostics may enter logs. Unrecognized
// validation messages can echo user input and are withheld.
const attachmentReason = z.enum([
  'One or more Proposal attachments are missing or outside the requested scope',
  'One or more Proposal attachments already belong to a Message',
  'One or more Proposal Group attachments are invalid',
  'One or more Proposal Group attachments are outside the requested scope',
  'One or more Proposal Groups already belong to a Message',
  'One or more Proposal Group attachments have no members',
  'One or more Report attachments are missing or outside the requested scope',
  'One or more Report attachments already belong to a Message',
  'One or more Report attachments are outside the requested conversation',
  'Duplicate Proposal attachment identifiers are not allowed',
  'Duplicate Report attachment identifiers are not allowed',
  'Proposal and Report attachment identifiers are only accepted for SYSTEM messages',
]);

const safeMessage = attachmentReason.or(z.literal('')).catch('');
const safeDiagnosticToken = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,100}$/u)
  .optional()
  .catch(undefined);
const correlationId = z.string().uuid().optional().catch(undefined);

// Parse at the HTTP boundary; discard request configuration, headers other
// than correlation IDs, response payloads, and arbitrary exception text.
export const messageWriteFailureSchema = z
  .object({
    response: z
      .object({
        status: z.number().optional().catch(undefined),
        headers: z
          .object({
            'x-request-id': correlationId,
            'x-correlation-id': correlationId,
          })
          .optional()
          .catch(undefined),
        data: z
          .object({
            message: z
              .union([z.array(safeMessage).max(20), safeMessage])
              .optional()
              .catch(undefined),
            code: safeDiagnosticToken,
            errorCode: safeDiagnosticToken,
            reason: safeDiagnosticToken,
            requestId: correlationId,
            correlationId,
            responseBodyPresent: z.boolean().optional().catch(undefined),
          })
          .optional()
          .catch(undefined),
      })
      .optional()
      .catch(undefined),
  })
  .transform(({ response }) => ({
    statusCode: response?.status,
    requestId: response?.headers?.['x-request-id'] ?? response?.data?.requestId,
    correlationId: response?.headers?.['x-correlation-id'] ?? response?.data?.correlationId,
    validationReasons: [response?.data?.message].flat().filter((value) => Boolean(value)),
    rejectionCode: response?.data?.code ?? response?.data?.errorCode,
    rejectionReason: response?.data?.reason,
    responseBodyPresent: response?.data?.responseBodyPresent,
  }));

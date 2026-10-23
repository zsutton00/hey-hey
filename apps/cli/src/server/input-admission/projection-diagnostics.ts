import axios, { isAxiosError } from 'axios';
import { z } from 'zod';
import type { ReadableInputRecord } from './input-admission-codec';

function diagnosticUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin + url.pathname;
  } catch {
    return undefined;
  }
}

/** Log diagnostic fields only, never Axios config, credentials or admission payloads. */
export function projectionDiagnostics(
  record: ReadableInputRecord,
  apiBaseUrl: string,
  error: Error | string,
) {
  const context = {
    admissionId: record.admissionId,
    operationId: record.key,
    organizationId: record.organizationId,
    projectId: record.projectId,
    agentSessionId: record.agentSessionId,
    runId: record.runId,
    machineId: record.machineId,
    messageId: record.messageId,
    turnId: record.turnId,
    state: record.state,
    revision: record.revision,
    projectedRevision: record.projectedRevision,
    apiBaseUrl: diagnosticUrl(apiBaseUrl),
    error: error instanceof Error ? error.message : error,
  };
  if (!isAxiosError<object>(error)) return context;
  // Best-effort extraction, not response validation: proxies can return non-API bodies.
  const message = z.object({ message: z.string() }).safeParse(error.response?.data);
  return {
    ...context,
    method: error.config?.method?.toUpperCase(),
    requestUrl: error.config ? diagnosticUrl(axios.getUri(error.config)) : undefined,
    statusCode: error.response?.status,
    errorCode: error.code,
    responseMessage: message.success ? message.data.message.slice(0, 1000) : undefined,
  };
}

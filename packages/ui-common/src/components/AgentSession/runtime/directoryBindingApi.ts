import { getLocalAgentPort } from "../../../services/runtimeConfig";
import type { ServiceRepoBinding } from "../../../api";
import type {
  CliReadChangedFileDetail,
  CliReadChangedFileIdentity,
  CliReadChangedFileInventoryEntry,
  CliReadErrorCode,
  CliReadRunChangedFileDetailSuccessResponseDto,
  CliReadRunChangedFilesInventorySuccessResponseDto,
  LocalListRepoBindingsResponse,
  LocalRunAttachmentOpenSuccessResponse,
  LocalRunAttachmentSuccessResponse,
  LocalStagedRunAttachmentSuccessResponse,
  LocalRunAttachment,
  LocalPickRepoDirectoryResponse,
  LocalRunBrowserOpenRequest,
  LocalRunBrowserOpenSuccessResponse,
  LocalStagedBrowserTabOpenRequest,
  LocalStagedBrowserTabOpenSuccessResponse,
  LocalServiceRepoBinding,
  LocalSetRepoBindingResponse,
} from "../../../local-agent-api/generated/api";
import {
  CliReadErrorCode as LocalCliReadErrorCode,
  LocalRunAttachmentOpenAction,
  LocalRunAttachmentOpenErrorCode,
  LocalRunBrowserOpenErrorCode,
  LocalStagedBrowserTabOpenErrorCode,
} from "../../../local-agent-api/generated/api";

const DEFAULT_LOCAL_CLI_PORT = 3847;
const STAGING_LOCAL_CLI_PORT = 3849;

const configuredLocalCliPort = (): number | null => {
  const configuredPort = getLocalAgentPort();
  if (!configuredPort) return null;
  const port = Number.parseInt(configuredPort, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export class LocalCliRequestError extends Error {
  public constructor(
    message: string,
    public readonly code: CliReadErrorCode | null,
  ) {
    super(message);
    this.name = "LocalCliRequestError";
  }
}

const isCliReadErrorCode = (value: unknown): value is CliReadErrorCode =>
  typeof value === "string" &&
  Object.values(LocalCliReadErrorCode).some((code) => code === value);

const readRequestError = async (
  response: Response,
): Promise<LocalCliRequestError> => {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload)) {
      const nestedError = payload.error;
      if (isRecord(nestedError)) {
        const message = nestedError.message;
        const code = nestedError.code;
        if (typeof message === "string" && message.trim().length > 0) {
          return new LocalCliRequestError(
            message,
            isCliReadErrorCode(code) ? code : null,
          );
        }
      }
      for (const key of ["message", "error"]) {
        const value = payload[key];
        if (typeof value === "string" && value.trim().length > 0) {
          return new LocalCliRequestError(value, null);
        }
      }
    }
  } catch {
    // Fall through to the HTTP status when the runtime did not return JSON.
  }

  return new LocalCliRequestError(
    `Request failed with status ${String(response.status)}${
      response.statusText ? ` ${response.statusText}` : ""
    }`,
    null,
  );
};

const request = async <T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    // The local CLI's JSON routes are ETagged. Browser cache revalidation can
    // therefore produce a 304 response, which has no JSON body and is not
    // considered `ok` by fetch. The in-memory collection owns freshness for
    // these bindings, so always request the current response from the CLI.
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw await readRequestError(response);
  }

  return (await response.json()) as T;
};

const isServiceRepoBinding = (
  value: unknown,
): value is LocalServiceRepoBinding => {
  if (!isRecord(value)) return false;
  return (
    typeof value.serviceId === "string" &&
    typeof value.repositoryPath === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
};

const readRepoListResponse = (
  value: unknown,
): LocalListRepoBindingsResponse => {
  if (
    !isRecord(value) ||
    typeof value.machineId !== "string" ||
    value.machineId.trim().length === 0 ||
    !Array.isArray(value.bindings) ||
    !value.bindings.every(isServiceRepoBinding)
  ) {
    throw new Error(
      "The local CLI returned an invalid repository binding list.",
    );
  }
  return { machineId: value.machineId, bindings: value.bindings };
};

const readPickDirectoryResponse = (
  value: unknown,
): LocalPickRepoDirectoryResponse => {
  if (
    !isRecord(value) ||
    typeof value.machineId !== "string" ||
    value.machineId.trim().length === 0
  ) {
    throw new Error(
      "The local CLI returned an invalid directory picker result.",
    );
  }
  if (value.status === "cancelled") {
    return { status: "cancelled", machineId: value.machineId };
  }
  if (
    value.status === "selected" &&
    typeof value.repositoryPath === "string" &&
    value.repositoryPath.trim().length > 0
  ) {
    return {
      status: "selected",
      machineId: value.machineId,
      repositoryPath: value.repositoryPath,
    };
  }
  throw new Error("The local CLI returned an invalid directory picker result.");
};

const isChangedFileIdentity = (
  value: unknown,
): value is CliReadChangedFileIdentity =>
  isRecord(value) &&
  typeof value.serviceId === "string" &&
  typeof value.repoPath === "string" &&
  typeof value.filePath === "string";

const isChangedFileDetail = (
  value: unknown,
): value is CliReadChangedFileDetail => {
  if (!isRecord(value) || !isChangedFileIdentity(value)) return false;
  return (
    (value.status === "create" ||
      value.status === "modify" ||
      value.status === "delete") &&
    typeof value.diff === "string" &&
    (typeof value.preContent === "string" || value.preContent === null) &&
    (typeof value.postContent === "string" || value.postContent === null)
  );
};

const readChangedFileDetailResponse = (
  value: unknown,
  runId: string,
): CliReadRunChangedFileDetailSuccessResponseDto => {
  if (
    !isRecord(value) ||
    typeof value.requestId !== "string" ||
    value.requestId.trim().length === 0 ||
    value.operation !== "run.changed_files.detail" ||
    value.status !== "success" ||
    !isRecord(value.result) ||
    value.result.runId !== runId ||
    !isChangedFileDetail(value.result.file)
  ) {
    throw new Error("The local CLI returned invalid changed-file detail.");
  }
  return {
    requestId: value.requestId,
    operation: "run.changed_files.detail",
    status: "success",
    result: { runId, file: value.result.file },
  } satisfies CliReadRunChangedFileDetailSuccessResponseDto;
};

const isChangedFileInventoryEntry = (
  value: unknown,
): value is CliReadChangedFileInventoryEntry =>
  isChangedFileIdentity(value) &&
  value.serviceId.trim().length > 0 &&
  value.filePath.trim().length > 0 &&
  isRecord(value) &&
  (value.status === "create" ||
    value.status === "modify" ||
    value.status === "delete");

const readChangedFilesInventoryResponse = (
  value: unknown,
  runId: string,
): CliReadRunChangedFilesInventorySuccessResponseDto => {
  if (
    !isRecord(value) ||
    typeof value.requestId !== "string" ||
    value.requestId.trim().length === 0 ||
    value.operation !== "run.changed_files.inventory" ||
    value.status !== "success" ||
    !isRecord(value.result) ||
    value.result.runId !== runId ||
    !Array.isArray(value.result.entries) ||
    !value.result.entries.every(isChangedFileInventoryEntry)
  ) {
    throw new Error(
      "The local CLI returned an invalid changed-file inventory.",
    );
  }
  return {
    requestId: value.requestId,
    operation: "run.changed_files.inventory",
    status: "success",
    result: { runId, entries: value.result.entries },
  } satisfies CliReadRunChangedFilesInventorySuccessResponseDto;
};

/** A typed rejection from the loopback Open browser route. */
export class LocalRunBrowserOpenError extends Error {
  public constructor(
    message: string,
    public readonly code: LocalRunBrowserOpenErrorCode | null,
  ) {
    super(message);
    this.name = "LocalRunBrowserOpenError";
  }
}

const isRunBrowserOpenErrorCode = (
  value: unknown,
): value is LocalRunBrowserOpenErrorCode =>
  typeof value === "string" &&
  Object.values(LocalRunBrowserOpenErrorCode).some((code) => code === value);

/** The message and raw code of a loopback Open browser rejection. */
const readBrowserOpenFailure = async (
  response: Response,
): Promise<{ message: string; code: unknown }> => {
  try {
    const payload: unknown = await response.json();
    if (
      isRecord(payload) &&
      typeof payload.message === "string" &&
      payload.message.trim().length > 0
    ) {
      return { message: payload.message, code: payload.code };
    }
  } catch {
    // Fall through to the HTTP status when the runtime did not return JSON.
  }
  return {
    message: `Request failed with status ${String(response.status)}`,
    code: null,
  };
};

const readRunBrowserOpenError = async (
  response: Response,
): Promise<LocalRunBrowserOpenError> => {
  const { message, code } = await readBrowserOpenFailure(response);
  return new LocalRunBrowserOpenError(
    message,
    isRunBrowserOpenErrorCode(code) ? code : null,
  );
};

/** A typed rejection from the loopback Open browser route used before a Run exists. */
export class LocalStagedBrowserTabOpenError extends Error {
  public constructor(
    message: string,
    public readonly code: LocalStagedBrowserTabOpenErrorCode | null,
  ) {
    super(message);
    this.name = "LocalStagedBrowserTabOpenError";
  }
}

const isStagedBrowserTabOpenErrorCode = (
  value: unknown,
): value is LocalStagedBrowserTabOpenErrorCode =>
  typeof value === "string" &&
  Object.values(LocalStagedBrowserTabOpenErrorCode).some(
    (code) => code === value,
  );

const readStagedBrowserTabOpenError = async (
  response: Response,
): Promise<LocalStagedBrowserTabOpenError> => {
  const { message, code } = await readBrowserOpenFailure(response);
  return new LocalStagedBrowserTabOpenError(
    message,
    isStagedBrowserTabOpenErrorCode(code) ? code : null,
  );
};

const readPort = (value: string | null): number | null => {
  if (!value) return null;
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
};

export class LocalRunAttachmentUploadError extends Error {
  constructor(
    message: string,
    public readonly code: CliReadErrorCode | null,
  ) {
    super(message);
    this.name = "LocalRunAttachmentUploadError";
  }
}

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const isRunAttachment = (value: unknown): value is LocalRunAttachment =>
  isRecord(value) &&
  isUuid(value.attachmentId) &&
  typeof value.fileName === "string" &&
  value.fileName.trim().length > 0 &&
  typeof value.sizeBytes === "number" &&
  Number.isInteger(value.sizeBytes) &&
  value.sizeBytes >= 0 &&
  value.sizeBytes <= 26214400;

/** A typed rejection from the loopback open-attachment route. */
export class LocalRunAttachmentOpenError extends Error {
  public constructor(
    message: string,
    public readonly code: LocalRunAttachmentOpenErrorCode | null,
  ) {
    super(message);
    this.name = "LocalRunAttachmentOpenError";
  }
}

const isRunAttachmentOpenErrorCode = (
  value: unknown,
): value is LocalRunAttachmentOpenErrorCode =>
  typeof value === "string" &&
  Object.values(LocalRunAttachmentOpenErrorCode).some((code) => code === value);

const readAttachmentOpenResponse = (
  value: unknown,
  ok: boolean,
  runId: string,
  attachmentId: string,
  status: number,
): LocalRunAttachmentOpenSuccessResponse => {
  if (
    isRecord(value) &&
    value.operation === "run.attachments.open" &&
    value.status === "error" &&
    isRecord(value.error) &&
    typeof value.error.message === "string"
  ) {
    throw new LocalRunAttachmentOpenError(
      value.error.message,
      isRunAttachmentOpenErrorCode(value.error.code) ? value.error.code : null,
    );
  }
  if (
    !ok ||
    !isRecord(value) ||
    !isUuid(value.requestId) ||
    value.operation !== "run.attachments.open" ||
    value.status !== "success" ||
    !isRecord(value.result) ||
    value.result.runId !== runId ||
    value.result.attachmentId !== attachmentId ||
    (value.result.action !== LocalRunAttachmentOpenAction.Opened &&
      value.result.action !== LocalRunAttachmentOpenAction.Revealed)
  ) {
    throw new LocalRunAttachmentOpenError(
      `Attachment open failed with status ${String(status)}.`,
      null,
    );
  }
  return {
    requestId: value.requestId,
    operation: "run.attachments.open",
    status: "success",
    result: { runId, attachmentId, action: value.result.action },
  };
};

const readAttachmentResponse = (
  value: unknown,
  runId: string,
): LocalRunAttachmentSuccessResponse => {
  if (
    !isRecord(value) ||
    !isUuid(value.requestId) ||
    value.operation !== "run.attachments.upload"
  ) {
    throw new LocalRunAttachmentUploadError(
      "The local CLI returned an invalid attachment response.",
      null,
    );
  }
  if (
    value.status === "error" &&
    isRecord(value.error) &&
    isCliReadErrorCode(value.error.code) &&
    typeof value.error.message === "string"
  ) {
    throw new LocalRunAttachmentUploadError(
      value.error.message,
      value.error.code,
    );
  }
  if (
    value.status !== "success" ||
    !isRecord(value.result) ||
    value.result.runId !== runId ||
    !isRunAttachment(value.result.attachment)
  ) {
    throw new LocalRunAttachmentUploadError(
      "The local CLI returned an invalid attachment result.",
      null,
    );
  }
  return {
    requestId: value.requestId,
    operation: "run.attachments.upload",
    status: "success",
    result: { runId, attachment: value.result.attachment },
  };
};

const readStagedAttachmentResponse = (
  value: unknown,
): LocalStagedRunAttachmentSuccessResponse => {
  if (
    !isRecord(value) ||
    !isUuid(value.requestId) ||
    value.operation !== "run.attachments.stage"
  )
    throw new LocalRunAttachmentUploadError(
      "The local CLI returned an invalid attachment response.",
      null,
    );
  if (
    value.status === "error" &&
    isRecord(value.error) &&
    isCliReadErrorCode(value.error.code) &&
    typeof value.error.message === "string"
  )
    throw new LocalRunAttachmentUploadError(
      value.error.message,
      value.error.code,
    );
  if (
    value.status !== "success" ||
    !isRecord(value.result) ||
    !isRunAttachment(value.result.attachment)
  )
    throw new LocalRunAttachmentUploadError(
      "The local CLI returned an invalid attachment result.",
      null,
    );
  return {
    requestId: value.requestId,
    operation: "run.attachments.stage",
    status: "success",
    result: { attachment: value.result.attachment },
  };
};

/**
 * Resolve the CLI that is reachable from this browser. The optional `server`
 * query parameter is retained for local development and tests; no paired
 * machine's remote binding data is used as a fallback for this runtime.
 */
export const resolveLocalDirectoryRuntimeBaseUrl = (): string => {
  const configuredPort = configuredLocalCliPort();
  if (typeof window === "undefined") {
    return `http://localhost:${String(
      configuredPort ?? DEFAULT_LOCAL_CLI_PORT,
    )}`;
  }

  const port = readPort(
    new URLSearchParams(window.location.search).get("server"),
  );
  // Match the CLI's --staging bridge; production and staging can run together.
  const defaultPort =
    window.location.hostname === "staging.heyhey.dev"
      ? STAGING_LOCAL_CLI_PORT
      : DEFAULT_LOCAL_CLI_PORT;
  return `http://localhost:${String(port ?? configuredPort ?? defaultPort)}`;
};

export interface DirectoryBindingApi {
  baseUrl: string;
  uploadLocalStagedRunAttachment(
    machineId: string,
    file: File,
  ): Promise<LocalStagedRunAttachmentSuccessResponse>;
  uploadLocalRunAttachment(
    runId: string,
    machineId: string,
    file: File,
  ): Promise<LocalRunAttachmentSuccessResponse>;
  openRunAttachment(
    runId: string,
    attachmentId: string,
    machineId: string,
    fileName: string,
  ): Promise<LocalRunAttachmentOpenSuccessResponse>;
  listRepos(): Promise<LocalListRepoBindingsResponse>;
  pickDirectory(machineId: string): Promise<LocalPickRepoDirectoryResponse>;
  setRepo(
    serviceId: string,
    machineId: string,
    repositoryPath: string,
  ): Promise<ServiceRepoBinding>;
  readRunChangedFileDetail(
    runId: string,
    machineId: string,
    file: CliReadChangedFileIdentity,
  ): Promise<CliReadRunChangedFileDetailSuccessResponseDto>;
  readRunChangedFilesInventory(
    runId: string,
    machineId: string,
  ): Promise<CliReadRunChangedFilesInventorySuccessResponseDto>;
  openRunBrowserTab(
    runId: string,
    body: LocalRunBrowserOpenRequest,
  ): Promise<LocalRunBrowserOpenSuccessResponse>;
  openStagedBrowserTab(
    body: LocalStagedBrowserTabOpenRequest,
  ): Promise<LocalStagedBrowserTabOpenSuccessResponse>;
}

export const createDirectoryBindingApi = (
  baseUrl: string,
): DirectoryBindingApi => ({
  baseUrl,

  async uploadLocalStagedRunAttachment(machineId, file) {
    const query = new URLSearchParams({ machineId, fileName: file.name });
    const response = await fetch(
      `${baseUrl}/api/local/run-attachments/staging?${query}`,
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      },
    );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LocalRunAttachmentUploadError(
        `Attachment upload failed with status ${response.status}.`,
        null,
      );
    }
    const result = readStagedAttachmentResponse(payload);
    if (!response.ok)
      throw new LocalRunAttachmentUploadError(
        `Attachment upload failed with status ${response.status}.`,
        null,
      );
    return result;
  },

  async uploadLocalRunAttachment(runId, machineId, file) {
    const query = new URLSearchParams({ machineId, fileName: file.name });
    const response = await fetch(
      `${baseUrl}/api/local/runs/${encodeURIComponent(
        runId,
      )}/attachments?${query}`,
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      },
    );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LocalRunAttachmentUploadError(
        `Attachment upload failed with status ${response.status}.`,
        null,
      );
    }
    const result = readAttachmentResponse(payload, runId);
    if (!response.ok)
      throw new LocalRunAttachmentUploadError(
        `Attachment upload failed with status ${response.status}.`,
        null,
      );
    return result;
  },

  async openRunAttachment(runId, attachmentId, machineId, fileName) {
    const query = new URLSearchParams({ machineId, fileName });
    const response = await fetch(
      `${baseUrl}/api/local/runs/${encodeURIComponent(
        runId,
      )}/attachments/${encodeURIComponent(attachmentId)}/open?${query}`,
      { method: "POST", cache: "no-store" },
    );
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // A non-JSON reply is reported by its status below.
    }
    return readAttachmentOpenResponse(
      payload,
      response.ok,
      runId,
      attachmentId,
      response.status,
    );
  },

  async listRepos(): Promise<LocalListRepoBindingsResponse> {
    const payload = await request<unknown>(baseUrl, "/api/local/repos");
    return readRepoListResponse(payload);
  },

  async pickDirectory(
    machineId: string,
  ): Promise<LocalPickRepoDirectoryResponse> {
    const payload = await request<unknown>(
      baseUrl,
      "/api/local/repos/pick-directory",
      { method: "POST", body: JSON.stringify({ machineId }) },
    );
    return readPickDirectoryResponse(payload);
  },

  async setRepo(
    serviceId: string,
    machineId: string,
    repositoryPath: string,
  ): Promise<ServiceRepoBinding> {
    const payload = await request<LocalSetRepoBindingResponse>(
      baseUrl,
      `/api/local/repos/${encodeURIComponent(serviceId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ machineId, repositoryPath }),
      },
    );
    if (
      typeof payload.machineId !== "string" ||
      payload.machineId !== machineId ||
      !isServiceRepoBinding(payload.binding)
    ) {
      throw new Error("The local CLI returned an invalid repository binding.");
    }
    return payload.binding;
  },

  async readRunChangedFileDetail(
    runId: string,
    machineId: string,
    file: CliReadChangedFileIdentity,
  ): Promise<CliReadRunChangedFileDetailSuccessResponseDto> {
    const payload = await request<unknown>(
      baseUrl,
      `/api/local/runs/${encodeURIComponent(runId)}/changed-files/detail`,
      {
        method: "POST",
        body: JSON.stringify({ machineId, file }),
      },
    );
    return readChangedFileDetailResponse(payload, runId);
  },

  async readRunChangedFilesInventory(
    runId: string,
    machineId: string,
  ): Promise<CliReadRunChangedFilesInventorySuccessResponseDto> {
    const payload = await request<unknown>(
      baseUrl,
      `/api/local/runs/${encodeURIComponent(runId)}/changed-files/inventory`,
      {
        method: "POST",
        body: JSON.stringify({ machineId }),
      },
    );
    return readChangedFilesInventoryResponse(payload, runId);
  },

  async openRunBrowserTab(
    runId: string,
    body: LocalRunBrowserOpenRequest,
  ): Promise<LocalRunBrowserOpenSuccessResponse> {
    const response = await fetch(
      `${baseUrl}/api/local/runs/${encodeURIComponent(runId)}/browser/open`,
      {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) throw await readRunBrowserOpenError(response);
    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      payload.runId !== runId ||
      typeof payload.url !== "string"
    ) {
      throw new Error("The local CLI returned an invalid Open browser result.");
    }
    return { runId, url: payload.url };
  },

  async openStagedBrowserTab(
    body: LocalStagedBrowserTabOpenRequest,
  ): Promise<LocalStagedBrowserTabOpenSuccessResponse> {
    const response = await fetch(`${baseUrl}/api/local/browser/staged-tabs`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await readStagedBrowserTabOpenError(response);
    const payload: unknown = await response.json();
    if (
      !isRecord(payload) ||
      !isRecord(payload.stagedBrowserTab) ||
      typeof payload.stagedBrowserTab.stagedTabId !== "string" ||
      typeof payload.url !== "string"
    ) {
      throw new Error("The local CLI returned an invalid Open browser result.");
    }
    return {
      stagedBrowserTab: { stagedTabId: payload.stagedBrowserTab.stagedTabId },
      url: payload.url,
    };
  },
});

// Compatibility names for callers that still refer to the local CLI boundary
// as the agent runtime API.
export const createLocalAgentApi = createDirectoryBindingApi;
export const resolveLocalRuntimeBaseUrl = resolveLocalDirectoryRuntimeBaseUrl;

/** Revalidate against the target Run, never the machine's host-checkout mapping. */
export async function resolveWalkthroughSource(
  baseUrl: string,
  runId: string,
  machineId: string,
  excerpt: import("../../../api").ChangeWalkthroughExcerpt,
): Promise<
  import("../../../local-agent-api/generated/api").LocalWalkthroughSourceLocation
> {
  const body = {
    machineId,
    excerpt,
  } satisfies import("../../../local-agent-api/generated/api").LocalWalkthroughSourceRequest;
  const response = await fetch(
    baseUrl +
      "/api/local/runs/" +
      encodeURIComponent(runId) +
      "/walkthrough/source",
    {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) throw new Error("Current source unavailable");
  const value: unknown = await response.json();
  if (
    !isRecord(value) ||
    value.runId !== runId ||
    value.serviceId !== excerpt.serviceId ||
    value.file !== excerpt.file ||
    typeof value.path !== "string" ||
    !value.path.startsWith("/") ||
    value.line !== excerpt.startLine ||
    value.column !== 1
  )
    throw new Error("Invalid source location");
  return {
    runId,
    serviceId: excerpt.serviceId,
    file: excerpt.file,
    path: value.path,
    line: excerpt.startLine,
    column: 1,
  };
}

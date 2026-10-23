import {
  CliReadErrorCode,
  type CliReadResponseDto,
} from '../shared/agent-bridge-contract/generated/api';

/**
 * The platform gateway currently uses Engine.IO's default 1,000,000-byte
 * inbound message limit. Leave room for Socket.IO/Engine.IO framing and
 * acknowledgement metadata so the complete client acknowledgement remains
 * below that limit on every transport.
 */
export const MAX_CLI_READ_ACK_BYTES = 900_000;

const RESULT_TOO_LARGE_MESSAGE =
  'The CLI read response exceeds the WebSocket acknowledgement size limit.';

const toResultTooLargeResponse = (response: CliReadResponseDto): CliReadResponseDto => {
  return {
    requestId: response.requestId,
    operation: response.operation,
    status: 'error',
    error: { code: CliReadErrorCode.ResultTooLarge, message: RESULT_TOO_LARGE_MESSAGE },
  };
};

export interface GuardedCliReadResponse {
  response: CliReadResponseDto;
  serializedBytes: number;
  replaced: boolean;
}

export const guardCliReadResponse = (response: CliReadResponseDto): GuardedCliReadResponse => {
  const serialized = JSON.stringify(response);
  const serializedBytes = Buffer.byteLength(serialized, 'utf8');
  if (serializedBytes <= MAX_CLI_READ_ACK_BYTES) {
    return { response, serializedBytes, replaced: false };
  }

  return {
    response: toResultTooLargeResponse(response),
    serializedBytes,
    replaced: true,
  };
};

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { ProposalApprovalFailureErrorResponse } from 'src/generated';
import { toProposalApprovalFailureDiagnostic } from 'src/services/proposal/proposal-approval-failure-diagnostic';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    const exceptionResponse = exception.getResponse();

    let message: string;
    let code: string | undefined;
    let data: unknown = null;
    let retryAfterSeconds: number | undefined;
    let diagnostic:
      | ProposalApprovalFailureErrorResponse['diagnostic']
      | undefined;
    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const payload = exceptionResponse as Record<string, unknown>;
      const rawMessage = payload.message;
      message = Array.isArray(rawMessage)
        ? rawMessage.join(', ')
        : (rawMessage as string);
      if (Array.isArray(payload.errors)) {
        const details = payload.errors
          .map((error) => {
            if (typeof error !== 'object' || error === null) return null;
            const entry = error as Record<string, unknown>;
            const field =
              typeof entry.field === 'string' ? entry.field : undefined;
            const code =
              typeof entry.code === 'string' ? entry.code : undefined;
            const reason =
              typeof entry.reason === 'string' ? entry.reason : undefined;
            const detail = [field, code].filter(Boolean).join(' ');
            return detail && reason ? `${detail}: ${reason}` : detail || reason;
          })
          .filter((detail): detail is string => detail !== null);
        if (details.length > 0) {
          message = `${message}: ${details.join('; ')}`;
        }
      }
      if (typeof payload.code === 'string') {
        code = payload.code;
      }
      if (payload.data !== undefined) {
        data = payload.data;
      }
      if (typeof payload.retryAfterSeconds === 'number') {
        retryAfterSeconds = payload.retryAfterSeconds;
      }
      if (
        payload.diagnostic !== undefined ||
        payload.projection !== undefined
      ) {
        diagnostic = toProposalApprovalFailureDiagnostic(
          exception,
          request.header('x-correlation-id') ??
            request.header('x-request-id') ??
            uuidv4(),
        );
      }
    } else {
      message = exception.message;
    }

    if (diagnostic) {
      const body = {
        success: false,
        message,
        diagnostic,
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
      } satisfies ProposalApprovalFailureErrorResponse;
      response.status(status).json(body);
      return;
    }

    const body: Record<string, unknown> = {
      success: false,
      message,
      data,
      timestamp: new Date().toISOString(),
      statusCode: status,
      path: request.url,
    };

    if (code !== undefined) {
      body.code = code;
    }
    if (retryAfterSeconds !== undefined) {
      body.retryAfterSeconds = retryAfterSeconds;
    }

    response.status(status).json(body);
  }
}

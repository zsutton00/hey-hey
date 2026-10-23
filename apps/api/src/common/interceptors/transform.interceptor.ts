import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../interfaces/api-response.interface';
import { Reflector } from '@nestjs/core';
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator';

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return next.handle() as unknown as Observable<ApiResponse<T>>;
    }

    return next.handle().pipe(
      map((data) => {
        return {
          success: true,
          message: 'Request processed successfully',
          data,
          timestamp: new Date().toISOString(),
          statusCode: response.statusCode,
          path: request.url,
        };
      }),
    );
  }
}

# NestJS Standard Response Format

This directory contains the implementation of a standard response format for all API endpoints in the application.

## Response Structure

All API responses follow this standard format:

```json
{
  "success": true|false,
  "message": "Human-readable message about the operation",
  "data": { /* Response data object (if applicable) */ },
  "timestamp": "2023-12-01T12:00:00.000Z",
  "statusCode": 200,
  "path": "/api/v1/resource"
}
```

## Error Response Structure

Error responses follow the same format with `success: false` and may include additional error details:

```json
{
  "success": false,
  "message": "Error message",
  "data": null,
  "timestamp": "2023-12-01T12:00:00.000Z",
  "statusCode": 400,
  "path": "/api/v1/resource",
  "error": {
    "code": "ERROR_CODE",
    "details": {
      /* Additional error details */
    }
  }
}
```

## Implementation Components

- **ApiResponse Interface**: Defines the standard response structure
- **TransformInterceptor**: Transforms all successful responses to the standard format
- **HttpExceptionFilter**: Transforms all HTTP exceptions to the standard format
- **PrismaExceptionFilter**: Transforms Prisma-specific exceptions to the standard format

## Usage

The response format is applied globally in `main.ts` using interceptors and filters. Controllers don't need to do anything special to use this format - all responses are automatically transformed.

Example controller method:

```typescript
@Get()
findAll(): Promise<YourDto[]> {
  // Just return your data - the interceptor will format it
  return this.yourService.findAll();
}
```

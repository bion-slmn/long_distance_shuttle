// all-exceptions.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MetricsService } from 'src/metrics/metrics.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly metrics: MetricsService) { }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : 500;

    const rawResponse = isHttpException ? exception.getResponse() : null;

    // Normalize to a flat, predictable shape regardless of whether the
    // exception was thrown as `new ConflictException('string')` (→ object
    // with .message) or `new ConflictException()` (→ just a string), or
    // ValidationPipe (→ message is a string[] array).
    const { message, error } = this.normalizeMessage(rawResponse, exception);

    if (isHttpException) {
      this.logger.warn(
        `${request.method} ${request.url} -> ${status} : ${JSON.stringify(rawResponse)}`,
      );
    } else {
      this.logger.error(
        `${request.method} ${request.url} -> Unhandled exception`,
        (exception as Error)?.stack,
      );
    }

    this.metrics.incrementFailedRequest().catch(() => {
      // swallow — a Redis hiccup shouldn't cascade into breaking error responses
    });

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      message, // always string | string[] now, never a nested object
      error,   // e.g. "Conflict", "Bad Request" — pulled out separately
    });
  }

  private normalizeMessage(
    rawResponse: unknown,
    exception: unknown,
  ): { message: string | string[]; error?: string } {
    // Nest's built-in HttpExceptions (ConflictException, BadRequestException,
    // etc.) return an object shape when thrown with a string arg:
    // { statusCode, message, error }
    if (rawResponse && typeof rawResponse === 'object') {
      const obj = rawResponse as Record<string, unknown>;
      return {
        message: (obj.message as string | string[]) ?? 'An error occurred',
        error: obj.error as string | undefined,
      };
    }

    // Thrown with no message arg, or getResponse() returned a plain string
    if (typeof rawResponse === 'string') {
      return { message: rawResponse };
    }

    // Non-HttpException (unhandled 500s)
    return { message: 'Internal server error' };
  }
}
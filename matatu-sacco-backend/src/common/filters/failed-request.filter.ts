// src/common/filters/failed-request.filter.ts
import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MetricsService } from '../../metrics/metrics.service';

@Catch()
export class FailedRequestFilter implements ExceptionFilter {
    constructor(private readonly metrics: MetricsService) { }

    async catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        const status =
            exception instanceof HttpException
                ? exception.getStatus()
                : HttpStatus.INTERNAL_SERVER_ERROR;

        const message =
            exception instanceof HttpException
                ? exception.getResponse()
                : 'Internal server error';

        // Fire-and-forget — never let a Redis hiccup block the actual error
        // response from reaching the client.
        this.metrics.incrementFailedRequest().catch(() => {
            // swallow — metrics failing shouldn't cascade into the request failing
        });

        response.status(status).json({
            statusCode: status,
            path: request.url,
            timestamp: new Date().toISOString(),
            message,
        });
    }
}
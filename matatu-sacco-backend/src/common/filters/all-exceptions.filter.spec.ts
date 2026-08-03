// all-exceptions.filter.spec.ts
import { AllExceptionsFilter } from './all-exceptions.filter';
import {
    ArgumentsHost,
    BadRequestException,
    ConflictException,
    Logger,
} from '@nestjs/common';
import { MetricsService } from 'src/metrics/metrics.service';

describe('AllExceptionsFilter', () => {
    let filter: AllExceptionsFilter;
    let metrics: jest.Mocked<MetricsService>;
    let mockResponse: { status: jest.Mock; json: jest.Mock };
    let mockRequest: { method: string; url: string };
    let mockHost: ArgumentsHost;

    beforeEach(() => {
        metrics = {
            incrementFailedRequest: jest.fn().mockResolvedValue(undefined),
        } as any;

        filter = new AllExceptionsFilter(metrics);

        // Silence logger noise in test output
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

        mockResponse = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
        mockRequest = { method: 'POST', url: '/routes' };

        mockHost = {
            switchToHttp: () => ({
                getRequest: () => mockRequest,
                getResponse: () => mockResponse,
            }),
        } as unknown as ArgumentsHost;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('handles a ConflictException with object response shape', () => {
        const exception = new ConflictException('Duplicate route');

        filter.catch(exception, mockHost);

        expect(mockResponse.status).toHaveBeenCalledWith(409);
        expect(mockResponse.json).toHaveBeenCalledWith(
            expect.objectContaining({
                statusCode: 409,
                path: '/routes',
                message: 'Duplicate route',
                error: 'Conflict',
            }),
        );
    });

    it('handles ValidationPipe-style array messages', () => {
        const exception = new BadRequestException({
            statusCode: 400,
            message: ['origin should not be empty', 'fare must be a number'],
            error: 'Bad Request',
        });

        filter.catch(exception, mockHost);

        expect(mockResponse.status).toHaveBeenCalledWith(400);
        expect(mockResponse.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: ['origin should not be empty', 'fare must be a number'],
                error: 'Bad Request',
            }),
        );
    });

    it('handles an exception thrown with no message (bare HttpException)', () => {
        const exception = new ConflictException();

        filter.catch(exception, mockHost);

        // Nest's default ConflictException() still returns an object with a message,
        // but we guard the fallback path regardless
        expect(mockResponse.status).toHaveBeenCalledWith(409);
        expect(mockResponse.json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.anything(),
            }),
        );
    });

    it('defaults to 500 and generic message for a non-HttpException error', () => {
        const exception = new Error('Unexpected DB failure');

        filter.catch(exception, mockHost);

        expect(mockResponse.status).toHaveBeenCalledWith(500);
        expect(mockResponse.json).toHaveBeenCalledWith(
            expect.objectContaining({
                statusCode: 500,
                message: 'Internal server error',
            }),
        );
        expect(mockResponse.json).not.toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.anything() }),
        );
    });

    it('logs unhandled exceptions as errors with stack trace, HttpExceptions as warnings', () => {
        const warnSpy = jest.spyOn(Logger.prototype, 'warn');
        const errorSpy = jest.spyOn(Logger.prototype, 'error');

        filter.catch(new ConflictException('Duplicate route'), mockHost);
        expect(warnSpy).toHaveBeenCalled();
        expect(errorSpy).not.toHaveBeenCalled();

        warnSpy.mockClear();
        errorSpy.mockClear();

        filter.catch(new Error('boom'), mockHost);
        expect(errorSpy).toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('calls metrics.incrementFailedRequest on every exception', () => {
        filter.catch(new Error('boom'), mockHost);
        expect(metrics.incrementFailedRequest).toHaveBeenCalledTimes(1);
    });

    it('does not throw or block the response if metrics call rejects', () => {
        metrics.incrementFailedRequest.mockRejectedValueOnce(
            new Error('Redis unavailable'),
        );

        expect(() => filter.catch(new Error('boom'), mockHost)).not.toThrow();
        expect(mockResponse.status).toHaveBeenCalledWith(500);
    });

    it('includes path and an ISO timestamp in the response body', () => {
        filter.catch(new Error('boom'), mockHost);

        const body = mockResponse.json.mock.calls[0][0];
        expect(body.path).toBe('/routes');
        expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
    });
});
// route-analytics.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RouteAnalyticsService } from './route-analytics.service';
import { Route } from './entities/route.entity';

describe('RouteAnalyticsService', () => {
    let service: RouteAnalyticsService;
    let qb: any;

    beforeEach(async () => {
        qb = {
            select: jest.fn().mockReturnThis(),
            addSelect: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            innerJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            getRawMany: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RouteAnalyticsService,
                {
                    provide: getRepositoryToken(Route),
                    useValue: {
                        manager: { createQueryBuilder: jest.fn().mockReturnValue(qb) },
                    },
                },
            ],
        }).compile();

        service = module.get(RouteAnalyticsService);
    });

    afterEach(() => jest.clearAllMocks());

    // ── getAverageFillTimeComparison ────────────────────────────────────────

    describe('getAverageFillTimeComparison', () => {
        it('returns zeroed averages and null changePercent when there is no data at all', async () => {
            qb.getRawMany.mockResolvedValue([]);

            const result = await service.getAverageFillTimeComparison();

            expect(result).toEqual({
                today: 0,
                yesterday: 0,
                changeMinutes: 0,
                changePercent: null,
            });
        });

        it('computes averages, changeMinutes, and changePercent correctly', async () => {
            qb.getRawMany
                .mockResolvedValueOnce([
                    { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '20' },
                    { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '30' },
                ]) // today: avg 25
                .mockResolvedValueOnce([
                    { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '10' },
                    { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '10' },
                ]); // yesterday: avg 10

            const result = await service.getAverageFillTimeComparison();

            expect(result.today).toBe(25);
            expect(result.yesterday).toBe(10);
            expect(result.changeMinutes).toBe(15);
            expect(result.changePercent).toBe(150);
        });

        it('returns null changePercent when yesterday average is 0 but today has data', async () => {
            qb.getRawMany
                .mockResolvedValueOnce([
                    { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '20' },
                ])
                .mockResolvedValueOnce([]);

            const result = await service.getAverageFillTimeComparison();

            expect(result.yesterday).toBe(0);
            expect(result.changePercent).toBeNull();
        });

        it('applies the saccoId filter when provided', async () => {
            qb.getRawMany.mockResolvedValue([]);

            await service.getAverageFillTimeComparison('sacco-1');

            expect(qb.andWhere).toHaveBeenCalledWith('route."saccoId" = :saccoId', {
                saccoId: 'sacco-1',
            });
        });

        it('does not apply a saccoId filter when omitted (platform-wide)', async () => {
            qb.getRawMany.mockResolvedValue([]);

            await service.getAverageFillTimeComparison();

            expect(qb.andWhere).not.toHaveBeenCalledWith(
                expect.stringContaining('saccoId'),
                expect.anything(),
            );
        });
    });

    // ── getFastestRoutesToday ───────────────────────────────────────────────

    describe('getFastestRoutesToday', () => {
        it('returns routes sorted ascending by average fill time', async () => {
            qb.getRawMany.mockResolvedValue([
                { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '30' },
                { routeId: 'r2', origin: 'NAIROBI', destination: 'KISUMU', fillMinutes: '10' },
                { routeId: 'r2', origin: 'NAIROBI', destination: 'KISUMU', fillMinutes: '20' },
            ]);

            const result = await service.getFastestRoutesToday();

            expect(result[0].routeId).toBe('r2'); // avg 15, faster
            expect(result[0].today).toBe(15);
            expect(result[0].vehicles).toBe(2);
            expect(result[1].routeId).toBe('r1');
            expect(result[1].vehicles).toBe(1);
        });

        it('formats the route label as "origin → destination"', async () => {
            qb.getRawMany.mockResolvedValue([
                { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '15' },
            ]);

            const result = await service.getFastestRoutesToday();

            expect(result[0].route).toBe('NAIROBI → MOMBASA');
        });

        it('returns an empty array when no trips completed today', async () => {
            qb.getRawMany.mockResolvedValue([]);
            const result = await service.getFastestRoutesToday();
            expect(result).toEqual([]);
        });
    });

    // ── getRoutePerformanceVsYesterday ──────────────────────────────────────

    describe('getRoutePerformanceVsYesterday', () => {
        it('includes a route present only in yesterday data with today defaulted to 0', async () => {
            qb.getRawMany
                .mockResolvedValueOnce([]) // today
                .mockResolvedValueOnce([
                    { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '20' },
                ]); // yesterday

            const result = await service.getRoutePerformanceVsYesterday();

            expect(result).toHaveLength(1);
            expect(result[0].today).toBe(0);
            expect(result[0].dayAvg).toBe(20);
            expect(result[0].vehicles).toBe(0);
        });

        it('includes a route present only in today data with dayAvg defaulted to 0', async () => {
            qb.getRawMany
                .mockResolvedValueOnce([
                    { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '20' },
                ])
                .mockResolvedValueOnce([]);

            const result = await service.getRoutePerformanceVsYesterday();

            expect(result[0].today).toBe(20);
            expect(result[0].dayAvg).toBe(0);
            expect(result[0].vehicles).toBe(1);
        });

        it('unions routes present in both days without duplication', async () => {
            qb.getRawMany
                .mockResolvedValueOnce([
                    { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '20' },
                ])
                .mockResolvedValueOnce([
                    { routeId: 'r1', origin: 'NAIROBI', destination: 'MOMBASA', fillMinutes: '30' },
                ]);

            const result = await service.getRoutePerformanceVsYesterday();

            expect(result).toHaveLength(1);
            expect(result[0].today).toBe(20);
            expect(result[0].dayAvg).toBe(30);
        });

        it('returns an empty array when neither day has data', async () => {
            qb.getRawMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
            const result = await service.getRoutePerformanceVsYesterday();
            expect(result).toEqual([]);
        });
    });
});
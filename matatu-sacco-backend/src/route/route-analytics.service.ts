// src/route/route-analytics.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Route } from './entities/route.entity';

// ─── Service ──────────────────────────────────────────────────────────────────
// Fill-time reporting only — no writes, no locking. Reads raw trip/route
// data via the manager rather than the repository API since these are
// aggregate queries, not entity CRUD.

@Injectable()
export class RouteAnalyticsService {
    constructor(
        @InjectRepository(Route)
        private readonly routeRepository: Repository<Route>,
    ) { }

    // "date" column is a plain YYYY-MM-DD string — this is what makes
    // "one queue per route per day" a meaningful, queryable business key.
    private toDateString(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    // ── Fill Time Analytics ───────────────────────────────────────────────────
    // "Fill time" = minutes between a vehicle entering BOARDING (trip created)
    // and actually departing (trip.departureTimet set via markDeparted). Trips
    // still boarding (departureTimet IS NULL) are excluded — only completed
    // fill cycles count toward the average.
    //
    // ASSUMPTION: trips table has columns routeId, createdAt, departureTimet,
    // travelDate. Adjust column names below if your Trip entity differs.

    private async getRouteFillStats(
        manager: EntityManager,
        date: string,
        saccoId?: string,
    ): Promise<Map<string, { origin: string; destination: string; times: number[] }>> {
        const qb = manager
            .createQueryBuilder()
            .select('trip."routeId"', 'routeId')
            .addSelect('route.origin', 'origin')
            .addSelect('route.destination', 'destination')
            .addSelect(
                'EXTRACT(EPOCH FROM (trip."departureTime" - trip."createdAt")) / 60',
                'fillMinutes',
            )
            .from('trips', 'trip')
            .innerJoin('routes', 'route', 'route.id = trip."routeId"')
            .where('trip."travelDate" = :date', { date })
            .andWhere('trip."departureTime" IS NOT NULL');

        if (saccoId) {
            qb.andWhere('route."saccoId" = :saccoId', { saccoId });
        }

        const rows = await qb.getRawMany<{
            routeId: string;
            origin: string;
            destination: string;
            fillMinutes: string;
        }>();

        const byRoute = new Map<string, { origin: string; destination: string; times: number[] }>();
        for (const row of rows) {
            const entry = byRoute.get(row.routeId) ?? {
                origin: row.origin,
                destination: row.destination,
                times: [],
            };
            entry.times.push(Number(row.fillMinutes));
            byRoute.set(row.routeId, entry);
        }
        return byRoute;
    }

    private average(nums: number[]): number {
        if (nums.length === 0) return 0;
        return nums.reduce((sum, n) => sum + n, 0) / nums.length;
    }

    // ── 1. Average fill time today vs yesterday (platform or single sacco) ───
    async getAverageFillTimeComparison(
        saccoId?: string,
    ): Promise<{ today: number; yesterday: number; changeMinutes: number; changePercent: number | null }> {
        const today = this.toDateString(new Date());
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = this.toDateString(yesterdayDate);

        const manager = this.routeRepository.manager;

        const [todayStats, yesterdayStats] = await Promise.all([
            this.getRouteFillStats(manager, today, saccoId),
            this.getRouteFillStats(manager, yesterday, saccoId),
        ]);

        const allTodayTimes = [...todayStats.values()].flatMap((r) => r.times);
        const allYesterdayTimes = [...yesterdayStats.values()].flatMap((r) => r.times);

        const todayAvg = this.average(allTodayTimes);
        const yesterdayAvg = this.average(allYesterdayTimes);
        const changeMinutes = todayAvg - yesterdayAvg;
        const changePercent = yesterdayAvg > 0 ? (changeMinutes / yesterdayAvg) * 100 : null;

        return { today: todayAvg, yesterday: yesterdayAvg, changeMinutes, changePercent };
    }

    // ── 2. Fastest routes today, sorted ascending by average fill time ───────
    async getFastestRoutesToday(
        saccoId?: string,
    ): Promise<{ routeId: string; route: string; today: number; vehicles: number }[]> {
        const today = this.toDateString(new Date());
        const manager = this.routeRepository.manager;
        const stats = await this.getRouteFillStats(manager, today, saccoId);

        return [...stats.entries()]
            .map(([routeId, { origin, destination, times }]) => ({
                routeId,
                route: `${origin} → ${destination}`,
                today: this.average(times),
                vehicles: times.length,
            }))
            .sort((a, b) => a.today - b.today);
    }

    // ── 3. Per-route performance: today vs yesterday ──────────────────────────
    async getRoutePerformanceVsYesterday(
        saccoId?: string,
    ): Promise<{
        routeId: string;
        route: string;
        today: number;
        dayAvg: number;
        vehicles: number;
    }[]> {
        const today = this.toDateString(new Date());
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterday = this.toDateString(yesterdayDate);

        const manager = this.routeRepository.manager;

        const [todayStats, yesterdayStats] = await Promise.all([
            this.getRouteFillStats(manager, today, saccoId),
            this.getRouteFillStats(manager, yesterday, saccoId),
        ]);

        // Union of route IDs seen either day, so a route with only yesterday's
        // data (no vehicles ran today) still shows up rather than disappearing.
        const routeIds = new Set([...todayStats.keys(), ...yesterdayStats.keys()]);

        return [...routeIds].map((routeId) => {
            const todayEntry = todayStats.get(routeId);
            const yesterdayEntry = yesterdayStats.get(routeId);
            const origin = todayEntry?.origin ?? yesterdayEntry?.origin ?? '';
            const destination = todayEntry?.destination ?? yesterdayEntry?.destination ?? '';

            return {
                routeId,
                route: `${origin} → ${destination}`,
                today: this.average(todayEntry?.times ?? []),
                dayAvg: this.average(yesterdayEntry?.times ?? []),
                vehicles: todayEntry?.times.length ?? 0,
            };
        });
    }
}
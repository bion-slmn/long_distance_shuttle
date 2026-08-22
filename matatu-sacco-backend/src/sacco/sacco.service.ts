import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, ObjectLiteral, QueryFailedError, Repository, SelectQueryBuilder } from 'typeorm';
import { Sacco, SaccoContact, SaccoEmail } from './entities/sacco.entity';
import { BookingService } from 'src/booking/booking.service';
import { TripService } from 'src/trip/trip.service';
import { Trip } from 'src/trip/entities/trip.entity';
import { Booking } from 'src/booking/entities/booking.entity';
import { SaccoSettingsService } from './sacco-settings.service';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateSaccoDto {
    name: string;
    registrationNumber?: string;
    contacts?: SaccoContact[];
    emails?: SaccoEmail[];
    headquarters?: string;
}
type SaccoListItem = Omit<Sacco, 'generateId'> & {
    vehicleCount?: number;
    userCount?: number;
    routeCount?: number;
};


export interface FindAllSaccosOptions {
    includeInactive?: boolean;
    saccoId?: string;
    page?: number;
    limit?: number;
    minimalFields?: boolean;
    search?: string;
    withCounts?: boolean;
}

export interface PaginatedSaccos {
    data: SaccoListItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface SaccoCountStats {
    currentCount: number;
    lastWeekCount: number;
    percentageChange: number; // positive = growth, negative = decline
    changeDirection: 'up' | 'down' | 'no-change';
}

export interface UpdateSaccoDto {
    name?: string;
    registrationNumber?: string;
    contacts?: SaccoContact[];
    emails?: SaccoEmail[];
    headquarters?: string;
    isActive?: boolean;
}

export interface SaccoPerformanceSummary {
    saccoId: string;
    saccoName: string;
    isActive: boolean;
    tripsThisWeek: number;
    tripsLastWeek: number;
    tripsChangePercent: number | null;
    bookingsThisWeek: number;
    uniquePassengersThisWeek: number;
    grossFaresThisWeek: number;   // deliberately not "revenue" — no commission model yet
    lastActiveDate: string | null; // most recent trip.travelDate for this sacco
    status: 'Healthy' | 'Low Activity' | 'Inactive';
}

// ─── Service ──────────────────────────────────────────────────────────────────
@Injectable()
export class SaccoService {
    constructor(
        @InjectRepository(Sacco)
        private readonly saccoRepository: Repository<Sacco>,
        private readonly saccoSettingsService: SaccoSettingsService,
    ) { }

    private toDateString(date: Date): string {
        return date.toISOString().slice(0, 10);
    }

    private subtractDays(date: Date, days: number): Date {
        const result = new Date(date);
        result.setDate(result.getDate() - days);
        return result;
    }

    // ── Per-SACCO performance (super admin comparison table) ─────────────────
    async getSaccoPerformanceSummaries(
        includeInactive = false,
        saccoId?: string,
    ): Promise<SaccoPerformanceSummary[]> {
        const saccos = await this.fetchSaccos(includeInactive, saccoId);
        if (saccos.length === 0) return [];

        const stats = await this.fetchSaccoWeeklyStats(saccoId);
        return saccos.map((sacco) => this.buildSaccoSummary(sacco, stats));
    }

    private async fetchSaccos(includeInactive: boolean, saccoId?: string) {
        const qb = this.saccoRepository.createQueryBuilder('sacco');
        if (!includeInactive) qb.andWhere('sacco.isActive = :isActive', { isActive: true });
        if (saccoId) qb.andWhere('sacco.id = :saccoId', { saccoId });
        return qb.select(['sacco.id', 'sacco.name', 'sacco.isActive']).getMany();
    }

    private scopeBySacco<T extends ObjectLiteral>(
        qb: SelectQueryBuilder<T>,
        saccoId?: string,
    ): SelectQueryBuilder<T> {
        return saccoId ? qb.andWhere('saccoId = :saccoId', { saccoId }) : qb;
    }

    private async fetchSaccoWeeklyStats(saccoId?: string) {
        const now = new Date();
        const thisWeek = { start: this.toDateString(this.subtractDays(now, 6)), end: this.toDateString(now) };
        const lastWeek = { start: this.toDateString(this.subtractDays(now, 13)), end: this.toDateString(this.subtractDays(now, 7)) };
        const manager = this.saccoRepository.manager;

        const [trips, tripsLastWeek, lastActive, bookings, uniquePassengers, grossFares] = await Promise.all([
            this.scopeBySacco(
                manager.createQueryBuilder(Trip, 'trip')
                    .select('trip.saccoId', 'saccoId').addSelect('COUNT(*)', 'count')
                    .where('trip.travelDate BETWEEN :start AND :end', thisWeek).groupBy('trip.saccoId'),
                saccoId,
            ).getRawMany<{ saccoId: string; count: string }>(),

            this.scopeBySacco(
                manager.createQueryBuilder(Trip, 'trip')
                    .select('trip.saccoId', 'saccoId').addSelect('COUNT(*)', 'count')
                    .where('trip.travelDate BETWEEN :start AND :end', lastWeek).groupBy('trip.saccoId'),
                saccoId,
            ).getRawMany<{ saccoId: string; count: string }>(),

            this.scopeBySacco(
                manager.createQueryBuilder(Trip, 'trip')
                    .select('trip.saccoId', 'saccoId').addSelect('MAX(trip.travelDate)', 'lastActiveDate')
                    .groupBy('trip.saccoId'),
                saccoId,
            ).getRawMany<{ saccoId: string; lastActiveDate: string | null }>(),

            this.scopeBySacco(
                manager.createQueryBuilder(Booking, 'b')
                    .select('b.saccoId', 'saccoId').addSelect('COUNT(*)', 'count')
                    .where('b.travelDate BETWEEN :start AND :end', thisWeek)
                    .andWhere('b.status != :cancelled', { cancelled: 'CANCELLED' }).groupBy('b.saccoId'),
                saccoId,
            ).getRawMany<{ saccoId: string; count: string }>(),

            this.scopeBySacco(
                manager.createQueryBuilder(Booking, 'b')
                    .select('b.saccoId', 'saccoId').addSelect('COUNT(DISTINCT b.passengerPhone)', 'count')
                    .where('b.travelDate BETWEEN :start AND :end', thisWeek)
                    .andWhere('b.status != :cancelled', { cancelled: 'CANCELLED' }).groupBy('b.saccoId'),
                saccoId,
            ).getRawMany<{ saccoId: string; count: string }>(),

            this.scopeBySacco(
                manager.createQueryBuilder(Booking, 'b')
                    .select('b.saccoId', 'saccoId').addSelect('SUM(b.fare)', 'total')
                    .where('b.travelDate BETWEEN :start AND :end', thisWeek)
                    .andWhere('b.paymentStatus = :paid', { paid: 'PAID' })
                    .andWhere('b.status != :cancelled', { cancelled: 'CANCELLED' }),
                saccoId,
            ).groupBy('b.saccoId').getRawMany<{ saccoId: string; total: string }>(),
        ]);

        return {
            tripsThisWeek: new Map(trips.map((r) => [r.saccoId, Number(r.count)])),
            tripsLastWeek: new Map(tripsLastWeek.map((r) => [r.saccoId, Number(r.count)])),
            lastActive: new Map(lastActive.map((r) => [r.saccoId, r.lastActiveDate])),
            bookings: new Map(bookings.map((r) => [r.saccoId, Number(r.count)])),
            uniquePassengers: new Map(uniquePassengers.map((r) => [r.saccoId, Number(r.count)])),
            grossFares: new Map(grossFares.map((r) => [r.saccoId, Number(r.total)])),
        };
    }

    private buildSaccoSummary(sacco: Sacco, stats: Awaited<ReturnType<typeof this.fetchSaccoWeeklyStats>>): SaccoPerformanceSummary {
        const tripsThisWeek = stats.tripsThisWeek.get(sacco.id) ?? 0;
        const tripsLastWeek = stats.tripsLastWeek.get(sacco.id) ?? 0;
        const tripsChangePercent = tripsLastWeek > 0
            ? Number((((tripsThisWeek - tripsLastWeek) / tripsLastWeek) * 100).toFixed(1))
            : null;
        const lastActiveDate = stats.lastActive.get(sacco.id) ?? null;

        let status: SaccoPerformanceSummary['status'] = 'Healthy';
        if (!lastActiveDate) status = 'Inactive';
        else if (tripsThisWeek < 3) status = 'Low Activity';

        return {
            saccoId: sacco.id,
            saccoName: sacco.name,
            isActive: sacco.isActive,
            tripsThisWeek,
            tripsLastWeek,
            tripsChangePercent,
            bookingsThisWeek: stats.bookings.get(sacco.id) ?? 0,
            uniquePassengersThisWeek: stats.uniquePassengers.get(sacco.id) ?? 0,
            grossFaresThisWeek: stats.grossFares.get(sacco.id) ?? 0,
            lastActiveDate,
            status,
        };
    }

    private saccoScopedQuery<T extends ObjectLiteral>(
        qb: SelectQueryBuilder<T>,
        saccoId?: string,
        alias = 'saccoId',
    ) {
        if (saccoId) qb.andWhere(`${qb.alias}.saccoId = :saccoId`, { saccoId });
        return qb.groupBy(`${qb.alias}.saccoId`).getRawMany();
    }

    // ── Create ────────────────────────────────────────────────────────────────────

    async create(dto: CreateSaccoDto): Promise<Sacco> {
        if (!dto.name?.trim()) {
            throw new BadRequestException('Sacco name is required.');
        }

        const sacco = this.saccoRepository.create({
            name: dto.name.trim(),
            registrationNumber: dto.registrationNumber?.trim() ?? null,
            contacts: dto.contacts ?? [],
            emails: dto.emails ?? [],
            headquarters: dto.headquarters?.trim() ?? 'Nairobi',
            isActive: true,
        });

        try {
            const saved = await this.saccoRepository.save(sacco);
            await this.saccoSettingsService.createDefaults(saved.id);
            return saved;
        } catch (err) {
            this.handleUniqueViolation(err);
        }
    }

    // ── Update ────────────────────────────────────────────────────────────────────

    async update(id: string, dto: UpdateSaccoDto): Promise<Sacco> {
        const sacco = await this.findOne(id);

        if (dto.name !== undefined) sacco.name = dto.name.trim();
        if (dto.registrationNumber !== undefined) sacco.registrationNumber = dto.registrationNumber?.trim() ?? null;
        if (dto.contacts !== undefined) sacco.contacts = dto.contacts;
        if (dto.emails !== undefined) sacco.emails = dto.emails;
        if (dto.headquarters !== undefined) sacco.headquarters = dto.headquarters.trim();
        if (dto.isActive !== undefined) sacco.isActive = dto.isActive;

        try {
            return await this.saccoRepository.save(sacco);
        } catch (err) {
            this.handleUniqueViolation(err);
        }
    }

    // ── Private helper ────────────────────────────────────────────────────────────

    private handleUniqueViolation(err: unknown): never {
        if (err instanceof QueryFailedError) {
            const pg = err as any;
            if (pg.code === '23505') {  // PostgreSQL unique violation code
                const detail: string = pg.detail ?? '';

                if (detail.includes('name')) {
                    throw new ConflictException('A sacco with this name already exists.');
                }
                if (detail.includes('registrationNumber')) {
                    throw new ConflictException('This registration number is already in use.');
                }
                throw new ConflictException('A duplicate value violates a unique constraint.');
            }
        }
        throw err;  // re-throw anything else unchanged
    }

    // ── Find all ──────────────────────────────────────────────────────────────


    async findAll(options: FindAllSaccosOptions = {}): Promise<PaginatedSaccos> {
        const {
            includeInactive = false,
            saccoId,
            page = 1,
            limit = 20,
            minimalFields = false,
            search,
            withCounts = false,
        } = options;

        const take = limit > 0 ? limit : 20;
        const currentPage = page > 0 ? page : 1;
        const skip = (currentPage - 1) * take;

        const qb = this.saccoRepository.createQueryBuilder('sacco');

        if (minimalFields) {
            qb.select(['sacco.id', 'sacco.name']);
        }

        if (!includeInactive) {
            qb.andWhere('sacco.isActive = :isActive', { isActive: true });
        }

        if (saccoId) {
            qb.andWhere('sacco.id = :saccoId', { saccoId });
        }

        if (search?.trim()) {
            qb.andWhere('sacco.name ILIKE :search', { search: `%${search.trim()}%` });
        }

        if (withCounts) {
            this.addCountSelects(qb);
        }

        qb.orderBy('sacco.name', 'ASC').skip(skip).take(take);

        const total = await qb.getCount();
        const data = withCounts
            ? await this.getManyWithCounts(qb)
            : await qb.getMany();

        return {
            data,
            total,
            page: currentPage,
            limit: take,
            totalPages: Math.ceil(total / take) || 0,
        };
    }

    private addCountSelects(qb: SelectQueryBuilder<Sacco>): void {
        qb.addSelect((subQb) =>
            subQb.select('COUNT(*)', 'count').from('fleet', 'f').where('f."saccoId" = sacco.id'),
            'vehicleCount'
        )
            .addSelect((subQb) =>
                subQb.select('COUNT(*)', 'count').from('users', 'u').where('u."saccoId" = sacco.id'),
                'userCount'
            )
            .addSelect((subQb) =>
                subQb.select('COUNT(*)', 'count').from('routes', 'r').where('r."saccoId" = sacco.id'),
                'routeCount'
            );
    }

    private async getManyWithCounts(qb: SelectQueryBuilder<Sacco>): Promise<SaccoListItem[]> {
        const { entities, raw } = await qb.getRawAndEntities();
        return entities.map((entity, i) => ({
            ...entity,
            vehicleCount: Number(raw[i]?.vehicleCount ?? 0),
            userCount: Number(raw[i]?.userCount ?? 0),
            routeCount: Number(raw[i]?.routeCount ?? 0),
        }));
    }


    async findOneScoped(id: string, saccoId?: string): Promise<Sacco> {
        const sacco = await this.findOne(id);

        if (saccoId && sacco.id !== saccoId) {
            throw new ForbiddenException('You do not have access to this sacco.');
        }

        return sacco;
    }

    // ── Find one ──────────────────────────────────────────────────────────────

    async findOne(id: string): Promise<Sacco> {
        const sacco = await this.saccoRepository.findOne({ where: { id } });
        if (!sacco) {
            throw new NotFoundException(`Sacco with id "${id}" not found.`);
        }
        return sacco;
    }

    async findByName(name: string): Promise<Sacco> {
        const sacco = await this.saccoRepository.findOne({
            where: { name: name.trim() },
        });
        if (!sacco) {
            throw new NotFoundException(`Sacco "${name}" not found.`);
        }
        return sacco;
    }


    // ── Deactivate (soft delete) ───────────────────────────────────────────────

    async deactivate(id: string): Promise<{ success: boolean; message: string }> {
        const sacco = await this.findOne(id);

        if (!sacco.isActive) {
            throw new BadRequestException(`Sacco "${sacco.name}" is already inactive.`);
        }

        sacco.isActive = false;
        await this.saccoRepository.save(sacco);

        return { success: true, message: `Sacco "${sacco.name}" has been deactivated.` };
    }

    // ── Reactivate ────────────────────────────────────────────────────────────

    async reactivate(id: string): Promise<{ success: boolean; message: string }> {
        const sacco = await this.findOne(id);

        if (sacco.isActive) {
            throw new BadRequestException(`Sacco "${sacco.name}" is already active.`);
        }

        sacco.isActive = true;
        await this.saccoRepository.save(sacco);

        return { success: true, message: `Sacco "${sacco.name}" has been reactivated.` };
    }

    // ── Contacts ──────────────────────────────────────────────────────────────

    async addContact(id: string, contact: SaccoContact): Promise<Sacco> {
        const sacco = await this.findOne(id);
        sacco.contacts = [...sacco.contacts, contact];
        return this.saccoRepository.save(sacco);
    }

    async removeContact(id: string, phone: string): Promise<Sacco> {
        const sacco = await this.findOne(id);
        sacco.contacts = sacco.contacts.filter(c => c.phone !== phone);
        return this.saccoRepository.save(sacco);
    }

    // ── Emails ────────────────────────────────────────────────────────────────

    async addEmail(id: string, email: SaccoEmail): Promise<Sacco> {
        const sacco = await this.findOne(id);
        sacco.emails = [...sacco.emails, email];
        return this.saccoRepository.save(sacco);
    }

    async removeEmail(id: string, email: string): Promise<Sacco> {
        const sacco = await this.findOne(id);
        sacco.emails = sacco.emails.filter(e => e.email !== email);
        return this.saccoRepository.save(sacco);
    }

    // ─── Stats ──────────────────────────────────────────────────────────────────



    async getSaccoCountStats(includeInactive = false): Promise<SaccoCountStats> {
        const qb = this.saccoRepository.createQueryBuilder('sacco');

        if (!includeInactive) {
            qb.andWhere('sacco.isActive = :isActive', { isActive: true });
        }

        // Total count right now
        const currentCount = await qb.getCount();

        // Count of saccos that already existed 7 days ago
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const lastWeekQb = this.saccoRepository.createQueryBuilder('sacco');

        if (!includeInactive) {
            lastWeekQb.andWhere('sacco.isActive = :isActive', { isActive: true });
        }

        lastWeekQb.andWhere('sacco.createdAt <= :oneWeekAgo', { oneWeekAgo });

        const lastWeekCount = await lastWeekQb.getCount();

        const percentageChange = this.calculatePercentageChange(currentCount, lastWeekCount);

        return {
            currentCount,
            lastWeekCount,
            percentageChange,
            changeDirection:
                percentageChange > 0 ? 'up' : percentageChange < 0 ? 'down' : 'no-change',
        };
    }

    private calculatePercentageChange(current: number, previous: number): number {
        if (previous === 0) {
            // Avoid divide-by-zero: if there were 0 before and some now, that's a full 100% increase (or 0 if both are 0)
            return current === 0 ? 0 : 100;
        }
        return Number((((current - previous) / previous) * 100).toFixed(2));
    }


}
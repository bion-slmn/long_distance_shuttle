import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, QueryFailedError, Repository } from 'typeorm';
import { Sacco, SaccoContact, SaccoEmail } from './entities/sacco.entity';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateSaccoDto {
    name: string;
    registrationNumber?: string;
    contacts?: SaccoContact[];
    emails?: SaccoEmail[];
    headquarters?: string;
}


export interface FindAllSaccosOptions {
    includeInactive?: boolean;
    saccoId?: string;
    page?: number;
    limit?: number;
    minimalFields?: boolean;
    search?: string;
}

export interface PaginatedSaccos {
    data: Sacco[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface UpdateSaccoDto {
    name?: string;
    registrationNumber?: string;
    contacts?: SaccoContact[];
    emails?: SaccoEmail[];
    headquarters?: string;
    isActive?: boolean;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SaccoService {
    constructor(
        @InjectRepository(Sacco)
        private readonly saccoRepository: Repository<Sacco>,
    ) { }

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
            return await this.saccoRepository.save(sacco);
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
        } = options;

        const where: any = {};

        if (!includeInactive) {
            where.isActive = true;
        }

        if (saccoId) {
            where.id = saccoId;
        }

        if (search?.trim()) {
            where.name = ILike(`%${search.trim()}%`);
        }

        const take = limit > 0 ? limit : 20;
        const currentPage = page > 0 ? page : 1;
        const skip = (currentPage - 1) * take;

        const [data, total] = await this.saccoRepository.findAndCount({
            where,
            select: minimalFields ? { id: true, name: true } : undefined,
            order: { name: 'ASC' },
            skip,
            take,
        });

        return {
            data,
            total,
            page: currentPage,
            limit: take,
            totalPages: Math.ceil(total / take) || 0,
        };
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


}
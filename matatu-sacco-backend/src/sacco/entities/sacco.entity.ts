import {
    Entity,
    PrimaryColumn, // ◄ Change this from PrimaryGeneratedColumn
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    BeforeInsert // ◄ Import BeforeInsert
} from 'typeorm';
import { uuidv7 } from 'uuidv7'; // ◄ Import uuidv7 generator

export interface SaccoContact {
    label: string;
    phone: string;
}

export interface SaccoEmail {
    label: string;
    email: string;
}

@Entity('saccos')
export class Sacco {
    @PrimaryColumn({ type: 'uuid' }) // ◄ Enforce native PostgreSQL UUID type
    declare id: string;

    @Column({ type: 'varchar', length: 150, unique: true })
    declare name: string;

    @Column({ type: 'varchar', length: 50, unique: true, nullable: true })
    declare registrationNumber: string | null;

    @Column({ type: 'jsonb', default: [] })
    declare contacts: SaccoContact[];

    @Column({ type: 'jsonb', default: [] })
    declare emails: SaccoEmail[];

    @Column({ type: 'varchar', length: 100, default: 'Nairobi' })
    declare headquarters: string;

    @Column({ type: 'boolean', default: true })
    declare isActive: boolean;

    @CreateDateColumn({ type: 'timestamp' })
    declare createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    declare updatedAt: Date;

    // ◄ Automatically run this function right before TypeORM saves a new record
    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
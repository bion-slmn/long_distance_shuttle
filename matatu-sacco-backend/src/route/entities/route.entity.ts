// src/route/entities/route.entity.ts
import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    BeforeInsert,
    ManyToOne,
    JoinColumn,
} from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { Sacco } from '../../sacco/entities/sacco.entity';

@Entity('routes')
export class Route {
    @PrimaryColumn({ type: 'uuid' })
    declare id: string;

    @ManyToOne(() => Sacco, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'saccoId' })
    declare sacco: Sacco;

    @Column({ type: 'uuid' })
    declare saccoId: string;

    @Column({ type: 'varchar', length: 100 })
    declare origin: string;

    @Column({ type: 'varchar', length: 100 })
    declare destination: string;

    @Column({ type: 'varchar', length: 100 })
    declare description: string;

    // Ordered stops between origin and destination
    @Column({ type: 'jsonb', default: [] })
    declare stages: string[];

    @Column({ type: 'boolean', default: true })
    declare isActive: boolean;

    @CreateDateColumn({ type: 'timestamp' })
    declare createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    declare updatedAt: Date;

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
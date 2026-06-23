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

export enum VehicleStatus {
    ACTIVE = 'ACTIVE',
    MAINTENANCE = 'MAINTENANCE',
    RETIRED = 'RETIRED',
}

@Entity('fleet')
export class Fleet {
    @PrimaryColumn({ type: 'uuid' })
    declare id: string;

    @ManyToOne(() => Sacco, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'saccoId' })
    declare sacco: Sacco;

    @Column({ type: 'uuid' })
    declare saccoId: string;

    @Column({ type: 'varchar', length: 20, unique: true })
    declare numberPlate: string;

    @Column({ type: 'int' })
    declare seatingCapacity: number;

    @Column({ type: 'enum', enum: VehicleStatus, default: VehicleStatus.ACTIVE })
    declare status: VehicleStatus;

    @Column({ type: 'text', nullable: true })
    declare notes: string | null;


    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
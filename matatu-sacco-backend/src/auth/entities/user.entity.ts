import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    BeforeInsert,
    ManyToOne,
    JoinColumn
} from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { Sacco } from '../../sacco/entities/sacco.entity';

// Define the clear operational roles inside the platform
export enum UserRole {
    SUPER_ADMIN = 'SUPER_ADMIN',
    SACCO_ADMIN = 'SACCO_ADMIN',
    CLERK = 'CLERK',
    DRIVER = 'DRIVER',
    PASSENGER = 'PASSENGER'
}

@Entity('users')
export class User {
    @PrimaryColumn({ type: 'uuid' })
    declare id: string;

    @Column({ type: 'varchar', length: 100 })
    declare fullName: string;

    // Made unique and nullable so a user can have an email, phone, or both
    @Column({ type: 'varchar', length: 150, unique: true, nullable: true })
    declare email: string | null;

    @Column({ type: 'varchar', length: 20, unique: true, nullable: true })
    declare phoneNumber: string | null;

    @Column({ type: 'varchar', length: 255 })
    declare passwordHash: string;

    @Column({
        type: 'enum',
        enum: UserRole,
        default: UserRole.CLERK,
    })
    declare role: UserRole;

    @Column({ type: 'boolean', default: true })
    declare isActive: boolean;

    // Many users can belong to one Sacco. 
    // cascade: false ensures that deleting a user never accidentally deletes the entire Sacco.
    @ManyToOne(() => Sacco, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'saccoId' })
    declare sacco: Sacco | null;

    @Column({ type: 'uuid', nullable: true })
    declare saccoId: string | null;

    @Column({ type: 'varchar', length: 100, nullable: true })
    declare assignedStage: string | null;

    @CreateDateColumn({ type: 'timestamp' })
    declare createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    declare updatedAt: Date;

    @Column({ type: 'int', default: 0 })
    declare tokenVersion: number;

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }


}
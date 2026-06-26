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
import { Route } from './route.entity';
import { Fleet } from '../../fleet/entities/fleet.entity';

export enum QueueStatus {
    WAITING = 'WAITING',     // In the yard, waiting for its turn
    BOARDING = 'BOARDING',   // Currenly in the active passenger loading bay
    DISPATCHED = 'DISPATCHED' // Full and gone! Left the stage
}

@Entity('route_queues')
export class RouteQueue {
    @PrimaryColumn({ type: 'uuid' })
    declare id: string;

    @ManyToOne(() => Route, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'routeId' })
    declare route: Route;

    @Column({ type: 'uuid' })
    declare routeId: string;

    @ManyToOne(() => Fleet, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'vehicleId' })
    declare vehicle: Fleet;

    @Column({ type: 'uuid' })
    declare vehicleId: string;

    @Column({ type: 'enum', enum: QueueStatus, default: QueueStatus.WAITING })
    declare status: QueueStatus;

    // The moment the driver clocks into the stage line-up for the day
    @Column({ type: 'timestamp' })
    declare clockedInAt: Date;

    @CreateDateColumn({ type: 'timestamp' })
    declare createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    declare updatedAt: Date;

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
        if (!this.clockedInAt) {
            this.clockedInAt = new Date();
        }
    }
}
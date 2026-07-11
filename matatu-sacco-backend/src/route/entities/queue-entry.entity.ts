// queue-entry.entity.ts
import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    BeforeInsert,
    ManyToOne,
    JoinColumn,
    Unique,
} from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { RouteQueue } from './route-queue.entity';
import { Fleet } from '../../fleet/entities/fleet.entity';

export enum QueueEntryStatus {
    WAITING = 'WAITING',       // In the yard, waiting for its turn
    BOARDING = 'BOARDING',     // Currently in the active passenger loading bay
    DISPATCHED = 'DISPATCHED', // Full and gone! Left the stage
}

// One row per vehicle, per queue — this is what your original entity actually was
@Entity('queue_entries')
@Unique(['routeQueueId', 'vehicleId']) // a vehicle can only hold one slot in a given day's queue
export class QueueEntry {
    @PrimaryColumn({ type: 'uuid' })
    declare id: string;

    @ManyToOne(() => RouteQueue, (queue) => queue.entries, {
        nullable: false,
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'routeQueueId' })
    declare routeQueue: RouteQueue;

    @Column({ type: 'uuid' })
    declare routeQueueId: string;

    @ManyToOne(() => Fleet, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'vehicleId' })
    declare vehicle: Fleet;

    @Column({ type: 'uuid' })
    declare vehicleId: string;

    @Column({ type: 'enum', enum: QueueEntryStatus, default: QueueEntryStatus.WAITING })
    declare status: QueueEntryStatus;

    // Explicit ordering within the queue — don't rely on clockedInAt for
    // ordering since dispatch order and arrival order can diverge
    // (e.g. manual reordering, priority slots, etc.)
    @Column({ type: 'int' })
    declare position: number;

    // The moment the driver clocks into the stage line-up for the day
    @Column({ type: 'timestamp' })
    declare clockedInAt: Date;

    @Column({ type: 'timestamp', nullable: true })
    declare dispatchedAt?: Date;

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
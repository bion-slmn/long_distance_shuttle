// route-queue.entity.ts
import {
    Entity,
    PrimaryColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    BeforeInsert,
    ManyToOne,
    JoinColumn,
    OneToMany,
    Unique,
} from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { Route } from './route.entity';
import { QueueEntry } from './queue-entry.entity';

export enum RouteQueueStatus {
    OPEN = 'OPEN',       // Accepting vehicles / actively dispatching for the day
    CLOSED = 'CLOSED',   // Day's queue is done, no more dispatches
}

// One queue per route, per day
@Entity('route_queues')
@Unique(['routeId', 'queueDate']) // prevents duplicate queues for the same route+day
export class RouteQueue {
    @PrimaryColumn({ type: 'uuid' })
    declare id: string;

    @ManyToOne(() => Route, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'routeId' })
    declare route: Route;

    @Column({ type: 'uuid' })
    declare routeId: string;

    // The calendar day this queue belongs to — use a date-only column,
    // not a timestamp, since this is the key that makes the queue unique per day
    @Column({ type: 'date' })
    declare queueDate: string;

    @Column({ type: 'enum', enum: RouteQueueStatus, default: RouteQueueStatus.OPEN })
    declare status: RouteQueueStatus;

    @OneToMany(() => QueueEntry, (entry) => entry.routeQueue)
    declare entries: QueueEntry[];

    @CreateDateColumn({ type: 'timestamp' })
    declare createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    declare updatedAt: Date;

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
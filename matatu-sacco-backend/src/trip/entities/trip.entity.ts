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
import { Route } from '../../route/entities/route.entity';
import { Fleet as Vehicle } from '../../fleet/entities/fleet.entity';
import { RouteQueue } from '../../route/entities/route-queue.entity';
import { User } from 'src/auth/entities/user.entity';

export enum TripStatus {
  BOARDING = 'BOARDING',   // Shuttle is actively in the bay filling up with passengers
  EN_ROUTE = 'EN_ROUTE',   // Full and gone! Left the terminal
  COMPLETED = 'COMPLETED', // Arrived at destination stage
  CANCELLED = 'CANCELLED'
}

@Entity('trips')
export class Trip {
  @PrimaryColumn({ type: 'uuid' })
  declare id: string;

  // Nullable — only filled the moment the vehicle actually departs the stage
  @Column({ type: 'timestamp', nullable: true })
  declare departureTime: Date | null;

  // Nullable — filled when the trip is closed (auto via next clock-in, or
  // manually/by a cleanup job). Deliberately separate from `updatedAt`,
  // which changes on any edit and can't be trusted as "this is when it
  // actually completed."
  @Column({ type: 'timestamp', nullable: true })
  declare completedAt: Date | null;

  // Postgres/TypeORM returns `decimal` columns as strings by default.
  // This transformer keeps `fare` as a real number everywhere it's used
  // in code, instead of every call site needing its own parseFloat guard
  // (the way RouteListView.formatCurrency currently has to).
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  declare fare: number;

  // Snapshot of how many passengers this trip carried — this is what
  // actually turns `fare` into a revenue figure (fare * passengerCount).
  // Nullable/defaulted to 0 so it can be filled in as boarding progresses
  // rather than requiring an exact count up front.
  @Column({ type: 'int', default: 0 })
  declare passengerCount: number;

  @Column({
    type: 'enum',
    enum: TripStatus,
    default: TripStatus.BOARDING,
  })
  declare status: TripStatus;

  // ─── Relations ─────────────────────────────────────────────────────────────

  // RESTRICT, not CASCADE — a Trip is financial history. Deleting a sacco
  // must never silently delete its revenue records as a side effect.
  @ManyToOne(() => Sacco, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'saccoId' })
  declare sacco: Sacco;

  @Column({ type: 'uuid' })
  declare saccoId: string;

  @ManyToOne(() => Route, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'routeId' })
  declare route: Route;

  @Column({ type: 'uuid' })
  declare routeId: string;

  @ManyToOne(() => Vehicle, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicleId' })
  declare vehicle: Vehicle;

  @Column({ type: 'uuid' })
  declare vehicleId: string;

  // Nullable — driver assignment may not exist yet at MVP. SET NULL (not
  // RESTRICT) because losing a driver account should never block deleting
  // that account; the trip record just loses the reference, it isn't lost.
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'driverId' })
  declare driver: User | null;

  @Column({ type: 'uuid', nullable: true })
  declare driverId: string | null;

  // Link back to the queue entry that spawned this trip — purely for
  // audit/debugging ("why did this trip get created"). SET NULL so
  // cleaning up old queue entries never has to touch trip history.
  @ManyToOne(() => RouteQueue, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'queueEntryId' })
  declare queueEntry: RouteQueue | null;

  @Column({ type: 'uuid', nullable: true })
  declare queueEntryId: string | null;

  // ─── Timestamps ────────────────────────────────────────────────────────────

  @CreateDateColumn({ type: 'timestamp' })
  declare createdAt: Date; // Boarding started time

  @UpdateDateColumn({ type: 'timestamp' })
  declare updatedAt: Date;

  @BeforeInsert()
  generateId() {
    this.id = uuidv7();
  }
}
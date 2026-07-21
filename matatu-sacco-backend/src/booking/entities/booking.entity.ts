// src/booking/entities/booking.entity.ts
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
import { Trip } from '../../trip/entities/trip.entity';
import { Route } from '../../route/entities/route.entity';

export enum BookingStatus {
    AWAITING_TRIP = 'AWAITING_TRIP', // booked ahead against a route/date, no vehicle/seat yet
    CONFIRMED = 'CONFIRMED',         // assigned to a real trip + seat
    BOARDED = 'BOARDED',             // passenger physically got on
    CANCELLED = 'CANCELLED',         // refunded or voided before travel
    NO_SHOW = 'NO_SHOW',             // trip departed, passenger never boarded
}

export enum PaymentMethod {
    CASH = 'CASH',
    MPESA = 'MPESA',
}

export enum PaymentStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    FAILED = 'FAILED',
    REFUNDED = 'REFUNDED',
}

@Entity('bookings')
export class Booking {
    @PrimaryColumn({ type: 'uuid' })
    declare id: string;

    // A booking is always against a route+date first — the trip is filled
    // in later once a queue entry actually boards. Route/travelDate stay
    // populated even after tripId is set, so history/reporting never needs
    // to join through Trip to know what was originally booked.
    @ManyToOne(() => Route, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'routeId' })
    declare route: Route;

    @Column({ type: 'uuid' })
    declare routeId: string;

    // YYYY-MM-DD, same convention as RouteQueue.queueDate — the pair
    // (routeId, travelDate) is what assignPendingBookingsToTrip matches on.
    @Column({ type: 'date' })
    declare travelDate: string;

    // Nullable now — a booking can be CONFIRMED-payment but still
    // AWAITING_TRIP with no vehicle assigned. Set once a real Trip absorbs it.
    @ManyToOne(() => Trip, { nullable: true, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'tripId' })
    declare trip: Trip | null;

    @Column({ type: 'uuid', nullable: true })
    declare tripId: string | null;

    // Only meaningful once tripId is set — null while AWAITING_TRIP.
    @Column({ type: 'int', nullable: true })
    declare seatNumber: number | null;

    // Denormalized from Trip.saccoId at creation time — lets you query/report
    // bookings by sacco without joining through Trip every time, and locks in
    // the sacco even if trip data changes later. Same reasoning as saccoId on Trip.
    // Now sourced from Route.saccoId instead, since Trip may not exist yet.
    @Column({ type: 'uuid' })
    declare saccoId: string;

    @Column({ type: 'varchar', length: 100 })
    declare passengerName: string;

    // Required, not optional — this is your reconciliation anchor for M-Pesa
    // and your only way to contact a passenger about a delay/cancellation.
    @Column({ type: 'varchar', length: 20 })
    declare passengerPhone: string;

    @Column({ type: 'numeric', precision: 8, scale: 2 })
    declare fare: number;

    @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.AWAITING_TRIP })
    declare status: BookingStatus;

    @Column({ type: 'enum', enum: PaymentMethod })
    declare paymentMethod: PaymentMethod;

    @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
    declare paymentStatus: PaymentStatus;

    // M-Pesa Daraja reconciliation fields — null for CASH bookings
    @Column({ type: 'varchar', length: 50, nullable: true })
    declare mpesaCheckoutRequestId: string | null;

    @Column({ type: 'varchar', length: 50, nullable: true })
    declare mpesaReceiptNumber: string | null;

    // Which clerk/user recorded this booking — accountability trail,
    // matters when there's a fare dispute or reconciliation mismatch.
    @Column({ type: 'uuid', nullable: true })
    declare createdByUserId: string | null;

    @CreateDateColumn()
    declare createdAt: Date;

    @UpdateDateColumn()
    declare updatedAt: Date;

    @BeforeInsert()
    generateId() {
        this.id = uuidv7();
    }
}
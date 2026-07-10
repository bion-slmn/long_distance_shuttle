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

export enum BookingStatus {
    PENDING = 'PENDING',       // created, payment not yet confirmed
    CONFIRMED = 'CONFIRMED',   // paid (cash or M-Pesa), holding a seat
    BOARDED = 'BOARDED',       // passenger physically got on
    CANCELLED = 'CANCELLED',   // refunded or voided before travel
    NO_SHOW = 'NO_SHOW',       // trip departed, passenger never boarded
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

    @ManyToOne(() => Trip, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'tripId' })
    declare trip: Trip;

    @Column({ type: 'uuid' })
    declare tripId: string;

    // Denormalized from Trip.saccoId at creation time — lets you query/report
    // bookings by sacco without joining through Trip every time, and locks in
    // the sacco even if trip data changes later. Same reasoning as saccoId on Trip.
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

    @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.PENDING })
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
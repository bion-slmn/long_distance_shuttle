// src/payment/entities/payment.entity.ts
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

export enum PaymentMethod {
    MPESA = 'MPESA',
    CASH = 'CASH',
}

export enum PaymentStatus {
    PENDING = 'PENDING',         // created, STK push not yet sent (or cash, awaiting conductor confirm)
    PROCESSING = 'PROCESSING',   // STK push sent, waiting on callback
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',           // user cancelled, wrong PIN, insufficient funds, etc.
    EXPIRED = 'EXPIRED',         // no callback within timeout window
}

export enum PaymentReferenceType {
    BOOKING = 'BOOKING',
    // future: SACCO_SUBSCRIPTION, DRIVER_PAYOUT, etc.
}

@Entity('payments')
export class Payment {
    @PrimaryGeneratedColumn('uuid')
    declare id: string;

    // ── what this payment is for ──
    @Index()
    @Column({ type: 'enum', enum: PaymentReferenceType })
    declare referenceType: PaymentReferenceType;

    @Index()
    @Column()
    declare referenceId: string; // e.g. bookingId — no FK constraint, kept generic

    @Index()
    @Column()
    declare saccoId: string; // for scoping + per-sacco reconciliation reports

    // ── money ──
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    declare amount: number;

    @Column({ default: 'KES' })
    declare currency: string;

    // ── method + status ──
    @Column({ type: 'enum', enum: PaymentMethod })
    declare method: PaymentMethod;

    @Index()
    @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
    declare status: PaymentStatus;

    // ── M-Pesa specific (nullable — irrelevant for CASH) ──
    @Column({ nullable: true })
    declare payerPhone: string; // number the STK prompt was sent to

    @Index({ unique: true, where: '"checkoutRequestId" IS NOT NULL' })
    @Column({ nullable: true })
    declare checkoutRequestId: string; // ← callback lookup key

    @Column({ nullable: true })
    declare merchantRequestId: string;

    @Column({ nullable: true })
    declare mpesaReceiptNumber: string; // from successful callback, for reconciliation

    @Column({ nullable: true })
    declare resultCode: string; // raw Daraja ResultCode

    @Column({ nullable: true })
    declare resultDesc: string; // raw Daraja ResultDesc, useful for support/debugging

    @Column({ type: 'jsonb', nullable: true })
    declare rawCallbackPayload: Record<string, any>; // full callback body, for audits/disputes

    // ── timestamps ──
    @Column({ type: 'timestamptz', nullable: true })
    declare initiatedAt: Date; // when STK push was sent

    @Column({ type: 'timestamptz', nullable: true })
    declare completedAt: Date; // when callback resolved it (success or fail)

    // ── Push-initiation failure (synchronous Daraja rejection, not callback) ──
    @Column({ nullable: true })
    declare initiationErrorCode: string; // Daraja's errorCode, e.g. "404.001.03"

    @Column({ nullable: true })
    declare initiationErrorMessage: string; // Daraja's errorMessage, human-readable

    @CreateDateColumn({ type: 'timestamptz' })
    declare createdAt: Date;

    @UpdateDateColumn({ type: 'timestamptz' })
    declare updatedAt: Date;
}